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

/// How far a bulk delete has got: records settled (deleted or failed) over
/// the total, so a progress bar advances a chunk at a time.
public struct DeleteProgress: Hashable, Sendable {
    public var done: Int
    public var total: Int

    public init(done: Int, total: Int) {
        self.done = done
        self.total = total
    }

    /// The bar's fill, clamped to [0, 1].
    public var fraction: Double {
        total > 0 ? min(1, Double(done) / Double(total)) : 0
    }

    public var label: String {
        "\(done) / \(total)"
    }

    /// The bar's accessibility label.
    public var accessibilityLabel: String {
        "Deleting \(done) of \(total) records"
    }
}

/// The collection page: one repo's records in one collection, paged from
/// the PDS, searchable over what has been fetched, optionally streaming
/// new commits from Jetstream, and for the repo's owner a selection mode
/// with a paced bulk delete. Port of `CollectionExplorer.tsx`; the delete
/// itself is handed in as a closure (`deleteSelected(via:)`) because the
/// authenticated PDS client, with its token refresh, lives with the app's
/// session layer.
@MainActor
@Observable
public final class CollectionModel {
    /// listRecords' XRPC max. Request the full page on each call so users
    /// see as many records as possible per fetch.
    public static let recordsPerPage = 100
    /// How many records live mode keeps in the list.
    public static let liveWindow = 200
    /// Deletes go out in applyWrites batches of this many.
    public static let applyWritesMax = AuthenticatedPDS.applyWritesMax
    /// While paused for the throttle, re-check the budget on this cadence
    /// so the countdown ticks and a Stop press is picked up within a second.
    public static let throttleTick: TimeInterval = 1

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

    /// Selection mode, for the repo's owner.
    public private(set) var isEditing = false
    /// URIs of the selected records. Selection outlives the search filter:
    /// a row that scrolls out of the filter after it was ticked is still
    /// deleted.
    public private(set) var selection: Set<String> = []
    public private(set) var isDeleting = false
    /// Nil when no delete run is in flight.
    public private(set) var deleteProgress: DeleteProgress?
    /// Seconds until the throttle resumes, while a run is paced-paused.
    /// Nil when actively deleting (or idle).
    public private(set) var deleteWaitSeconds: Int?
    /// What went wrong with the last delete run, in the web's words.
    public private(set) var deleteError: String?

    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let pds: PDSClient
    @ObservationIgnored private let liveSource: CollectionLiveSource
    @ObservationIgnored private let throttle: WriteThrottle
    @ObservationIgnored private let sleep: @Sendable (TimeInterval) async -> Void
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var pageTask: Task<Void, Never>?
    @ObservationIgnored private var liveTask: Task<Void, Never>?
    @ObservationIgnored private var deleteTask: Task<Void, Never>?
    @ObservationIgnored private var closeLive: (@Sendable () -> Void)?
    @ObservationIgnored private var generation = 0
    /// Flipped by `stopDelete()` so the in-flight run bails after its
    /// current batch.
    @ObservationIgnored private var deleteCancelled = false

