import Foundation
import Observation

/// One record row in a collection listing: the rkey, the timestamp decoded
/// from it when it is a TID (no extra PDS call), and a one-line preview of
/// the value. Port of `CollectionRecordRow.tsx` minus the layout.
public struct CollectionRow: Hashable, Sendable, Identifiable {
    public var id: String { uri }
    public let uri: String
    public let cid: String
    public let rkey: String
    /// Nil for non-TID rkeys (custom strings, singletons like "self").
    public let tidDate: Date?
    public let preview: String
    public let value: JSONValue
    /// The lowercased rkey plus the whole JSON body, so a search finds
    /// records by content and not just by key.
    public let searchText: String

    public init(record: AtRecord) {
        uri = record.uri
        cid = record.cid
        value = record.value
        rkey = rkeyFromAtUri(record.uri) ?? ""
        tidDate = TID.date(from: rkey)
        preview = RecordPreview.previewFor(record.value)
        searchText = "\(rkey)\n\(record.value.compactString())".lowercased()
    }

    public func relativeTime(now: Date = Date()) -> String? {
        tidDate.map { TID.formatRelative($0, now: now) }
    }

    public var isoTimestamp: String? {
        tidDate.map(Formatting.isoTimestamp)
    }

    /// The record page path, rkey percent-encoded like `encodeURIComponent`.
    public func explorePath(repoSegment: String, collection: String) -> String {
        "/explore/\(repoSegment)/\(collection)/\(URIEncoding.encodeComponent(rkey))"
    }
}

/// Where live commits come from, so tests can feed the model without a
/// socket. The default opens a `JetstreamClient`.
public struct CollectionLiveSource: Sendable {
    public typealias Subscription = (commits: AsyncStream<JetstreamCommit>, close: @Sendable () -> Void)

    public var open: @Sendable (JetstreamOptions) -> Subscription

    public init(open: @escaping @Sendable (JetstreamOptions) -> Subscription) {
        self.open = open
    }

    public static let jetstream = CollectionLiveSource { options in
        let client = JetstreamClient(options: options)
        return (client.commits, { client.cancel() })
    }
}

/// The collection page: one repo's records in one collection, paged from
/// the PDS, searchable over what has been fetched, optionally streaming
/// new commits from Jetstream. Port of the read side of
/// `CollectionExplorer.tsx`; the owner's bulk delete needs an authenticated
/// agent and lives with the app's session layer.
@MainActor
@Observable
public final class CollectionModel {
    /// listRecords' XRPC max. Request the full page on each call so users
    /// see as many records as possible per fetch.
    public static let recordsPerPage = 100
    /// How many records live mode keeps in the list.
    public static let liveWindow = 200

    public let repo: String
    public let collection: String

    public private(set) var identity: Loadable<IdentityBundle> = .idle
    public private(set) var records: [AtRecord] = []
    public private(set) var rows: [CollectionRow] = []
    public private(set) var cursor: String?
    /// No more pages: the PDS sent no cursor, or a partial page, which is a
    /// strong signal it has nothing left even when a cursor came with it.
    public private(set) var done = false
    public private(set) var isLoadingPage = false
    public private(set) var pageError: String?
    /// Oldest first when set. Changing it refetches from the start.
    public private(set) var reverse = false
    public private(set) var isLive = false

    /// Client-side search over the records fetched so far.
    public var filter = ""

    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let pds: PDSClient
    @ObservationIgnored private let liveSource: CollectionLiveSource
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var pageTask: Task<Void, Never>?
    @ObservationIgnored private var liveTask: Task<Void, Never>?
    @ObservationIgnored private var closeLive: (@Sendable () -> Void)?
    @ObservationIgnored private var generation = 0

    public init(
        repo: String,
        collection: String,
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        liveSource: CollectionLiveSource = .jetstream
    ) {
        self.repo = repo
        self.collection = collection
        self.resolver = resolver ?? (http === HTTPClient.shared ? .shared : IdentityResolver(http: http))
        pds = PDSClient(http: http)
        self.liveSource = liveSource
    }

    // MARK: Loading

