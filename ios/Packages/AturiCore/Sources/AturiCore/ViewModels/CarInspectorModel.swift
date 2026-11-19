import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The repo archive inspector's state, port of `CarInspector.tsx` and the
// export half of `CarInspectorBrowser.tsx`. The reading is in Tools:
// CarCBOR (the block format), CarFile (the file), CarRepo (the commit and
// the tree), CarChecks (what the structure says), CarExport (the JSON file).
//
// An account in the link is looked up but not fetched: an export can run to
// many megabytes, and a shared link should not start that download on its
// own. A file from the device never touches the link at all.
//
// The work that takes time (reading the file, walking the tree, hashing
// every block, writing the JSON) runs off the main actor, a slice at a time,
// reporting back here and stopping when its task is cancelled.

/// Where an archive is on its way in, and what it is once it is.
public enum CarLoadState: Sendable {
    case idle
    /// Fetching the export from the PDS: `received` bytes so far.
    case downloading(received: Int)
    /// Reading the archive: `size` bytes, read as far as `progress` says.
    case opening(progress: CarOpenProgress?, size: Int)
    case ready(CarRepoArchive, name: String)
    case failed(String)
}

/// What the JSON export is writing: one collection or everything.
public enum CarExportScope: Hashable, Sendable {
    case all
    case collection(String)
}

public struct CarExportProgress: Hashable, Sendable {
    public var scope: CarExportScope
    public var done: Int
    public var total: Int

    /// "Preparing… 40%", what the export button says while it runs.
    public var label: String {
        "Preparing\u{2026} \(Int((Double(done) / Double(max(total, 1)) * 100).rounded(.down)))%"
    }
}

@MainActor
@Observable
public final class CarInspectorModel {
    /// The account as the link holds it (a handle or DID), or empty.
    public private(set) var actor = ""
    /// The account looked up for `actor`: its PDS, before anything is fetched.
    public private(set) var account: Loadable<IdentityBundle> = .idle
    public private(set) var loading: CarLoadState = .idle
    /// Whether what is loading or open came from a file rather than an account.
    public private(set) var sourceIsFile = false
    public private(set) var hashes: CarHashProgress = .idle
    public private(set) var exporting: CarExportProgress?
    /// What the last export said beyond its file: records left out, or why it failed.
    public private(set) var exportNote: String?
    /// The last JSON file written, ready to hand to the share sheet.
    public private(set) var exportedFile: URL?
    /// Changes each time an archive opens, so a view can start its own
    /// state (the chosen collection, the open record) afresh for it.
    public private(set) var archiveID = 0

    @ObservationIgnored private let resolve: @Sendable (String) async throws -> IdentityBundle
    @ObservationIgnored private let downloader: CarArchiveDownloading
    @ObservationIgnored private let hash: @Sendable ([UInt8]) -> [UInt8]
    @ObservationIgnored private let exportDirectory: URL
    @ObservationIgnored private var accountTask: Task<Void, Never>?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var hashTask: Task<Void, Never>?
    @ObservationIgnored private var exportTask: Task<Void, Never>?
    @ObservationIgnored private var accountGeneration = 0
    @ObservationIgnored private var loadGeneration = 0
    @ObservationIgnored private var hashGeneration = 0
    @ObservationIgnored private var exportGeneration = 0

    /// - Parameters:
    ///   - resolve: handle or DID to its identity; the shared resolver by default.
    ///   - downloader: how the export is fetched; tests pass a fake.
    ///   - hash: SHA-256. The app hands in the system's, which is much
    ///     quicker on a large archive; the package's own is the default.
    ///   - exportDirectory: where JSON exports are written for sharing.
    public init(
        resolve: (@Sendable (String) async throws -> IdentityBundle)? = nil,
        downloader: CarArchiveDownloading = URLSessionCarDownloader(),
        hash: @escaping @Sendable ([UInt8]) -> [UInt8] = { bytes in OAuthSHA256.hash(bytes) },
        exportDirectory: URL = FileManager.default.temporaryDirectory
    ) {
        if let resolve {
            self.resolve = resolve
        } else {
            self.resolve = { input in try await IdentityResolver.shared.resolveIdentifier(input) }
        }
        self.downloader = downloader
        self.hash = hash
        self.exportDirectory = exportDirectory
    }