    /// - Parameters:
    ///   - throttle: the write ledger deletes are paced against; tests pass
    ///     one on a throwaway suite.
    ///   - sleep: how the pacing loop waits; tests pass a no-op.
    public init(
        repo: String,
        collection: String,
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        liveSource: CollectionLiveSource = .jetstream,
        throttle: WriteThrottle? = nil,
        sleep: @escaping @Sendable (TimeInterval) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
        }
    ) {
        self.repo = repo
        self.collection = collection
        self.resolver = resolver ?? (http === HTTPClient.shared ? .shared : IdentityResolver(http: http))
        pds = PDSClient(http: http)
        self.liveSource = liveSource
        self.throttle = throttle ?? WriteThrottle()
        self.sleep = sleep
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

    /// Stop every in-flight read and live mode. A delete run is left to
    /// finish its current batch (`stopDelete()`): a commit already sent
    /// cannot be recalled, and abandoning the bookkeeping mid-batch would
    /// leave the list claiming records the PDS no longer holds.
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        pageTask?.cancel()
        pageTask = nil
        stopLive()
        isLoadingPage = false
    }

    /// A fresh record set invalidates any pending selection. Selection
    /// mode itself stays on: the owner reloading mid-edit is still editing.
    private func resetRecords() {
        replaceRecords([])
        cursor = nil
        done = false
        pageError = nil
        isLoadingPage = false
        selection = []
        deleteProgress = nil
        deleteWaitSeconds = nil
        deleteError = nil
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

    // MARK: Selection mode

    public func startEditing() {
        isEditing = true
    }

    /// Leave selection mode and drop everything about the last delete run.
    public func exitEditing() {
        guard !isDeleting else { return }
        isEditing = false
        selection = []
        deleteProgress = nil
        deleteWaitSeconds = nil
        deleteError = nil
    }

    public func toggleEditing() {
        if isEditing { exitEditing() } else { startEditing() }
    }

    public func isSelected(_ uri: String) -> Bool {
        selection.contains(uri)
    }

    public func toggleSelected(_ uri: String) {
        guard !isDeleting else { return }
        if selection.contains(uri) {
            selection.remove(uri)
        } else {
            selection.insert(uri)
        }
    }

    /// Select-all targets what you can see, so narrowing the list and then
    /// selecting is a way to bulk-delete a subset.
    public func selectAllVisible() {
        guard !isDeleting else { return }
        for row in visibleRows {
            selection.insert(row.uri)
        }
    }

    public func deselectAll() {
        guard !isDeleting else { return }
        selection = []
    }

    /// Every visible row is ticked (and there is at least one).
    public var allVisibleSelected: Bool {
        let visible = visibleRows
        return !visible.isEmpty && visible.allSatisfy { selection.contains($0.uri) }
    }

    /// The "N selected" count.
    public var selectedCount: Int {
        selection.count
    }

    /// Whether confirming this delete will hit the throttle and pace
    /// partway: the selection is bigger than the write budget left this
    /// hour. Drives the heads-up in the confirm step so a big delete is not
    /// a surprise.
    public var willPace: Bool {
        guard let bundle = identity.value, !isDeleting else { return false }
        return selection.count > throttle.pointsAvailable(bundle.did)
    }

    /// The confirm step's question, with the pacing heads-up when it applies.
    public var deleteConfirmationMessage: String {
        let count = selection.count
        var text = "Delete \(count) record\(count == 1 ? "" : "s")? This cannot be undone."
        if willPace {
            text += " Aturi will pace this under Bluesky\u{2019}s ~\(JetstreamModel.grouped(WriteThrottle.hourlyPointBudget))/hour write limit, so it may pause partway."
        }
        return text
    }

    /// The status line beside the progress bar.
    public var deleteStatusLabel: String? {
        guard isDeleting else { return nil }
        if let wait = deleteWaitSeconds {
            return "Paced under the rate limit, resuming in \(wait)s"
        }
        return "Deleting\u{2026}"
    }

    // MARK: Bulk delete

    /// Stop an in-flight delete after the current batch. Whatever has not
    /// been deleted stays selected.
    public func stopDelete() {
        deleteCancelled = true
    }

    /// Delete the selected records in atomic applyWrites batches, paced
    /// under the write budget. `deleteBatch` performs one
    /// `com.atproto.repo.applyWrites` for the rkeys it is given (at most
    /// `applyWritesMax`); a throw means none of that batch was deleted.
    /// Nil when there is nothing to delete or a run is already in flight.
    ///
    /// Records that were deleted leave the list; the rest stay selected
    /// with `deleteError` saying why, so the visitor can retry. A run that
    /// deletes everything leaves selection mode.
    @discardableResult
    public func deleteSelected(
        via deleteBatch: @escaping @Sendable ([String]) async throws -> Void
    ) -> Task<Void, Never>? {
        guard !isDeleting, let bundle = identity.value else { return nil }
        let selectedNow = selection
        let targets = records.filter { selectedNow.contains($0.uri) }.map(\.uri)
        guard !targets.isEmpty else { return nil }

        // Resolve each URI to its rkey up front. A URI with no decodable
        // rkey cannot be deleted, so it is counted as failed without
        // spending a request.
        var failed = Set<String>()
        var deletable: [(uri: String, rkey: String)] = []
        for uri in targets {
            if let rkey = rkeyFromAtUri(uri), !rkey.isEmpty {
                deletable.append((uri, rkey))
            } else {
                failed.insert(uri)
            }
        }
        let chunks = stride(from: 0, to: deletable.count, by: Self.applyWritesMax).map {
            Array(deletable[$0..<min($0 + Self.applyWritesMax, deletable.count)])
        }

        deleteCancelled = false
        isDeleting = true
        deleteError = nil
        deleteWaitSeconds = nil
        // Undecodable rows are already settled, so seed the bar with them.
        var processed = failed.count
        deleteProgress = DeleteProgress(done: processed, total: targets.count)

        let did = bundle.did
        let task = Task { [weak self] in
            guard let self else { return }
            var firstError: String?
            // Set once a 429 halts the run. Staying false means no rate
            // limit was hit.
            var rateLimited = false
            // First chunk we did NOT attempt (a Stop or a 429), so the rest
            // can be swept back into the selection.
            var stopIndex = chunks.count

            for (index, chunk) in chunks.enumerated() {
                // Pace against the write budget so we never trip the PDS
                // limit: wait until spending this batch stays under it,
                // ticking the countdown and watching for Stop. A fresh
                // hourly budget means no wait at all.
                var paused = false
                while !self.deleteCancelled {
                    let wait = self.throttle.secondsUntilBudget(did, needed: chunk.count)
                    if wait <= 0 { break }
                    paused = true
                    self.deleteWaitSeconds = Int(wait.rounded(.up))
                    await self.sleep(min(wait, Self.throttleTick))
                }
                if paused {
                    self.deleteWaitSeconds = nil
                }
                if self.deleteCancelled {
                    stopIndex = index
                    break
                }

                // Reserve the points before sending; on failure the
                // reservation is kept (staying conservative) rather than
                // risk under-counting.
                self.throttle.recordSpend(did, points: chunk.count * WriteThrottle.deletePointCost)
                do {
                    try await deleteBatch(chunk.map(\.rkey))
                } catch {
                    // A batch is atomic: a failed commit deleted none of
                    // its records, so keep the whole chunk selected.
                    for job in chunk {
                        failed.insert(job.uri)
                    }
                    if let http = error as? HTTPError, http.status == 429 {
                        // 429 despite pacing: usually writes from elsewhere
                        // spent the budget. Stop cleanly and leave the rest
                        // selected to resume later.
                        rateLimited = true
                        processed += chunk.count
                        self.deleteProgress = DeleteProgress(done: processed, total: targets.count)
                        stopIndex = index + 1
                        break
                    }
                    if firstError == nil {
                        firstError = ExploreErrorText.describe(error)
                    }
                }
                processed += chunk.count
                self.deleteProgress = DeleteProgress(done: processed, total: targets.count)
            }

            // Sweep any chunks we did not attempt (Stop or 429) back into
            // the selection.
            for chunk in chunks.dropFirst(stopIndex) {
                for job in chunk {
                    failed.insert(job.uri)
                }
            }
            let cancelled = self.deleteCancelled
            self.finishDelete(
                targets: targets,
                failed: failed,
                rateLimited: rateLimited,
                cancelled: cancelled,
                firstError: firstError
            )
        }
        deleteTask = task
        return task
    }

    private func finishDelete(
        targets: [String],
        failed: Set<String>,
        rateLimited: Bool,
        cancelled: Bool,
        firstError: String?
    ) {
        let targetSet = Set(targets)
        // Drop the records we deleted; keep any that failed so the visitor
        // can see what is left and retry.
        replaceRecords(records.filter { !targetSet.contains($0.uri) || failed.contains($0.uri) })
        isDeleting = false
        deleteProgress = nil
        deleteWaitSeconds = nil
        deleteTask = nil
        if failed.isEmpty {
            exitEditing()
        } else {
            selection = failed
            let deleted = targets.count - failed.count
            if rateLimited {
                deleteError = "Hit your PDS\u{2019}s write rate limit after \(deleted) of \(targets.count). \(failed.count) still selected. Try again in a bit."
            } else if cancelled {
                deleteError = "Stopped after \(deleted) of \(targets.count). \(failed.count) still selected."
            } else {
                let plural = targets.count == 1 ? "" : "s"
                deleteError = "Couldn\u{2019}t delete \(failed.count) of \(targets.count) record\(plural).\(firstError.map { " \($0)" } ?? "")"
            }
        }
        // If the delete emptied the loaded set while the PDS still has
        // more pages, pull the next page instead of flashing a false "No
        // records" state. The cursor sits at the end of what was fetched,
        // so deleting earlier rows never invalidates it.
        if records.isEmpty, !done, cursor != nil, pageError == nil {
            loadMore()
        }
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
        /* Not while the visitor is mid-selection either: they may have just
           deleted the rest and still be working in the list. */
        guard done, !isLoadingPage, !isLive, !isEditing, records.count == 1 else { return nil }
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
