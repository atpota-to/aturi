import Foundation
import XCTest
@testable import AturiCore

/// A downloader that answers from memory, after an optional pause, and
/// counts what it was asked for.
private final class CarFakeDownloader: CarArchiveDownloading, @unchecked Sendable {
    private let lock = NSLock()
    private let response: CarDownloadResponse?
    private let error: Error?
    private let delayNanoseconds: UInt64
    private var urls: [URL] = []

    init(status: Int = 200, body: [UInt8], delayNanoseconds: UInt64 = 0) {
        response = CarDownloadResponse(status: status, body: body)
        error = nil
        self.delayNanoseconds = delayNanoseconds
    }

    init(error: Error) {
        response = nil
        self.error = error
        delayNanoseconds = 0
    }

    func download(_ url: URL, cap: Int, onProgress: @escaping @Sendable (Int) -> Void) async throws -> CarDownloadResponse {
        lock.lock()
        urls.append(url)
        lock.unlock()
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        if let error { throw error }
        let response = self.response!
        onProgress(response.body.count)
        return response
    }

    var requested: [URL] {
        lock.lock()
        defer { lock.unlock() }
        return urls
    }
}

@MainActor
final class CarInspectorModelTests: XCTestCase {
    private nonisolated static let identity = IdentityBundle(did: CarFixture.did, handle: "alice.example.com", pds: "https://pds.example.com")

    private func makeModel(_ downloader: CarFakeDownloader, resolves: Bool = true) -> CarInspectorModel {
        let identity = Self.identity
        return CarInspectorModel(
            resolve: { input in
                if resolves { return identity }
                throw IdentityResolverError.unresolvable(input)
            },
            downloader: downloader
        )
    }