    // MARK: Derived

    public var archive: CarRepoArchive? {
        if case .ready(let archive, _) = loading { return archive }
        return nil
    }

    public var archiveName: String? {
        if case .ready(_, let name) = loading { return name }
        return nil
    }

    /// An archive is on its way in.
    public var isLoading: Bool {
        switch loading {
        case .downloading, .opening: return true
        case .idle, .ready, .failed: return false
        }
    }

    /// Something has been asked for: a file, or a fetched export.
    public var hasSource: Bool {
        if case .idle = loading { return false }
        return true
    }

    public var loadError: String? {
        if case .failed(let message) = loading { return message }
        return nil
    }

    public var checks: [CarArchiveCheck] {
        guard let archive else { return [] }
        return CarChecks.archiveChecks(archive, hashes: hashes)
    }

    public var isHashing: Bool {
        if case .running = hashes { return true }
        return false
    }

    // MARK: Account

    /// Look up the account a link or the input names. Whatever was open is
    /// put away: a fetched archive belongs to the account it was fetched
    /// for, and once the input names another it is no longer what the page
    /// is about.
    public func lookUp(_ raw: String) {
        let next = CarFormat.actorFromInput(raw)
        stop()
        actor = next
        accountTask?.cancel()
        accountGeneration += 1
        guard !next.isEmpty else {
            account = .idle
            return
        }
        let gen = accountGeneration
        account = .loading
        let resolve = self.resolve
        accountTask = Task { [weak self] in
            do {
                let bundle = try await resolve(next)
                guard let self, gen == self.accountGeneration else { return }
                self.account = .loaded(bundle)
            } catch {
                guard let self, gen == self.accountGeneration, !Task.isCancelled else { return }
                self.account = .failed(ExploreErrorText.describe(error))
            }
        }
    }

    /// Try the lookup again after it failed.
    public func retryLookUp() {
        lookUp(actor)
    }

    // MARK: Opening

    /// Fetch the looked-up account's export and open it.
    public func fetchExport() {
        guard let identity = account.value else { return }
        let url: URL
        do {
            url = try PDSClient.repoURL(pds: identity.pds, did: identity.did)
        } catch {
            loading = .failed(ExploreErrorText.describe(error))
            return
        }
        let downloader = self.downloader
        let name = CarFormat.exportFileName(handle: identity.handle, did: identity.did)
        begin(name: name, fromFile: false) { report in
            try await CarInspectorModel.download(url, with: downloader, report: report)
        }
    }

    /// Open a file from the device. `read` hands back its bytes; the app
    /// wraps `CarRepo.readFile` in the file's security-scoped access. The
    /// link no longer names an account once a file is open.
    public func openFile(name: String, read: @escaping @Sendable () async throws -> [UInt8]) {
        accountTask?.cancel()
        accountGeneration += 1
        actor = ""
        account = .idle
        begin(name: name, fromFile: true) { _ in
            try await read()
        }
    }

    /// Stop whatever is on its way in, and put away what was open.
    public func stop() {
        loadTask?.cancel()
        loadTask = nil
        loadGeneration += 1
        stopHashes()
        cancelExport()
        loading = .idle
        sourceIsFile = false
    }

    /// Try the last fetch again after it failed.
    public func retryFetch() {
        if account.value != nil {
            fetchExport()
        }
    }

