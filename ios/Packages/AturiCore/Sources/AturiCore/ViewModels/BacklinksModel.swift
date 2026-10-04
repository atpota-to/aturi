import Foundation
import Observation

// Port of src/components/explore/tabs/BacklinksTab.tsx: the inbound-link
// panel the repo screen mounts as a tab (target = DID) and the record
// screen mounts as a featured card with a count header (target = at://
// URI). The three states the web keeps in one variable (`undefined` still
// loading, `null` constellation unavailable, `[]` nothing links here) are
// `Loadable.loading`, `.failed` and `.loaded([])`.
//
// Each source opens into its own paged list of linking records, 25 at a
// time, exactly as `BacklinkRecords` pages them. Constellation only hands
// back link coordinates, so once a page lands the rows are hydrated
// through Slingshot (the record content, for a one-line preview) and the
// linking DIDs are labelled with their handles (the "identity labels" the
// web resolves through the same edge). Hydration is best effort: a row
// renders the moment its coordinates arrive and fills in behind.

/// One source's list of linking records and where its pagination stands.
public struct BacklinkRecordsPage: Hashable, Sendable {
    public var records: [BacklinkRecord]
    public var cursor: String?
    /// No further page: the index sent no cursor, an empty batch, or an
    /// error.
    public var isDone: Bool
    public var isLoading: Bool
    /// The last request failed; the web shows "Couldn't load linking
    /// records" in place of the list.
    public var errored: Bool

    public init(
        records: [BacklinkRecord] = [],
        cursor: String? = nil,
        isDone: Bool = false,
        isLoading: Bool = true,
        errored: Bool = false
    ) {
        self.records = records
        self.cursor = cursor
        self.isDone = isDone
        self.isLoading = isLoading
        self.errored = errored
    }

    /// `!done && records.length > 0`: whether the "Load more" control shows.
    public var canLoadMore: Bool {
        !isDone && !records.isEmpty
    }
}

/// One row of an opened source: the link coordinates plus whatever
/// hydration has filled in so far.
public struct BacklinkRow: Hashable, Sendable, Identifiable {
    public var record: BacklinkRecord
    /// The linking account's handle, once Slingshot has answered for it.
    public var handle: String?
    /// The linking record's content, once Slingshot has answered for it.
    public var hydrated: FetchedRecord?

    public init(record: BacklinkRecord, handle: String? = nil, hydrated: FetchedRecord? = nil) {
        self.record = record
        self.handle = handle
        self.hydrated = hydrated
    }

    public var id: String { record.atUri }
    public var atUri: String { record.atUri }
    public var did: String { record.did }
    public var rkey: String { record.rkey }

    /// The web's left column: `shortDid(r.did)`.
    public var shortDid: String {
        AturiCore.shortDid(record.did)
    }

    /// "@handle" once the identity label resolved, the shortened DID until
    /// then (and forever, for a DID whose document names no handle).
    public var label: String {
        if let handle, !handle.isEmpty { return "@" + handle }
        return shortDid
    }

    /// A one-line preview of the linking record, nil until hydrated or
    /// when the record has nothing previewable.
    public var preview: String? {
        guard let hydrated else { return nil }
        let text = RecordPreview.previewFor(hydrated.value)
        return text.isEmpty ? nil : text
    }
}

@MainActor
@Observable
public final class BacklinksModel {
    /// `limit: 25` in `BacklinkRecords.loadPage`.
    public nonisolated static let pageSize = 25
    /// Identity labels are resolved a few at a time, the width the web's
    /// author resolver uses against Slingshot.
    public nonisolated static let labelConcurrency = 6
    /// Where the "constellation" and "Microcosm" links in the panel point.
    public nonisolated static let constellationURL = URL(string: "https://constellation.microcosm.blue")!
    public nonisolated static let microcosmURL = URL(string: "https://www.microcosm.blue")!

    // Copy, verbatim from the component.
    public nonisolated static let unavailableMessage = "Backlinks unavailable (constellation)."
    /// The tab's empty state.
    public nonisolated static let emptyMessage = "No backlinks found."
    /// The card's empty state.
    public nonisolated static let emptySummaryMessage = "Nothing references this record yet."
    public nonisolated static let recordsErrorMessage = "Couldn\u{2019}t load linking records."
    public nonisolated static let noRecordsMessage = "No linking records to show."
    public nonisolated static let loadingMessage = "Loading\u{2026}"
    public nonisolated static let loadMoreLabel = "Load more"

