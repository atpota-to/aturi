import SwiftUI
import CryptoKit
import UniformTypeIdentifiers
import AturiCore

/// `/tools/car`, port of `src/components/tools/CarInspector.tsx` and
/// `CarInspectorBrowser.tsx`: open a repository export, from an account's
/// PDS or from a file on the device, and see its commit, how sound it is,
/// and every record. The reading is in AturiCore (`CarFile`, `CarRepo`,
/// `CarChecks`, `CarExport`), the state in `CarInspectorModel`.
///
/// `?actor=` looks the account up but does not fetch the export: it can run
/// to many megabytes, and a shared link should not start that download on
/// its own. A file from the device never touches the link at all.
struct CarToolView: View {
    let query: [String: String]

    /* The system's SHA-256 for the block-hash check: the package's own is
       written for Linux and is far slower over a large archive. */
    @State private var model = CarInspectorModel(hash: { bytes in Array(SHA256.hash(data: bytes)) })
    @State private var input = ""
    @State private var picking = false
    @State private var appeared = false
    @State private var stackDepth: CarStackDepth?

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    /// Two small repositories, so trying the tool costs under a megabyte.
    private static let examples = ["aturi.to", "atproto.com"]

    private var shareQuery: [String: String] {
        model.actor.isEmpty ? [:] : ["actor": model.actor]
    }