    private func begin(
        name: String,
        fromFile: Bool,
        obtain: @escaping @Sendable (_ report: @escaping @Sendable (Int) -> Void) async throws -> [UInt8]
    ) {
        stop()
        let gen = loadGeneration
        sourceIsFile = fromFile
        loading = fromFile ? .opening(progress: nil, size: 0) : .downloading(received: 0)
        // Progress from off the main actor, back on it. A late report for a
        // load that has moved on is dropped.
        let downloaded: @Sendable (Int) -> Void = { received in
            Task { @MainActor in
                self.noteDownload(received, gen: gen)
            }
        }
        let opened: @Sendable (CarOpenProgress) -> Void = { progress in
            Task { @MainActor in
                self.noteOpening(progress, gen: gen)
            }
        }
        loadTask = Task { [weak self] in
            do {
                let bytes = try await obtain(downloaded)
                try Task.checkCancellation()
                guard let self, gen == self.loadGeneration else { return }
                self.loading = .opening(progress: nil, size: bytes.count)
                let archive = try await CarRepo.openArchive(bytes, onProgress: opened)
                guard gen == self.loadGeneration else { return }
                self.archiveID = gen
                self.loading = .ready(archive, name: name)
            } catch {
                guard let self, gen == self.loadGeneration, !Task.isCancelled else { return }
                self.loading = .failed(CarInspectorModel.describe(error))
            }
        }
    }

    private func noteDownload(_ received: Int, gen: Int) {
        guard gen == loadGeneration, case .downloading = loading else { return }
        loading = .downloading(received: received)
    }

    private func noteOpening(_ progress: CarOpenProgress, gen: Int) {
        guard gen == loadGeneration, case .opening(_, let size) = loading else { return }
        loading = .opening(progress: progress, size: size)
    }

    /// The export, from the PDS, with the web's words for what went wrong.
    private nonisolated static func download(
        _ url: URL,
        with downloader: CarArchiveDownloading,
        report: @escaping @Sendable (Int) -> Void
    ) async throws -> [UInt8] {
        let response = try await downloader.download(url, cap: CarFormat.maxArchiveBytes, onProgress: report)
        guard (200..<300).contains(response.status) else {
            var reason: String?
            if let body = try? JSONValue.parse(Data(response.body)) {
                reason = [body["message"]?.stringValue, body["error"]?.stringValue]
                    .compactMap { $0 }
                    .first { !$0.isEmpty }
            }
            if let reason {
                throw CarError("The PDS would not send the export: \(reason) (HTTP \(response.status)).")
            }
            throw CarError("The PDS would not send the export (HTTP \(response.status)).")
        }
        return response.body
    }

    /// A failure in words for the page.
    nonisolated static func describe(_ error: Error) -> String {
        if let error = error as? CarError { return error.message }
        if let error = error as? CarRepoError { return error.message }
        if let error = error as? CarCBORError { return error.message }
        if let error = error as? CarDownloadError {
            switch error {
            case .tooLarge: return CarFormat.tooLargeMessage
            case .redirected: return "The PDS answered with a redirect, which is not followed."
            }
        }
        if error is URLError {
            return "The PDS did not answer, so the export could not be fetched. Try again in a moment."
        }
        return ExploreErrorText.describe(error)
    }

    // MARK: Block hashes

    /// Hash every block again and compare it with its CID.
    public func checkHashes() {
        guard let archive else { return }
        stopHashes()
        let gen = hashGeneration
        let car = archive.car
        let hash = self.hash
        hashes = .running(done: 0, total: car.blocks.count)
        let hashed: @Sendable (Int, Int) -> Void = { done, total in
            Task { @MainActor in
                self.noteHashing(done, total, gen: gen)
            }
        }
        hashTask = Task { [weak self] in
            do {
                let result = try await CarInspectorModel.verify(car, hash: hash, onProgress: hashed)
                guard let self, gen == self.hashGeneration else { return }
                self.hashes = .done(result)
            } catch {
                guard let self, gen == self.hashGeneration else { return }
                self.hashes = .idle
            }
        }
    }