    /// Wait for the model to settle, rather than for a fixed beat.
    private func until(_ condition: () -> Bool, timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition(), Date() < deadline {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    func testALinkLooksTheAccountUpButFetchesNothing() async throws {
        let downloader = CarFakeDownloader(body: CarFixture.sampleRepo().bytes)
        let model = makeModel(downloader)
        model.lookUp("https://bsky.app/profile/alice.example.com")
        XCTAssertEqual(model.actor, "alice.example.com")
        XCTAssertTrue(model.account.isLoading)
        try await until { model.account.value != nil }
        XCTAssertEqual(model.account.value, Self.identity)
        XCTAssertFalse(model.hasSource)
        XCTAssertEqual(downloader.requested, [])
    }

    func testFetchingTheExportOpensTheArchive() async throws {
        let downloader = CarFakeDownloader(body: CarFixture.sampleRepo().bytes)
        let model = makeModel(downloader)
        model.lookUp("alice.example.com")
        try await until { model.account.value != nil }
        model.fetchExport()
        XCTAssertTrue(model.isLoading)
        try await until { !model.isLoading }
        let archive = try XCTUnwrap(model.archive)
        XCTAssertEqual(archive.recordCount, 5)
        XCTAssertEqual(model.archiveName, "alice.example.com.car")
        XCTAssertFalse(model.sourceIsFile)
        XCTAssertEqual(
            downloader.requested.first?.absoluteString,
            "https://pds.example.com/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Az72i7hdynmk6r22z27h6tvur"
        )
        XCTAssertEqual(model.checks.first { $0.id == .hashes }?.status, .info)
    }

    func testAPDSThatRefusesSaysWhy() async throws {
        let body = Array(#"{"error":"RepoDeactivated","message":"Repo has been deactivated"}"#.utf8)
        let model = makeModel(CarFakeDownloader(status: 400, body: body))
        model.lookUp("alice.example.com")
        try await until { model.account.value != nil }
        model.fetchExport()
        try await until { !model.isLoading }
        XCTAssertEqual(model.loadError, "The PDS would not send the export: Repo has been deactivated (HTTP 400).")
    }

    func testAnExportOverTheCapIsRefusedPolitely() async throws {
        let model = makeModel(CarFakeDownloader(error: CarDownloadError.tooLarge))
        model.lookUp("alice.example.com")
        try await until { model.account.value != nil }
        model.fetchExport()
        try await until { !model.isLoading }
        XCTAssertEqual(model.loadError, CarFormat.tooLargeMessage)
        XCTAssertTrue(CarFormat.tooLargeMessage.hasPrefix("Exports over 100 MB are not opened here."))
    }

    func testAnAccountThatDoesNotResolveIsAFailedLookUp() async throws {
        let model = makeModel(CarFakeDownloader(body: []), resolves: false)
        model.lookUp("nobody.example.com")
        try await until { !model.account.isLoading }
        XCTAssertTrue(model.account.isFailed)
    }

    func testAFileOpensWithoutTheLinkNamingAnAccount() async throws {
        let model = makeModel(CarFakeDownloader(body: []))
        model.lookUp("alice.example.com")
        let bytes = CarFixture.sampleRepo().bytes
        model.openFile(name: "backup.car") { bytes }
        XCTAssertEqual(model.actor, "")
        XCTAssertTrue(model.sourceIsFile)
        try await until { !model.isLoading }
        XCTAssertEqual(model.archive?.collections.count, 2)
        XCTAssertEqual(model.archiveName, "backup.car")
    }

    func testAFileThatIsNotACARSaysSo() async throws {
        let model = makeModel(CarFakeDownloader(body: []))
        model.openFile(name: "notes.txt") { Array("just some notes".utf8) }
        try await until { !model.isLoading }
        XCTAssertTrue(model.loadError?.contains("does not look like a CAR file") ?? false, model.loadError ?? "")
    }

    func testStopPutsTheDownloadAway() async throws {
        let model = makeModel(CarFakeDownloader(body: CarFixture.sampleRepo().bytes, delayNanoseconds: 2_000_000_000))
        model.lookUp("alice.example.com")
        try await until { model.account.value != nil }
        model.fetchExport()
        XCTAssertTrue(model.isLoading)
        model.stop()
        XCTAssertFalse(model.hasSource)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertFalse(model.hasSource, "a stopped download does not come back")
    }

    func testTheHashCheckRunsAndCanBeAskedAgain() async throws {
        let model = makeModel(CarFakeDownloader(body: []))
        model.openFile(name: "backup.car") { CarFixture.sampleRepo().bytes }
        try await until { model.archive != nil }
        model.checkHashes()
        XCTAssertTrue(model.isHashing)
        try await until { !model.isHashing }
        XCTAssertEqual(model.hashes, .done(CarHashCheck(checked: 9, skipped: 0, mismatched: [])))
        XCTAssertEqual(model.checks.first { $0.id == .hashes }?.status, .pass)
        model.stopHashes()
        XCTAssertEqual(model.hashes, .idle)
    }

    func testTheJSONExportIsWrittenForTheShareSheet() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("carmodeltests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = CarInspectorModel(resolve: { _ in Self.identity }, downloader: CarFakeDownloader(body: []), exportDirectory: directory)
        model.openFile(name: "backup.car") { CarFixture.sampleRepo().bytes }
        try await until { model.archive != nil }

        model.export(.collection("app.bsky.feed.post"))
        XCTAssertEqual(model.exporting?.scope, .collection("app.bsky.feed.post"))
        try await until { model.exporting == nil }
        let file = try XCTUnwrap(model.exportedFile)
        XCTAssertEqual(file.lastPathComponent, "backup.app.bsky.feed.post.json")
        let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual((parsed["records"] as? [Any])?.count, 3)
        XCTAssertNil(model.exportNote)

        model.export(.all)
        try await until { model.exporting == nil }
        XCTAssertEqual(model.exportedFile?.lastPathComponent, "backup.json")
    }

    func testAReadFileIsRefusedPastTheCap() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("carmodeltests-\(UUID().uuidString).car")
        let bytes = CarFixture.sampleRepo().bytes
        try Data(bytes).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(try CarRepo.readFile(at: url), bytes)
        XCTAssertThrowsError(try CarRepo.readFile(at: url, cap: 10)) { error in
            XCTAssertEqual((error as? CarError)?.message, CarFormat.tooLargeMessage)
        }
    }
}