    /// The DID or AT URI the panel is about.
    public private(set) var target: String
    /// The flattened, count-sorted source list. `failed` is the index being
    /// unreachable; `loaded([])` is a real "nothing links here".
    public private(set) var sources: Loadable<[BacklinkSource]> = .idle
    /// The one source whose records are expanded (`open` on the web).
    public private(set) var openSource: String?
    /// Paged records per source, keyed by `BacklinkSource.source`. A page
    /// stays cached when its source is collapsed, so reopening does not
    /// refetch (the web unmounts and refetches; the list is the same).
    public private(set) var pages: [String: BacklinkRecordsPage] = [:]
    /// Slingshot record content keyed by AT URI.
    public private(set) var hydratedRecords: [String: FetchedRecord] = [:]
    /// Resolved handles keyed by DID. A DID Slingshot could not label is
    /// simply absent.
    public private(set) var handles: [String: String] = [:]
    /// Whether opened pages are hydrated through Slingshot at all. Off for
    /// surfaces that only want the coordinates (or tests of the paging).
    public let hydrates: Bool

    @ObservationIgnored private let constellation: ConstellationClient
    @ObservationIgnored private let slingshot: SlingshotClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var pageTasks: [String: Task<Void, Never>] = [:]
    /// DIDs already asked about, so a second page full of the same
    /// accounts costs nothing.
    @ObservationIgnored private var labelAttempts: Set<String> = []

    /// - Parameters:
    ///   - target: the DID or AT URI; `load()` fetches it. Empty until
    ///     `load(target:)` when the owner does not know it yet.
    ///   - http: the transport every Constellation and Slingshot call goes
    ///     through, injectable for tests.
    ///   - hydrates: see `hydrates`.
    public init(target: String = "", http: HTTPClient = .shared, hydrates: Bool = true) {
        self.target = target
        self.constellation = ConstellationClient(http: http)
        self.slingshot = SlingshotClient(http: http)
        self.hydrates = hydrates
    }

    // MARK: Loading

    /// Fetch the source list for the current target, dropping every open
    /// page and any load in flight.
    public func load() {
        load(target: target)
    }

    /// Point the panel at a new target and fetch its sources.
    public func load(target: String) {
        loadTask?.cancel()
        loadTask = nil
        cancelPages()
        self.target = target
        openSource = nil
        pages = [:]
        hydratedRecords = [:]
        handles = [:]
        labelAttempts = []
        guard !target.isEmpty else {
            sources = .idle
            return
        }
        sources = .loading
        loadTask = Task { [weak self] in
            await self?.fetchSources(target)
        }
    }

    /// The retry affordance: same target again.
    public func reload() {
        load(target: target)
    }

    /// `load` and wait for the source list to settle.
    public func loadAndWait(target: String) async {
        load(target: target)
        await loadTask?.value
    }

    /// Wait for the source list in flight, if any.
    public func awaitLoad() async {
        await loadTask?.value
    }

    /// Wait for a source's page (and its hydration) in flight, if any.
    public func awaitPage(for source: String) async {
        await pageTasks[source]?.value
    }