    /// Resolve the repo and fetch the first page. Cancels anything in
    /// flight, including live mode, and clears the list and the filter: a
    /// query typed against one record set means nothing in the next.
    @discardableResult
    public func load() -> Task<Void, Never> {
        cancel()
        generation += 1
        let gen = generation
        identity = .loading
        resetRecords()
        filter = ""
        let task = Task { [weak self] in
            guard let self else { return }
            let bundle: IdentityBundle
            do {
                bundle = try await self.resolver.resolveIdentifier(self.repo)
            } catch {
                guard gen == self.generation, !Task.isCancelled else { return }
                self.identity = .failed(ExploreErrorText.describe(error))
                return
            }
            guard gen == self.generation, !Task.isCancelled else { return }
            self.identity = .loaded(bundle)
            await self.loadPage(after: nil, bundle: bundle, generation: gen)
        }
        loadTask = task
        return task
    }

    /// Fetch the next page (or retry the current one after an error).
    /// Nil when there is nothing to do: no identity yet, exhausted, or a
    /// page already in flight.
    @discardableResult
    public func loadMore() -> Task<Void, Never>? {
        guard let bundle = identity.value, !done, !isLoadingPage else { return nil }
        let after = cursor
        let gen = generation
        isLoadingPage = true
        let task = Task { [weak self] in
            _ = await self?.loadPage(after: after, bundle: bundle, generation: gen)
        }
        pageTask = task
        return task
    }

    /// Flip the listing order and refetch from the start. The filter is
    /// kept: the record set is the same, just walked the other way.
    @discardableResult
    public func setReverse(_ value: Bool) -> Task<Void, Never>? {
        guard value != reverse else { return nil }
        reverse = value
        guard let bundle = identity.value else { return nil }
        loadTask?.cancel()
        pageTask?.cancel()
        generation += 1
        let gen = generation
        resetRecords()
        isLoadingPage = true
        let task = Task { [weak self] in
            _ = await self?.loadPage(after: nil, bundle: bundle, generation: gen)
        }
        pageTask = task
        return task
    }