    var body: some View {
        ToolFrame(slug: "car", shareQuery: shareQuery) {
            form
        } content: {
            content
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [UTType.data]) { result in
            guard case .success(let url) = result else { return }
            input = ""
            model.openFile(name: url.lastPathComponent) {
                let scoped = url.startAccessingSecurityScopedResource()
                defer {
                    if scoped {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                return try CarRepo.readFile(at: url)
            }
        }
        .onAppear {
            stackDepth = CarStackDepth(tab: router.selectedTab, count: depth(of: router.selectedTab))
            guard !appeared else { return }
            appeared = true
            let raw = (query["actor"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !raw.isEmpty {
                input = raw
                model.lookUp(raw)
            }
        }
        .onDisappear {
            /* Popped, rather than covered by a page pushed over it or left
               for another tab: the stack it was on is now shorter. A
               download or a hash check nobody will see is stopped. */
            if let stackDepth, depth(of: stackDepth.tab) < stackDepth.count {
                model.stop()
            }
        }
    }

    private func depth(of tab: Tab) -> Int {
        switch tab {
        case .explore: return router.explorePath.count
        case .links: return router.linksPath.count
        case .lexicons: return router.lexiconsPath.count
        case .tools: return router.toolsPath.count
        case .settings: return router.settingsPath.count
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            ToolInputBar(
                placeholder: "alice.example.com or did:plc:\u{2026}",
                text: $input,
                buttonTitle: "Look up",
                isRunning: model.account.isLoading
            ) {
                model.lookUp(input)
            }
            ToolExamples(examples: Self.examples) { value in
                input = value
                model.lookUp(value)
            }
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "doc.badge.arrow.up")
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityHidden(true)
                Text("Or open a .car file from this device. It is read in the app and never uploaded.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                picking = true
            } label: {
                Label("Choose a file", systemImage: "folder")
            }
            .buttonStyle(.aturiSecondary)
            .disabled(model.isLoading)
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if model.hasSource {
            sourceContent
        } else if !model.actor.isEmpty {
            accountContent
        } else {
            intro
        }
    }

    @ViewBuilder
    private var sourceContent: some View {
        switch model.loading {
        case .idle:
            EmptyView()
        case .downloading(let received):
            loadingCard(
                title: "Fetching the export",
                text: received == 0
                    ? "Asking the PDS for the repository."
                    : "\(CarFormat.bytes(received)) so far. The PDS does not say how large the export is until it ends.",
                fraction: nil
            )
        case .opening(let progress, let size):
            openingCard(progress: progress, size: size)
        case .failed(let message):
            if model.sourceIsFile {
                ErrorPanel(message: message)
            } else {
                ErrorPanel(message: message) {
                    model.retryFetch()
                }
            }
        case .ready(let archive, let name):
            CarArchiveSections(model: model, archive: archive, name: name)
                .id(model.archiveID)
        }
    }

    private func openingCard(progress: CarOpenProgress?, size: Int) -> some View {
        let text: String
        let fraction: Double
        switch progress {
        case .tree(let records)?:
            text = "\(CarFormat.count(records)) records listed so far."
            fraction = 1
        case .blocks(let done, _)?:
            text = "\(CarFormat.bytes(done)) of \(CarFormat.bytes(size)) read."
            fraction = size > 0 ? Double(done) / Double(size) : 0
        case nil:
            text = "\(CarFormat.bytes(0)) of \(CarFormat.bytes(size)) read."
            fraction = 0
        }
        return loadingCard(title: "Reading the archive", text: text, fraction: fraction)
    }

    private func loadingCard(title: String, text: String, fraction: Double?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                    Text(text)
                        .font(AturiFont.footnote)
                        .monospacedDigit()
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                Button("Stop") {
                    model.stop()
                }
                .buttonStyle(.aturiSecondary)
            }
            if let fraction {
                ProgressView(value: min(max(fraction, 0), 1))
                    .tint(theme.accent)
                    .accessibilityHidden(true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    @ViewBuilder
    private var accountContent: some View {
        switch model.account {
        case .idle, .loading:
            SkeletonRows(count: 2)
        case .failed:
            ErrorPanel(message: "\(model.actor) could not be found. Check the handle or DID, or try again in a moment.") {
                model.retryLookUp()
            }
        case .loaded(let identity):
            accountSection(identity)
        }
    }

    private func accountSection(_ identity: IdentityBundle) -> some View {
        ToolSection("Account") {
            ToolFactRow(label: "Handle", value: identity.handle ?? "None", mono: identity.handle != nil)
            CarFactLink(label: "DID", value: identity.did) {
                router.open(.repo(identity.did))
            }
            ToolFactRow(label: "PDS", value: PDSServer.pdsHostname(identity.pds))
            if let inactive = identity.repoStatus {
                Text("The PDS reports this repository as \(inactive.status ?? "inactive"), so it may refuse to send the export.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
            }
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    model.fetchExport()
                } label: {
                    Label("Fetch the export", systemImage: "arrow.down.circle")
                }
                .buttonStyle(.aturiPrimary)
                if let url = try? PDSClient.repoURL(pds: identity.pds, did: identity.did) {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Save the .car file instead", systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(.aturiSecondary)
                    .accessibilityHint("Opens outside the app")
                }
                Text("The export is every record in the repository in one file, which can run to many megabytes. It is fetched straight from the PDS into this app; up to \(CarFormat.bytes(CarFormat.maxArchiveBytes)) can be opened.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 8)
        }
    }

    private var intro: some View {
        ToolSection("What it shows") {
            VStack(alignment: .leading, spacing: 12) {
                CarIntroItem(
                    term: "The commit",
                    text: "Whose repository this is, when it was last written, and the root of the tree that holds everything else."
                )
                CarIntroItem(
                    term: "Every record",
                    text: "The tree is walked to list each collection and record key, and a record is decoded when it is opened. Any of it can be saved as JSON."
                )
                CarIntroItem(
                    term: "Whether the file is sound",
                    text: "Parts of the tree that are missing, records it lists but does not hold, and, when asked, whether every block still hashes to its address."
                )
                CarIntroItem(
                    term: "What it leaves out",
                    text: "The commit\u{2019}s signature is not verified, and blobs are not in an export: images and video appear as links, not files."
                )
            }
        }
    }
}

/// The stack a page was pushed on, and how deep it was, when it appeared.
private struct CarStackDepth: Equatable {
    let tab: Tab
    let count: Int
}

// MARK: - The open archive

/// What the opened archive holds: its commit, how sound it is, and its records.
private struct CarArchiveSections: View {
    let model: CarInspectorModel
    let archive: CarRepoArchive
    let name: String

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            commitSection
            integritySection
            CarRecordsBrowser(model: model, archive: archive)
        }
    }

    private var commitSection: some View {
        let commit = archive.commit
        let collections = archive.collections.count
        let written = TID.date(from: commit.rev)
        return ToolSection("Commit", detail: name) {
            CarFactLink(label: "Repository", value: commit.did) {
                router.open(.repo(commit.did))
            }
            ToolFactRow(label: "Revision", value: commit.rev.isEmpty ? "none" : commit.rev)
            ToolFactRow(
                label: "Last written",
                value: written.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "The revision is not a timestamp",
                mono: false
            )
            ToolFactRow(label: "Format version", value: String(commit.version))
            ToolFactRow(
                label: "Records",
                value: "\(CarFormat.count(archive.recordCount)) in \(CarFormat.count(collections)) \(collections == 1 ? "collection" : "collections")",
                mono: false
            )
            ToolFactRow(
                label: "Blocks",
                value: "\(CarFormat.count(archive.car.blocks.count)), of which \(CarFormat.count(archive.nodeCount)) are tree nodes",
                mono: false
            )
            ToolFactRow(label: "File size", value: CarFormat.bytes(archive.car.size), mono: false)
            ToolFactRow(label: "Previous commit", value: commit.prev ?? "None named", mono: commit.prev != nil)
            CopyRow(label: "Commit", value: commit.cid)
            CopyRow(label: "Tree root", value: commit.data)
        }
    }

    private var integritySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ToolSection("Integrity") {
                ForEach(model.checks) { check in
                    ToolCheckRow(
                        status: Self.status(check.status),
                        title: check.title,
                        detail: Self.detail(check)
                    )
                }
            }
            if model.isHashing {
                Button("Stop") {
                    model.stopHashes()
                }
                .buttonStyle(.aturiSecondary)
            } else {
                Button {
                    model.checkHashes()
                } label: {
                    Label(isChecked ? "Check hashes again" : "Check block hashes", systemImage: "number")
                }
                .buttonStyle(.aturiSecondary)
            }
        }
    }

    private var isChecked: Bool {
        if case .done = model.hashes { return true }
        return false
    }

    private static func status(_ status: CarCheckStatus) -> ToolCheckStatus {
        switch status {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .info: return .info
        case .pending: return .pending
        }
    }

    private static func detail(_ check: CarArchiveCheck) -> String {
        guard let lines = check.detail, !lines.isEmpty else { return check.summary }
        return ([check.summary] + lines).joined(separator: "\n")
    }
}

/// The records in an opened archive, port of `CarInspectorBrowser.tsx`:
/// the collections, then the chosen collection's record keys, each opening
/// to its JSON in place. On a phone the two columns are stacked.
///
/// Nothing is decoded until it is looked at. The archive holds every key
/// and CID from the tree walk, so the lists are free; a record's block is
/// only read when its row is opened, and the JSON export reads them in
/// batches.
private struct CarRecordsBrowser: View {
    let model: CarInspectorModel
    let archive: CarRepoArchive

    /// Record keys drawn at first, and added by each "Show more".
    private static let page = 200
    /// From this many collections the list gets a filter field.
    private static let filterFrom = 12

    @State private var selected: String?
    @State private var openKey: String?
    @State private var shown = CarRecordsBrowser.page
    @State private var filter = ""

    @Environment(\.aturiTheme) private var theme

    private var collection: CarRepoCollection? {
        let nsid = selected ?? archive.collections.first?.nsid
        return archive.collections.first { $0.nsid == nsid }
    }

    private var listed: [CarRepoCollection] {
        let query = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return archive.collections }
        return archive.collections.filter { $0.nsid.lowercased().contains(query) }
    }

    var body: some View {
        if archive.collections.isEmpty {
            ToolSection("Records") {
                Text("This repository holds no records.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                collectionsSection
                if let collection {
                    recordsSection(collection)
                }
                Text("Blobs are not part of a repository export. An image or video appears here as a link to its CID; the file itself stays on the account\u{2019}s PDS.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var collectionsSection: some View {
        let count = archive.collections.count
        return ToolSection(
            "Records",
            detail: "\(CarFormat.count(archive.recordCount)) in \(CarFormat.count(count)) \(count == 1 ? "collection" : "collections")"
        ) {
            if count >= Self.filterFrom {
                TextField("Filter collections", text: $filter)
                    .font(AturiFont.body)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 10)
                    .frame(minHeight: 40)
                    .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.bottom, 6)
            }
            let rows = listed
            if rows.isEmpty {
                Text("No collection matches.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .padding(.vertical, 6)
            }
            ForEach(rows) { item in
                collectionRow(item)
            }
        }
    }

    private func collectionRow(_ item: CarRepoCollection) -> some View {
        let isSelected = item.nsid == collection?.nsid
        return Button {
            selected = item.nsid
            openKey = nil
            shown = Self.page
        } label: {
            HStack(spacing: 8) {
                Text(item.nsid)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(isSelected ? theme.textAccent : theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text(CarFormat.count(item.rkeys.count))
                    .font(AturiFont.caption)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 8)
            .background(isSelected ? theme.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.nsid), \(item.rkeys.count) records")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func recordsSection(_ collection: CarRepoCollection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(collection.nsid)
                .font(AturiFont.sans(.subheadline, weight: .bold))
                .foregroundStyle(theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            exportBar(collection)
            VStack(alignment: .leading, spacing: 0) {
                let keys = Array(collection.rkeys.prefix(shown))
                ForEach(Array(keys.enumerated()), id: \.offset) { index, rkey in
                    if index > 0 {
                        Divider()
                    }
                    recordRow(collection, index: index, rkey: rkey)
                }
                if collection.rkeys.count > shown {
                    HStack {
                        Text("\(CarFormat.count(shown)) of \(CarFormat.count(collection.rkeys.count)) shown")
                            .font(AturiFont.footnote)
                            .monospacedDigit()
                            .foregroundStyle(theme.textTertiary)
                        Spacer(minLength: 8)
                        Button("Show more") {
                            shown += Self.page
                        }
                        .buttonStyle(.aturiSecondary)
                    }
                    .padding(.top, 10)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardBackground()
        }
    }

    private func exportBar(_ collection: CarRepoCollection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    model.export(.collection(collection.nsid))
                } label: {
                    Label(exportLabel(.collection(collection.nsid), idle: "This collection as JSON"), systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.aturiSecondary)
                Button {
                    model.export(.all)
                } label: {
                    Label(exportLabel(.all, idle: "Everything as JSON"), systemImage: "square.and.arrow.down.on.square")
                }
                .buttonStyle(.aturiSecondary)
            }
            .disabled(model.exporting != nil)
            if let file = model.exportedFile {
                ShareLink(item: file) {
                    Label("Share \(file.lastPathComponent)", systemImage: "square.and.arrow.up")
                        .font(AturiFont.footnote)
                }
            }
            if let note = model.exportNote {
                Text(note)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func exportLabel(_ scope: CarExportScope, idle: String) -> String {
        if let exporting = model.exporting, exporting.scope == scope {
            return exporting.label
        }
        return idle
    }

    @ViewBuilder
    private func recordRow(_ collection: CarRepoCollection, index: Int, rkey: String) -> some View {
        let isOpen = openKey == rkey
        VStack(alignment: .leading, spacing: 8) {
            Button {
                openKey = isOpen ? nil : rkey
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                        .font(.caption)
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 14)
                    Text(rkey)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    if let date = TID.date(from: rkey) {
                        Text(date.formatted(date: .abbreviated, time: .shortened))
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(isOpen ? "Hides the record" : "Shows the record")
            if isOpen {
                CarOpenRecord(archive: archive, collection: collection, index: index)
                    .padding(.bottom, 8)
            }
        }
    }
}

/// One record's JSON, decoded when its row is opened.
private struct CarOpenRecord: View {
    let archive: CarRepoArchive
    let collection: CarRepoCollection
    let index: Int

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let rkey = collection.rkeys[index]
        let cid = collection.cids[index]
        let uri = CarRepo.recordUri(archive, collection: collection, index: index)
        let decoded = Self.decode(archive, cid: cid)
        return VStack(alignment: .leading, spacing: 8) {
            CopyRow(label: "URI", value: uri)
            CopyRow(label: "CID", value: cid)
            switch decoded {
            case .success(let value):
                JSONTreeView(value: value)
                    .padding(10)
                    .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            case .failure(let problem):
                Text(problem.message)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                router.open(.record(repo: archive.commit.did, collection: collection.nsid, rkey: rkey))
            } label: {
                Label("Open the live record", systemImage: "arrow.up.forward.square")
            }
            .buttonStyle(.aturiSecondary)
            .accessibilityHint("The record as its PDS serves it now, which may have changed since this export")
        }
    }

    private static func decode(_ archive: CarRepoArchive, cid: String) -> Result<JSONValue, CarRecordProblem> {
        do {
            guard let value = try CarRepo.readRecord(archive, cid: cid) else {
                return .failure(CarRecordProblem(message: "The tree lists this record, but its data is not in the file."))
            }
            return .success(value)
        } catch let error as CarCBORError {
            return .failure(CarRecordProblem(message: "This record could not be read: \(error.message)."))
        } catch {
            return .failure(CarRecordProblem(message: "This record could not be read: it is not DAG-CBOR."))
        }
    }
}

private struct CarRecordProblem: Error {
    let message: String
}

/// A fact whose value opens a page: a DID that opens its repository.
private struct CarFactLink: View {
    let label: String
    let value: String
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                Text(value)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textAccent)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the repository")
    }
}

/// One term of the intro and what it means.
private struct CarIntroItem: View {
    let term: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(term)
                .font(AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(theme.textPrimary)
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