    /// Cancel everything in flight (screen leaving).
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        cancelPages()
    }

    private func cancelPages() {
        for task in pageTasks.values { task.cancel() }
        pageTasks = [:]
    }

    private func fetchSources(_ target: String) async {
        let result = await constellation.sources(for: target)
        guard !Task.isCancelled else { return }
        if let result {
            sources = .loaded(result)
        } else {
            sources = .failed(BacklinksModel.unavailableMessage)
        }
    }

    // MARK: Summary

    /// The source list, empty until loaded.
    public var sourceList: [BacklinkSource] {
        sources.value ?? []
    }

    /// The card header's numbers, nil until the list is loaded.
    public var totals: BacklinkTotals? {
        sources.value.map(ConstellationClient.totals(of:))
    }

    public var isUnavailable: Bool {
        sources.isFailed
    }

    /// Loaded and empty: the "nothing references this" states.
    public var isEmpty: Bool {
        sources.value?.isEmpty ?? false
    }

    /// The big number in the card header: the total backlink count with
    /// thousands separators, or a dash while the list is not loaded.
    public var countText: String {
        guard let totals else { return "\u{2014}" }
        return BacklinksModel.grouped(totals.records)
    }

    /// The line beside the count, one of the five the header prints:
    /// "loading…", "unavailable", "no records reference this yet", or
    /// "across N sources · from M accounts" (the accounts clause only when
    /// some source reported distinct DIDs).
    public var summaryText: String {
        switch sources {
        case .idle, .loading:
            return "loading\u{2026}"
        case .failed:
            return "unavailable"
        case .loaded(let list):
            if list.isEmpty { return "no records reference this yet" }
            let totals = ConstellationClient.totals(of: list)
            var text = "across \(totals.sources) \(totals.sources == 1 ? "source" : "sources")"
            if let accounts = totals.accounts {
                text += " \u{00B7} from \(BacklinksModel.grouped(accounts)) \(accounts == 1 ? "account" : "accounts")"
            }
            return text
        }
    }

    /// The abbreviated per-source figures ("2.4k backlinks", "312 accounts").
    public nonisolated static func compactCount(_ n: Int) -> String {
        UFOsFormat.formatCount(n)
    }

    // MARK: Per-source records

    public func isOpen(_ source: String) -> Bool {
        openSource == source
    }

    /// The row's chevron: open this source (closing any other) or close it.
    public func toggle(source: String) {
        if openSource == source {
            close()
        } else {
            open(source: source)
        }
    }

    /// Expand a source, fetching its first page unless it is already cached.
    public func open(source: String) {
        openSource = source
        if pages[source] == nil {
            loadPage(source: source, after: nil)
        }
    }

    public func close() {
        openSource = nil
    }

    /// The "Load more" button: the next page for a source that has one.
    public func loadMore(source: String) {
        guard let page = pages[source], page.canLoadMore, !page.isLoading else { return }
        loadPage(source: source, after: page.cursor)
    }

    /// The rows of a source's opened list, hydration applied.
    public func rows(for source: String) -> [BacklinkRow] {
        guard let page = pages[source] else { return [] }
        return page.records.map { record in
            BacklinkRow(record: record, handle: handles[record.did], hydrated: hydratedRecords[record.atUri])
        }
    }

    /// The handle a linking DID resolved to, if any.
    public func label(for did: String) -> String? {
        handles[did]
    }

    private func loadPage(source: String, after cursor: String?) {
        var page = pages[source] ?? BacklinkRecordsPage()
        page.isLoading = true
        pages[source] = page
        let target = self.target
        pageTasks[source] = Task { [weak self] in
            await self?.fetchPage(target: target, source: source, after: cursor)
        }
    }

    private func fetchPage(target: String, source: String, after cursor: String?) async {
        let response = await constellation.getBacklinks(
            target: target,
            source: source,
            limit: BacklinksModel.pageSize,
            cursor: cursor
        )
        guard !Task.isCancelled, var page = pages[source] else { return }
        guard let response else {
            page.errored = true
            page.isLoading = false
            page.isDone = true
            pages[source] = page
            return
        }
        let batch = response.backlinks
        page.records = cursor == nil ? batch : page.records + batch
        page.cursor = response.cursor.flatMap { $0.isEmpty ? nil : $0 }
        if page.cursor == nil || batch.isEmpty {
            page.isDone = true
        }
        page.isLoading = false
        pages[source] = page
        if hydrates, !batch.isEmpty {
            await hydrate(batch)
        }
    }

    /// Fill in record content and identity labels for a freshly landed
    /// batch. Both lookups run together; the page has already been
    /// published, so a slow edge only delays the previews, never the rows.
    private func hydrate(_ batch: [BacklinkRecord]) async {
        let uris = batch.map(\.atUri).filter { hydratedRecords[$0] == nil }
        let dids = Set(batch.map(\.did)).subtracting(labelAttempts).sorted()
        labelAttempts.formUnion(dids)
        let slingshot = self.slingshot
        async let recordLookup = slingshot.getRecordsByUris(uris)
        async let docLookup = BacklinksModel.resolveLabels(dids, slingshot: slingshot)
        let (records, docs) = await (recordLookup, docLookup)
        guard !Task.isCancelled else { return }
        hydratedRecords.merge(records) { _, fresh in fresh }
        for (index, doc) in docs.enumerated() {
            if let handle = doc?.handle, !handle.isEmpty {
                handles[dids[index]] = handle
            }
        }
    }

    /// One mini-doc per DID, in input order, a few at a time.
    private nonisolated static func resolveLabels(_ dids: [String], slingshot: SlingshotClient) async -> [MiniDoc?] {
        guard !dids.isEmpty else { return [] }
        let docs = try? await SlingshotClient.mapWithConcurrency(dids, limit: labelConcurrency) { did, _ in
            await slingshot.resolveMiniDoc(did)
        }
        return docs ?? []
    }

    /// `toLocaleString()` as an English reader sees it: thousands grouped
    /// with commas. Deterministic so the header reads the same in tests and
    /// on device; a screen that wants locale grouping has `totals`.
    private nonisolated static func grouped(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, character) in digits.enumerated() {
            let remaining = digits.count - index
            if index > 0, remaining % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return n < 0 ? "-" + out : out
    }
}