    /// Stop every in-flight read and live mode.
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        pageTask?.cancel()
        pageTask = nil
        stopLive()
        isLoadingPage = false
    }

    private func resetRecords() {
        replaceRecords([])
        cursor = nil
        done = false
        pageError = nil
        isLoadingPage = false
    }

    private func replaceRecords(_ next: [AtRecord]) {
        records = next
        rows = next.map(CollectionRow.init(record:))
    }

    private func loadPage(after: String?, bundle: IdentityBundle, generation gen: Int) async {
        isLoadingPage = true
        pageError = nil
        do {
            let page = try await pds.listRecordsPage(
                pds: bundle.pds,
                repo: bundle.did,
                collection: collection,
                limit: Self.recordsPerPage,
                cursor: after,
                reverse: reverse
            )
            guard gen == generation, !Task.isCancelled else { return }
            let batch = page.records
            replaceRecords(after == nil ? batch : records + batch)
            let next = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            cursor = next
            if next == nil || batch.count < Self.recordsPerPage {
                done = true
            }
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            pageError = ExploreErrorText.describe(error)
        }
        isLoadingPage = false
    }

    // MARK: Live mode

    /// Subscribe to new commits for this repo and collection and prepend
    /// them as they arrive. Needs the identity: the subscription is keyed
    /// by DID.
    public func startLive() {
        guard !isLive, let bundle = identity.value else { return }
        isLive = true
        let options = JetstreamOptions(wantedCollections: [collection], wantedDids: [bundle.did])
        let subscription = liveSource.open(options)
        closeLive = subscription.close
        liveTask = Task { [weak self] in
            for await commit in subscription.commits {
                guard let self, !Task.isCancelled else { break }
                self.insertLive(commit)
            }
        }
    }

    public func stopLive() {
        isLive = false
        liveTask?.cancel()
        liveTask = nil
        closeLive?()
        closeLive = nil
    }

    public func toggleLive() {
        if isLive { stopLive() } else { startLive() }
    }

    /// Prepend a live commit, ignoring anything for another repo or
    /// collection and anything already listed, and keep the list within
    /// `liveWindow`.
    public func insertLive(_ commit: JetstreamCommit) {
        guard let bundle = identity.value,
            commit.commit.collection == collection,
            commit.did == bundle.did
        else { return }
        let uri = commit.atUri
        guard !records.contains(where: { $0.uri == uri }) else { return }
        let record = AtRecord(uri: uri, cid: commit.commit.cid ?? "", value: commit.commit.record ?? .object([:]))
        replaceRecords(Array(([record] + records).prefix(Self.liveWindow)))
    }

    // MARK: Derived

    private var query: String {
        filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public var visibleRows: [CollectionRow] {
        let needle = query
        return needle.isEmpty ? rows : rows.filter { $0.searchText.contains(needle) }
    }

    /// Show the row skeleton only while the collection could still turn out
    /// to have records; once `done` lands with nothing, the empty state is
    /// the truth and a skeleton would be a lie about what is coming.
    public var awaitingFirstPage: Bool {
        records.isEmpty && !done && pageError == nil
    }

    /// Only claim the collection is empty once it has been exhausted.
    public var isEmpty: Bool {
        records.isEmpty && done && pageError == nil
    }

    /// The Fetch button's visibility.
    public var canLoadMore: Bool {
        !done && !records.isEmpty
    }

    /// A search only sees what has been fetched, so when it comes up empty
    /// and pages remain, say so.
    public var noMatchMessage: String? {
        guard !records.isEmpty, visibleRows.isEmpty else { return nil }
        let base = "No loaded records match \(filter.trimmingCharacters(in: .whitespacesAndNewlines))."
        return done ? base : base + " Fetch more to search further."
    }

    /// The count beside the controls: "Loading…", "12 of 1.2k" while
    /// searching, else "1.2k records".
    public var countLabel: String {
        if records.isEmpty, !done { return "Loading…" }
        let total = Self.formatCount(records.count)
        if !query.isEmpty {
            return "\(Self.formatCount(visibleRows.count)) of \(total)"
        }
        return "\(total) record\(records.count == 1 ? "" : "s")"
    }

    /// The chrome bar's status: nil before anything loaded, "shown/total"
    /// while searching, else the total with a `+` while pages remain.
    public var searchStatusLabel: String? {
        guard !records.isEmpty else { return nil }
        if !query.isEmpty {
            return "\(Self.formatCount(visibleRows.count))/\(Self.formatCount(records.count))"
        }
        return "\(Self.formatCount(records.count))\(done ? "" : "+")"
    }

    /// Collections with exactly one record are usually singletons
    /// (actor.profile, settings docs); the web jumps straight to the record
    /// page. Set once the list has settled on one record and the visitor
    /// is not streaming, so the app can navigate.
    public var singleRecordRkey: String? {
        guard done, !isLoadingPage, !isLive, records.count == 1 else { return nil }
        return rkeyFromAtUri(records[0].uri)
    }

    public var repoSegment: String {
        identity.value.map { encodeRepo($0.handle ?? $0.did) } ?? encodeRepo(repo)
    }

    /// No universal link route for collections; share the explorer URL.
    public var sharePath: String {
        "/explore/\(repoSegment)/\(collection)"
    }

    /// The not-found panel body when the repo did not resolve.
    public var notFoundMessage: String? {
        identity.errorMessage.map {
            "We tried to resolve \"\(repo)\" and the AT Protocol resolver returned: \($0). Try another handle, DID, or AT URI below."
        }
    }

    /// Compact record count once a repo has paged in a lot of rows:
    /// 1000 -> "1k", 1400 -> "1.4k", 12300 -> "12.3k", 1_000_000 -> "1m".
    /// Counts under 1k render verbatim. Port of `formatCount` in
    /// `collectionListHelpers.ts`, which lowercases `Intl.NumberFormat`'s
    /// compact notation; rounding is half away from zero like Intl's
    /// default, and a value that rounds up to the next unit moves to it.
    public static func formatCount(_ n: Int) -> String {
        if n < 1000 { return String(n) }
        let suffixes = ["k", "m", "b", "t"]
        var value = Double(n)
        var unit = -1
        while value >= 1000, unit < suffixes.count - 1 {
            value /= 1000
            unit += 1
        }
        var tenths = Int((value * 10).rounded(.toNearestOrAwayFromZero))
        if tenths >= 10_000, unit < suffixes.count - 1 {
            unit += 1
            tenths = Int((Double(tenths) / 1000).rounded(.toNearestOrAwayFromZero))
        }
        let whole = tenths / 10
        let fraction = tenths % 10
        let number = fraction == 0 ? String(whole) : "\(whole).\(fraction)"
        return number + suffixes[unit]
    }
}