    private func noteHashing(_ done: Int, _ total: Int, gen: Int) {
        guard gen == hashGeneration, case .running = hashes else { return }
        hashes = .running(done: done, total: total)
    }

    /// Stop the hash check. It goes back to not checked.
    public func stopHashes() {
        hashTask?.cancel()
        hashTask = nil
        hashGeneration += 1
        hashes = .idle
    }

    private nonisolated static func verify(
        _ car: CarFile,
        hash: @escaping @Sendable ([UInt8]) -> [UInt8],
        onProgress: @escaping @Sendable (Int, Int) -> Void
    ) async throws -> CarHashCheck {
        try CarReader.verifyBlockHashes(car, hash: hash, isStopped: { Task.isCancelled }, onProgress: onProgress)
    }

    // MARK: JSON export

    /// Write one collection, or every record, to a JSON file for the share sheet.
    public func export(_ scope: CarExportScope) {
        guard let archive, let name = archiveName, exporting == nil else { return }
        let collections: [CarRepoCollection]
        let fileName: String
        let base = name.lowercased().hasSuffix(".car") ? String(name.dropLast(4)) : name
        switch scope {
        case .all:
            collections = archive.collections
            fileName = "\(base).json"
        case .collection(let nsid):
            collections = archive.collections.filter { $0.nsid == nsid }
            fileName = "\(base).\(nsid).json"
        }
        let total = collections.reduce(0) { $0 + $1.rkeys.count }
        let file = exportDirectory.appendingPathComponent(fileName)
        exportGeneration += 1
        let gen = exportGeneration
        exporting = CarExportProgress(scope: scope, done: 0, total: total)
        exportNote = nil
        exportedFile = nil
        let wrote: @Sendable (Int, Int) -> Void = { done, total in
            Task { @MainActor in
                self.noteExporting(scope, done, total, gen: gen)
            }
        }
        exportTask = Task { [weak self] in
            do {
                let summary = try await CarInspectorModel.write(archive, collections: collections, to: file, onProgress: wrote)
                guard let self, gen == self.exportGeneration else { return }
                self.exporting = nil
                self.exportedFile = summary.file
                if summary.skipped > 0 {
                    let records = summary.skipped == 1 ? "record was" : "records were"
                    self.exportNote = "\(CarFormat.count(summary.skipped)) \(records) left out, because the data is not in the file."
                }
            } catch {
                try? FileManager.default.removeItem(at: file)
                guard let self, gen == self.exportGeneration else { return }
                self.exporting = nil
                if !(error is CancellationError) {
                    self.exportNote = "The JSON file could not be written. The device may be short of space."
                }
            }
        }
    }

    private func noteExporting(_ scope: CarExportScope, _ done: Int, _ total: Int, gen: Int) {
        guard gen == exportGeneration, exporting != nil else { return }
        exporting = CarExportProgress(scope: scope, done: done, total: total)
    }

    private func cancelExport() {
        exportTask?.cancel()
        exportTask = nil
        exportGeneration += 1
        exporting = nil
        exportNote = nil
        exportedFile = nil
    }

    private nonisolated static func write(
        _ archive: CarRepoArchive,
        collections: [CarRepoCollection],
        to file: URL,
        onProgress: @escaping @Sendable (Int, Int) -> Void
    ) async throws -> CarExportSummary {
        try CarExport.writeJSON(archive, collections: collections, to: file, isStopped: { Task.isCancelled }, onProgress: onProgress)
    }
}

extension CarRepo {
    /// A file from the device, read whole, refused past `cap` before it is
    /// read. Mapped first, so a file over the limit costs nothing to refuse.
    public static func readFile(at url: URL, cap: Int = CarFormat.maxArchiveBytes) throws -> [UInt8] {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        if data.count > cap {
            throw CarError(CarFormat.tooLargeMessage)
        }
        return [UInt8](data)
    }
}
