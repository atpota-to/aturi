import Foundation
import Observation

// Port of the state behind the lexicons explorer:
// src/components/explore/TrendingLexicons.tsx (the Trending / Top strip),
// src/components/explore/lexicons/LexiconsExplorer.tsx (the page frame and
// its freshness footnote), LexiconSearchBox.tsx (the debounced typeahead),
// BrowseAllLexicons.tsx (the full catalog), LexiconGroup.tsx (a namespace
// or a search term) and LexiconDetail.tsx (one NSID). Three models, one per
// screen: `LexiconsModel` for the explorer, `LexiconGroupModel` and
// `LexiconDetailModel` for the two pushed pages. None of them navigates:
// the search box and the rows hand back a `SearchDestination` for the app's
// router, which is the `router.push(path)` the web performs.
//
// Every fetch goes through `UFOsClient`, which answers `failed` instead of
// throwing. The web's strip and catalog already turn that into an error
// panel ("Couldn't reach the UFOs API"); the group and detail pages could
// not tell an outage from an empty answer and rendered "nothing published",
// which the Swift client lets these models avoid.

// MARK: - Ranking strip (TrendingLexicons.tsx)

/// `Mode`: Trending ranks by percent change against the prior window, Top
/// by the absolute metric value.
public enum LexiconRankingMode: String, CaseIterable, Hashable, Sendable {
    case trending, top

    /// The segmented control's label.
    public var label: String {
        switch self {
        case .trending: return "Trending"
        case .top: return "Top"
        }
    }

    /// The strip's heading.
    public var title: String {
        switch self {
        case .trending: return "Trending lexicons"
        case .top: return "Top lexicons"
        }
    }
}

/// One row of the strip. Port of `CollectionRow` in TrendingLexicons.tsx.
public struct LexiconRankingRow: Hashable, Sendable, Identifiable {
    public var id: String { nsid }
    public let nsid: String
    /// The metric value in the current window, what Top mode displays.
    public let value: Int
    /// The metric per bucket over the window, for the sparkline.
    public let series: [Int]
    /// Percent change against the prior window; nil when the prior window
    /// is zero or unknown. Top mode never computes one.
    public let deltaPct: Double?

    public init(nsid: String, value: Int, series: [Int], deltaPct: Double? = nil) {
        self.nsid = nsid
        self.value = value
        self.series = series
        self.deltaPct = deltaPct
    }

    /// The top-2-segment namespace, stacked over `namespaceTail` on
    /// narrow screens so the whole NSID stays readable.
    public var namespaceHead: String { NSID.splitNsid(nsid).head }
    public var namespaceTail: String { NSID.splitNsid(nsid).tail }

    /// Where the row links: the publisher's schema record.
    public var schemaPath: String { NSID.schemaPathFor(nsid) }
    public var lexiconPath: String { NSID.lexiconPathFor(nsid) }

    public var valueLabel: String { UFOsFormat.formatCount(value) }
    public var deltaLabel: String? { deltaPct.map(UFOsFormat.formatPct) }
}

/// `View` in BrowseAllLexicons.tsx: a ranked pool or the whole catalog.
public enum LexiconBrowseView: String, CaseIterable, Hashable, Sendable {
    case top, all

    public var label: String {
        switch self {
        case .top: return "Top"
        case .all: return "All"
        }
    }
}

/// The lexicons explorer page: the Trending / Top strip, the search box,
/// the full-catalog browser and the freshness footnote.
@MainActor
@Observable
public final class LexiconsModel {
    /// `RESULT_COUNT` / `EXPANDED_COUNT`: rows shown collapsed and after
    /// "Show more".
    public nonisolated static let resultCount = 10
    public nonisolated static let expandedCount = 20
    /// Pull more candidates than will be displayed so the filter (drop
    /// app.bsky.* in trending) plus the dedup (one row per top-2-segment
    /// namespace) still leaves enough rows to fill the table.
    public nonisolated static let candidatePoolFactor = 5
    /// Namespaces suppressed from the Trending view. Both flavours of
    /// Bluesky (public app and chat) dominate every absolute ranking and
    /// barely move in percent terms, so they crowd out the smaller
    /// projects the view is meant to surface.
    public nonisolated static let trendingHiddenPrefixes = ["app.bsky.", "chat.bsky."]
    /// Namespaces suppressed from the Top view too. Chat collections are
    /// private DM traffic: real activity, but not interesting to publish
    /// as "what's hot on the protocol". Bluesky's public namespace stays.
    public nonisolated static let topHiddenPrefixes = ["chat."]
    /// `TOP_FETCH`: a deep pool so "one per group" has enough to dedupe.
    public nonisolated static let browseTopFetch = 200
    /// `TOP_DISPLAY`: how much of that pool shows when not deduping.
    public nonisolated static let browseTopDisplay = 50
    /// `PAGE_LIMIT` for the cursor-paged All view.
    public nonisolated static let browsePageLimit = 100
    /// `TYPEAHEAD_DEBOUNCE_MS` / `SUGGESTION_LIMIT` of the search box.
    public nonisolated static let searchDebounce: TimeInterval = 0.18
    public nonisolated static let suggestionLimit = 12
    /// The message the web throws for a swallowed request failure; the
    /// screens prefix it with "Couldn't reach the UFOs API: ".
    public nonisolated static let apiUnavailableMessage = "the UFOs API is unavailable"
    public nonisolated static let rankingEmptyMessage = "No lexicons matched in this window."
    public nonisolated static let browseEmptyMessage = "No lexicons found."

    // MARK: Ranking state

    /// The three independent toggles of the strip. Changing any of them
    /// after `load()` refetches; the previous table stays visible until
    /// the new data arrives, so the skeleton only shows on the first load.
    public var mode: LexiconRankingMode = .trending {
        didSet { if mode != oldValue { rankingSettingsDidChange() } }
    }
    public var metric: Metric = .dids {
        didSet { if metric != oldValue { rankingSettingsDidChange() } }
    }
    public var window: UFOsWindow = .sevenDays {
        didSet { if window != oldValue { rankingSettingsDidChange() } }
    }
    /// "Show top 20" state. The fetch limit follows it, so toggling
    /// refetches with the larger or smaller pool.
    public var expanded = false {
        didSet { if expanded != oldValue { rankingSettingsDidChange() } }
    }

    /// The ranked rows. `.loaded` survives a refetch (with
    /// `isRankingRefreshing` set) so the table does not flash.
    public private(set) var ranking: Loadable<[LexiconRankingRow]> = .idle
    public private(set) var isRankingRefreshing = false

    // MARK: Search state

    /// The text in the search box. Every change re-arms the typeahead
    /// timer and opens the suggestion area, as typing does on the web.
    public var searchQuery = "" {
        didSet { if searchQuery != oldValue { searchQueryDidChange() } }
    }
    /// `showSuggestions`: set on focus and on typing, cleared on submit,
    /// on a pick, on Escape and on a tap outside.
    public var isSearchOpen = false
    /// The ranked, capped `/search` matches for the current query.
    public private(set) var suggestions: [NsidCount] = []
    /// True from the keystroke until the debounced lookup answers.
    public private(set) var isSearchPending = false
    /// Keyboard highlight into `suggestions`; -1 for none.
    public private(set) var highlightIndex = -1

    // MARK: Browse state

    public var browseView: LexiconBrowseView = .top {
        didSet { if browseView != oldValue { browseSettingsDidChange() } }
    }
    /// In Top this is the sort key and refetches; in All it only picks
    /// which stat column shows, so it deliberately does not refetch and
    /// every "Load more" page survives a toggle.
    public var browseOrder: CollectionOrder = .didsEstimate {
        didSet { if browseOrder != oldValue, browseView == .top { browseSettingsDidChange() } }
    }
    /// "One per group": collapse the list to the highest-ranked row per
    /// 2-segment namespace so a project with hundreds of collections does
    /// not swamp the view. Pure display state.
    public var onePerGroup = true

    /// The raw rows of the current view (the pool in Top, every page so
    /// far in All). `.loaded` survives a refetch and a failed refetch that
    /// had rows to keep, as `setRows(prev => prev ?? [])` keeps them.
    public private(set) var browse: Loadable<[NsidCount]> = .idle
    public private(set) var isBrowseRefreshing = false
    /// Next page of the All view; nil in Top and once exhausted.
    public private(set) var browseCursor: String?
    public private(set) var isLoadingMore = false
    /// A failed "Load more". The cursor is kept so the tap can be retried,
    /// where the web dropped it and hid the button.
    public private(set) var loadMoreError: String?

    // MARK: Freshness

    /// "Firehose data current as of 12s ago", from `/meta`; nil until it
    /// answers, or when it does not carry a jetstream cursor.
    public private(set) var freshnessLabel: String?

    @ObservationIgnored private let ufos: UFOsClient
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let debounce: TimeInterval
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var rankingTask: Task<Void, Never>?
    @ObservationIgnored private var rankingGeneration = 0
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var browseTask: Task<Void, Never>?
    @ObservationIgnored private var loadMoreTask: Task<Void, Never>?
    @ObservationIgnored private var browseGeneration = 0
    @ObservationIgnored private var freshnessTask: Task<Void, Never>?

    /// `clock` fixes "now" for the window bounds; tests pin it so the
    /// `since` / `until` query strings are predictable.
    public init(
        http: HTTPClient = .shared,
        searchDebounce: TimeInterval = LexiconsModel.searchDebounce,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        ufos = UFOsClient(http: http)
        debounce = searchDebounce
        self.clock = clock
    }

    // MARK: Loading

    /// Fetch the strip, the catalog and the freshness line. Toggles set
    /// before this call are honoured by the first fetch and only start
    /// refetching once it has run.
    @discardableResult
    public func load() -> Task<Void, Never> {
        hasStarted = true
        let ranking = reloadRanking()
        let browse = reloadBrowse()
        let freshness = loadFreshness()
        return Task {
            await ranking.value
            await browse.value
            await freshness.value
        }
    }

    /// Stop every in-flight read. State is left as it is.
    public func cancel() {
        rankingTask?.cancel()
        rankingTask = nil
        isRankingRefreshing = false
        searchTask?.cancel()
        searchTask = nil
        isSearchPending = false
        browseTask?.cancel()
        browseTask = nil
        isBrowseRefreshing = false
        loadMoreTask?.cancel()
        loadMoreTask = nil
        isLoadingMore = false
        freshnessTask?.cancel()
        freshnessTask = nil
    }

    /// Wait for every fetch in flight, including the refetches the toggles
    /// start; for tests and for a screen that wants to settle before a
    /// snapshot.
    public func awaitPending() async {
        await rankingTask?.value
        await browseTask?.value
        await loadMoreTask?.value
        await freshnessTask?.value
        await searchTask?.value
    }

    // MARK: Ranking

    /// `limit`: how many rows the strip shows and fetches for.
    public var rankingLimit: Int {
        expanded ? LexiconsModel.expandedCount : LexiconsModel.resultCount
    }

    /// The rows to draw, sliced defensively: while an expand is in flight
    /// `ranking` still holds the previous (shorter or longer) result, and
    /// collapsing takes effect immediately rather than waiting on the
    /// refetch. Nil until the first load lands (the skeleton).
    public var visibleRanking: [LexiconRankingRow]? {
        ranking.value.map { Array($0.prefix(rankingLimit)) }
    }

    /// The error panel copy, nil unless the last fetch failed.
    public var rankingErrorMessage: String? {
        ranking.errorMessage.map { "Couldn't reach the UFOs API: \($0)" }
    }

    /// Loaded and empty: everything was filtered out or the window is quiet.
    public var isRankingEmpty: Bool {
        visibleRanking?.isEmpty ?? false
    }

    /// Hide the expand toggle only when collapsed and the list is already
    /// short: there is nothing more to reveal.
    public var showsRankingToggle: Bool {
        guard let visible = visibleRanking, !visible.isEmpty else { return false }
        return expanded || visible.count >= LexiconsModel.resultCount
    }

    public var rankingToggleLabel: String {
        expanded ? "Show top \(LexiconsModel.resultCount)" : "Show top \(LexiconsModel.expandedCount)"
    }

    public var rankingTitle: String { mode.title }

    /// The sparkline's accessibility label.
    public var rankingSeriesLabel: String {
        "Activity over the last \(window.label)"
    }

    /// Refetch the strip for the current toggles. The loaded rows stay on
    /// screen meanwhile; after a failure the skeleton shows instead.
    @discardableResult
    public func reloadRanking() -> Task<Void, Never> {
        rankingTask?.cancel()
        rankingGeneration += 1
        let gen = rankingGeneration
        if ranking.value != nil {
            isRankingRefreshing = true
        } else {
            ranking = .loading
        }
        let window = window
        let mode = mode
        let metric = metric
        let limit = rankingLimit
        let client = ufos
        let now = clock()
        let task = Task { [weak self] in
            let rows = await LexiconsModel.fetchRanking(
                window: window, mode: mode, metric: metric, resultCount: limit, client: client, now: now
            )
            guard let self, gen == self.rankingGeneration, !Task.isCancelled else { return }
            self.isRankingRefreshing = false
            if let rows {
                self.ranking = .loaded(rows)
            } else {
                self.ranking = .failed(LexiconsModel.apiUnavailableMessage)
            }
        }
        rankingTask = task
        return task
    }

    private func rankingSettingsDidChange() {
        guard hasStarted else { return }
        reloadRanking()
    }

    /// Port of `fetchRanking`. Nil when the candidate pool request failed:
    /// a real API failure must surface as an error, not an empty
    /// leaderboard that reads as "no activity". Cancellation between the
    /// phases also yields nil; callers that were cancelled ignore it.
    ///
    ///   1. Candidate pool, ordered by whichever sort the API supports
    ///      best for the metric (updates and deletes fall back to
    ///      records-created).
    ///   2. Filter (mode-specific) and dedup by top-2-segment namespace.
    ///   3. Score by the metric. `/collections` carries creates and
    ///      dids_estimate directly; updates and deletes need a stats lookup.
    ///   4. Top: sort by the score. Trending: percent change against the
    ///      prior window, rows without prior data sorted to the back.
    ///   5. A sparkline per picked row, trimmed to the window's buckets.
    public nonisolated static func fetchRanking(
        window: UFOsWindow,
        mode: LexiconRankingMode,
        metric: Metric,
        resultCount: Int,
        client: UFOsClient,
        now: Date = Date()
    ) async -> [LexiconRankingRow]? {
        let sinceIso = UFOsClient.isoAgo(hours: Double(window.hours), now: now)
        let pool = await client.fetchCollections(
            order: metric.collectionOrder,
            limit: resultCount * candidatePoolFactor,
            since: sinceIso
        )
        if pool.failed || Task.isCancelled { return nil }

        let filtered = filterAndDedup(pool.collections, mode: mode)
        if filtered.isEmpty { return [] }
        let nsids = filtered.map(\.nsid)

        let directlyAvailable = metric == .creates || metric == .dids
        let currentMap: [String: Int]
        if directlyAvailable {
            currentMap = Dictionary(filtered.map { ($0.nsid, $0.stat(for: metric)) }, uniquingKeysWith: { first, _ in first })
        } else {
            currentMap = await statsMetric(client, nsids, since: sinceIso, until: Formatting.isoTimestamp(now), metric: metric)
        }
        if Task.isCancelled { return nil }

        if mode == .top {
            let sorted = filtered.sorted { (currentMap[$0.nsid] ?? 0) > (currentMap[$1.nsid] ?? 0) }
            let picked = Array(sorted.prefix(resultCount))
            let series = await fetchSeries(client, picked.map(\.nsid), since: sinceIso, window: window, metric: metric)
            if Task.isCancelled { return nil }
            return picked.enumerated().map { i, c in
                LexiconRankingRow(nsid: c.nsid, value: currentMap[c.nsid] ?? 0, series: series[i], deltaPct: nil)
            }
        }

        let priorSinceIso = UFOsClient.isoAgo(hours: Double(window.hours * 2), now: now)
        let priorMap = await statsMetric(client, nsids, since: priorSinceIso, until: sinceIso, metric: metric)
        if Task.isCancelled { return nil }

        let withDelta: [(nsid: String, value: Int, deltaPct: Double?)] = filtered.map { c in
            let current = currentMap[c.nsid] ?? 0
            let prior = priorMap[c.nsid] ?? 0
            let deltaPct: Double? = prior > 0 ? (Double(current - prior) / Double(prior)) * 100 : nil
            return (c.nsid, current, deltaPct)
        }
        // Delta descending, nil deltas (no prior data) to the back; the
        // sort is stable, so ties keep the pool's order as they do on the web.
        let ranked = withDelta.sorted { a, b in
            switch (a.deltaPct, b.deltaPct) {
            case (nil, _): return false
            case (_, nil): return true
            case (let x?, let y?): return x > y
            }
        }.prefix(resultCount)
        let series = await fetchSeries(client, ranked.map(\.nsid), since: sinceIso, window: window, metric: metric)
        if Task.isCancelled { return nil }
        return ranked.enumerated().map { i, c in
            LexiconRankingRow(nsid: c.nsid, value: c.value, series: series[i], deltaPct: c.deltaPct)
        }
    }

    /// `hasHiddenPrefix`.
    public nonisolated static func hasHiddenPrefix(_ nsid: String, _ prefixes: [String]) -> Bool {
        prefixes.contains { nsid.hasPrefix($0) }
    }

    /// Port of `filterAndDedup`: drop the mode's hidden namespaces, then
    /// keep the first row per top-2-segment namespace so `social.grain.
    /// gallery` and `social.grain.like` are not both in the table at once.
    public nonisolated static func filterAndDedup(_ rows: [NsidCount], mode: LexiconRankingMode) -> [NsidCount] {
        let hidden = mode == .trending ? trendingHiddenPrefixes : topHiddenPrefixes
        var seen = Set<String>()
        var out: [NsidCount] = []
        for row in rows {
            if hasHiddenPrefix(row.nsid, hidden) { continue }
            let key = NSID.namespaceKey(row.nsid)
            if !seen.insert(key).inserted { continue }
            out.append(row)
        }
        return out
    }

    /// Port of `dedupeByNamespace` (BrowseAllLexicons.tsx): keep the first,
    /// highest-ranked collection per 2-segment namespace.
    public nonisolated static func dedupeByNamespace(_ rows: [NsidCount]) -> [NsidCount] {
        var seen = Set<String>()
        return rows.filter { seen.insert(NSID.namespaceKey($0.nsid)).inserted }
    }

    /// Stats projected to one metric, keyed by NSID. A failed lookup reads
    /// as no stats (every score zero), as the web's empty map does.
    private nonisolated static func statsMetric(
        _ client: UFOsClient,
        _ nsids: [String],
        since: String,
        until: String,
        metric: Metric
    ) async -> [String: Int] {
        let result = await client.fetchCollectionStats(collections: nsids, since: since, until: until)
        return result.stats.mapValues { $0.stat(for: metric) }
    }

    /// One timeseries per collection, fetched concurrently and returned in
    /// input order, each projected to the metric and trimmed to the
    /// window's bucket count.
    private nonisolated static func fetchSeries(
        _ client: UFOsClient,
        _ nsids: [String],
        since: String,
        window: UFOsWindow,
        metric: Metric
    ) async -> [[Int]] {
        await withTaskGroup(of: (Int, [Int]).self) { group in
            for (index, nsid) in nsids.enumerated() {
                group.addTask {
                    let result = await client.fetchTimeseries(collection: nsid, since: since, step: window.step)
                    let buckets = result.series[nsid] ?? []
                    return (index, buckets.suffix(window.bucketCount).map { $0.stat(for: metric) })
                }
            }
            var out = Array(repeating: [Int](), count: nsids.count)
            for await (index, series) in group {
                out[index] = series
            }
            return out
        }
    }

    // MARK: Search box (LexiconSearchBox.tsx)

    private var trimmedSearch: String {
        searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Offer "Browse all of X" when the query reads like a dotted prefix
    /// (e.g. net.anisota): that is what `/prefix` can enumerate.
    public var showsNamespaceRow: Bool {
        let trimmed = trimmedSearch
        return trimmed.contains(".") && UFOsClient.isSearchable(trimmed)
    }

    public var showsSuggestionList: Bool {
        isSearchOpen && !suggestions.isEmpty
    }

    public var showsSearchDropdown: Bool {
        isSearchOpen && (showsSuggestionList || showsNamespaceRow)
    }

    /// The trimmed query, for the "Browse all of" row.
    public var namespaceRowTerm: String { trimmedSearch }

    public var highlightedSuggestion: NsidCount? {
        guard highlightIndex >= 0, highlightIndex < suggestions.count else { return nil }
        return suggestions[highlightIndex]
    }

    private func searchQueryDidChange() {
        isSearchOpen = true
        searchTask?.cancel()
        searchTask = nil
        let trimmed = trimmedSearch
        guard UFOsClient.isSearchable(trimmed) else {
            suggestions = []
            highlightIndex = -1
            isSearchPending = false
            return
        }
        isSearchPending = true
        let delay = debounce
        let client = ufos
        searchTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            let result = await client.searchLexicons(trimmed)
            guard !Task.isCancelled, let self else { return }
            // The API returns matches roughly alphabetically; sort by
            // creates so well-known lexicons surface above obscure
            // same-prefix ones, and cap the dropdown to a manageable length.
            self.suggestions = Array(
                result.matches.sorted { $0.counts.creates > $1.counts.creates }.prefix(LexiconsModel.suggestionLimit)
            )
            self.highlightIndex = -1
            self.isSearchPending = false
            self.searchTask = nil
        }
    }

    /// Wait for the debounced lookup in flight, if any.
    public func awaitPendingSearch() async {
        await searchTask?.value
    }

    /// ArrowDown: wrap around the suggestions.
    public func highlightNext() {
        guard showsSuggestionList else { return }
        highlightIndex = (highlightIndex + 1) % suggestions.count
    }

    /// ArrowUp: wrap around the suggestions.
    public func highlightPrevious() {
        guard showsSuggestionList else { return }
        highlightIndex = highlightIndex <= 0 ? suggestions.count - 1 : highlightIndex - 1
    }

    /// Pointer hover over a row.
    public func setHighlight(_ index: Int) {
        highlightIndex = index
    }

    /// Escape or a tap outside the box.
    public func dismissSearch() {
        isSearchOpen = false
    }

    /// The form's submit. A highlighted suggestion wins; then an exact
    /// match to a known collection opens its detail page; otherwise the
    /// input is treated as a namespace or search term and routed to the
    /// group page (which lists a namespace via `/prefix`, or falls back to
    /// `/search` for a single-segment term). Nil when the query is too
    /// short to search.
    public func submitSearch() -> SearchDestination? {
        if let highlighted = highlightedSuggestion {
            return pickSuggestion(highlighted.nsid)
        }
        let trimmed = trimmedSearch
        guard UFOsClient.isSearchable(trimmed) else { return nil }
        isSearchOpen = false
        if suggestions.contains(where: { $0.nsid == trimmed }) {
            return .lexicon(nsid: trimmed)
        }
        return .lexiconGroup(prefix: trimmed)
    }

    /// A suggestion row was chosen.
    public func pickSuggestion(_ nsid: String) -> SearchDestination {
        isSearchOpen = false
        return .lexicon(nsid: nsid)
    }

    /// The "Browse all of X" row was chosen. Nil unless it is showing.
    public func browseNamespace() -> SearchDestination? {
        guard showsNamespaceRow else { return nil }
        isSearchOpen = false
        return .lexiconGroup(prefix: trimmedSearch)
    }

    // MARK: Browse (BrowseAllLexicons.tsx)

    /// The rows to draw: one per namespace when deduping, else the top 50
    /// of the pool or every page of the catalog. Nil until the first load.
    public var displayedBrowse: [NsidCount]? {
        guard let rows = browse.value else { return nil }
        if onePerGroup { return LexiconsModel.dedupeByNamespace(rows) }
        return browseView == .top ? Array(rows.prefix(LexiconsModel.browseTopDisplay)) : rows
    }

    /// The error panel copy: only when there is nothing to show instead.
    public var browseErrorMessage: String? {
        guard let message = browse.errorMessage, displayedBrowse?.isEmpty ?? true else { return nil }
        return "Couldn't reach the UFOs API: \(message)"
    }

    public var isBrowseEmpty: Bool {
        displayedBrowse?.isEmpty ?? false
    }

    /// Only one stat column shows at a time, chosen by the Repos / Creates
    /// toggle, so the NSID column gets the freed-up width.
    public var browseMetricLabel: String {
        browseOrder == .recordsCreated ? "Creates" : "Repos"
    }

    /// The segmented control's label: the toggle sorts in Top and only
    /// picks the column in All.
    public var browseOrderLabel: String {
        browseView == .top ? "Rank by" : "Show metric"
    }

    public func browseStat(_ row: NsidCount) -> Int {
        browseOrder == .recordsCreated ? row.counts.creates : row.counts.didsEstimate
    }

    /// The "Load more" button's visibility.
    public var canLoadMoreBrowse: Bool {
        browseView == .all && browseCursor != nil && !(displayedBrowse?.isEmpty ?? true)
    }

    /// Refetch the catalog for the current view (and, in Top, order). The
    /// loaded rows stay visible meanwhile.
    @discardableResult
    public func reloadBrowse() -> Task<Void, Never> {
        browseTask?.cancel()
        loadMoreTask?.cancel()
        loadMoreTask = nil
        browseGeneration += 1
        let gen = browseGeneration
        isLoadingMore = false
        loadMoreError = nil
        if browse.value != nil {
            isBrowseRefreshing = true
        } else {
            browse = .loading
        }
        let view = browseView
        let order = browseOrder
        let client = ufos
        let task = Task { [weak self] in
            let page: UFOsCollectionsPage
            switch view {
            case .top:
                page = await client.fetchCollections(order: order, limit: LexiconsModel.browseTopFetch)
            case .all:
                page = await client.fetchCollections(limit: LexiconsModel.browsePageLimit)
            }
            guard let self, gen == self.browseGeneration, !Task.isCancelled else { return }
            self.isBrowseRefreshing = false
            if page.failed {
                // Surface a real failure instead of rendering it as "No
                // lexicons found", but keep whatever was already on screen.
                if self.browse.value == nil {
                    self.browse = .failed(LexiconsModel.apiUnavailableMessage)
                }
                return
            }
            self.browse = .loaded(page.collections)
            self.browseCursor = view == .all ? page.cursor : nil
        }
        browseTask = task
        return task
    }

    private func browseSettingsDidChange() {
        guard hasStarted else { return }
        reloadBrowse()
    }

    /// Fetch the next page of the All view. Nil when there is nothing to
    /// do: not in All, exhausted, or a page already in flight.
    @discardableResult
    public func loadMoreBrowse() -> Task<Void, Never>? {
        guard browseView == .all, let cursor = browseCursor, !isLoadingMore else { return nil }
        isLoadingMore = true
        loadMoreError = nil
        let gen = browseGeneration
        let client = ufos
        let task = Task { [weak self] in
            let page = await client.fetchCollections(cursor: cursor, limit: LexiconsModel.browsePageLimit)
            guard let self, gen == self.browseGeneration, !Task.isCancelled else { return }
            self.isLoadingMore = false
            if page.failed {
                self.loadMoreError = LexiconsModel.apiUnavailableMessage
                return
            }
            self.browse = .loaded((self.browse.value ?? []) + page.collections)
            self.browseCursor = page.cursor
        }
        loadMoreTask = task
        return task
    }

    // MARK: Freshness (LexiconsExplorer.tsx)

    /// Read `/meta` and turn its jetstream cursor into the footnote.
    @discardableResult
    public func loadFreshness() -> Task<Void, Never> {
        freshnessTask?.cancel()
        let client = ufos
        let task = Task { [weak self] in
            guard let meta = await client.fetchMeta() else { return }
            guard let self, !Task.isCancelled else { return }
            guard let cursorUs = meta.consumer?["jetstream"]?["latest_cursor"]?.doubleValue else { return }
            self.freshnessLabel = LexiconsModel.freshnessLabel(cursorUs: cursorUs, now: self.clock())
        }
        freshnessTask = task
        return task
    }

    /// Port of `Freshness`: "Firehose data current as of 12s ago", with the
    /// lag in seconds under 90 s, minutes under 90 min, hours beyond.
    public nonisolated static func freshnessLabel(cursorUs: Double, now: Date) -> String {
        let lagSeconds = (now.timeIntervalSince1970 * 1000 - cursorUs / 1000) / 1000
        let agoSec = max(0, Int(lagSeconds.rounded(.toNearestOrAwayFromZero)))
        let rel: String
        if agoSec < 90 {
            rel = "\(agoSec)s"
        } else if agoSec < 5400 {
            rel = "\(Int((Double(agoSec) / 60).rounded(.toNearestOrAwayFromZero)))m"
        } else {
            rel = "\(Int((Double(agoSec) / 3600).rounded(.toNearestOrAwayFromZero)))h"
        }
        return "Firehose data current as of \(rel) ago"
    }
}

// MARK: - Group page (LexiconGroup.tsx)

/// One segment of the group page's dotted heading, each but the last a
/// link to its own group page.
public struct LexiconBreadcrumb: Hashable, Sendable, Identifiable {
    public var id: String { cumulative }
    public let segment: String
    /// The segments up to and including this one, joined with dots.
    public let cumulative: String
    public let isLast: Bool

    public init(segment: String, cumulative: String, isLast: Bool) {
        self.segment = segment
        self.cumulative = cumulative
        self.isLast = isLast
    }

    public var path: String { NSID.groupPathFor(cumulative) }
    public var destination: SearchDestination { .lexiconGroup(prefix: cumulative) }
}

/// One row of the group page: a sub-namespace (drill deeper) or a concrete
/// collection (open its detail page). Both list views share it; the search
/// fallback only ever produces collections.
public struct LexiconGroupEntry: Hashable, Sendable, Identifiable {
    public var id: String { (isNamespace ? "prefix:" : "collection:") + name }
    /// The NSID or the prefix, whichever this entry names.
    public let name: String
    public let isNamespace: Bool
    public let counts: JustCount

    public init(name: String, isNamespace: Bool, counts: JustCount) {
        self.name = name
        self.isNamespace = isNamespace
        self.counts = counts
    }

    public init(child: PrefixChild) {
        self.init(name: child.name, isNamespace: child.isPrefix, counts: child.counts)
    }

    public init(match: NsidCount) {
        self.init(name: match.nsid, isNamespace: false, counts: match.counts)
    }

    /// The name with the `.*` a namespace row carries.
    public var displayName: String { isNamespace ? name + ".*" : name }
    public var path: String { isNamespace ? NSID.groupPathFor(name) : NSID.lexiconPathFor(name) }
    public var destination: SearchDestination {
        isNamespace ? .lexiconGroup(prefix: name) : .lexicon(nsid: name)
    }
    /// The one stat the rows show: creates.
    public var countLabel: String { UFOsFormat.formatCount(counts.creates) }
}

/// The namespace / prefix browse page (`/explore/lexicons/group/[prefix]`).
///
///   - A dotted prefix (`net.anisota`, `net.anisota.beta`) lists everything
///     under it via `/prefix`: sub-namespaces and concrete collections.
///   - A single-segment term (`net`, `anisota`) cannot use `/prefix` (the
///     API requires 2+ segments), so it falls back to `/search` and acts as
///     a results page for that term.
@MainActor
@Observable
public final class LexiconGroupModel {
    /// `PREFIX_LIMIT`.
    public nonisolated static let prefixLimit = 200

    public let prefix: String

    /// The rows, sorted by creates descending with namespaces and
    /// collections interleaved. `.failed` when the request failed, where
    /// the web could only render "nothing published".
    public private(set) var entries: Loadable<[LexiconGroupEntry]> = .idle
    /// Aggregated counts over the whole group; prefix view only, nil until
    /// the first page lands (the summary skeleton).
    public private(set) var total: JustCount?
    public private(set) var cursor: String?
    public private(set) var isLoadingMore = false
    /// A failed "Load more"; the cursor is kept so it can be retried.
    public private(set) var loadMoreError: String?

    /// Client-side narrowing of the loaded rows by name.
    public var filter = ""

    @ObservationIgnored private let ufos: UFOsClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var loadMoreTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(prefix: String, http: HTTPClient = .shared) {
        self.prefix = prefix
        ufos = UFOsClient(http: http)
    }

    // MARK: Frame

    /// Dotted prefixes enumerate a namespace; anything else is a search.
    public var isPrefixView: Bool { prefix.contains(".") }

    public var eyebrow: String { isPrefixView ? "Namespace" : "Search results" }

    public var breadcrumbs: [LexiconBreadcrumb] {
        let segments = prefix.components(separatedBy: ".")
        return segments.indices.map { i in
            LexiconBreadcrumb(
                segment: segments[i],
                cumulative: segments[...i].joined(separator: "."),
                isLast: i == segments.count - 1
            )
        }
    }

    /// The chrome bar's placeholder and accessibility label.
    public var filterPlaceholder: String {
        isPrefixView ? "Filter this namespace…" : "Filter these results…"
    }

    public var filterLabel: String {
        isPrefixView ? "Filter entries under \(prefix)" : "Filter lexicons matching \(prefix)"
    }

    // MARK: Loading

    /// Fetch the first page (or the search results). Clears the filter: a
    /// query typed against one listing means nothing in the next.
    @discardableResult
    public func load() -> Task<Void, Never> {
        cancel()
        generation += 1
        let gen = generation
        entries = .loading
        total = nil
        cursor = nil
        filter = ""
        let prefix = prefix
        let client = ufos
        let task = Task { [weak self] in
            if prefix.contains(".") {
                let page = await client.fetchPrefix(prefix: prefix, limit: LexiconGroupModel.prefixLimit)
                guard let self, gen == self.generation, !Task.isCancelled else { return }
                if page.failed {
                    self.entries = .failed(LexiconsModel.apiUnavailableMessage)
                    return
                }
                self.entries = .loaded(LexiconGroupModel.sortEntries(page.children.map(LexiconGroupEntry.init(child:))))
                self.cursor = page.cursor
                self.total = page.total
            } else {
                let result = await client.searchLexicons(prefix)
                guard let self, gen == self.generation, !Task.isCancelled else { return }
                if result.failed {
                    self.entries = .failed(LexiconsModel.apiUnavailableMessage)
                    return
                }
                self.entries = .loaded(LexiconGroupModel.sortEntries(result.matches.map(LexiconGroupEntry.init(match:))))
            }
        }
        loadTask = task
        return task
    }

    /// Fetch the next page of a namespace and re-sort the whole list. Nil
    /// when there is no cursor or a page is already in flight.
    @discardableResult
    public func loadMore() -> Task<Void, Never>? {
        guard isPrefixView, let cursor, !isLoadingMore, entries.value != nil else { return nil }
        isLoadingMore = true
        loadMoreError = nil
        let gen = generation
        let prefix = prefix
        let client = ufos
        let task = Task { [weak self] in
            let page = await client.fetchPrefix(prefix: prefix, cursor: cursor, limit: LexiconGroupModel.prefixLimit)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.isLoadingMore = false
            if page.failed {
                self.loadMoreError = LexiconsModel.apiUnavailableMessage
                return
            }
            let merged = (self.entries.value ?? []) + page.children.map(LexiconGroupEntry.init(child:))
            self.entries = .loaded(LexiconGroupModel.sortEntries(merged))
            self.cursor = page.cursor
        }
        loadMoreTask = task
        return task
    }

    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        loadMoreTask?.cancel()
        loadMoreTask = nil
        isLoadingMore = false
    }

    /// Wait for the fetches in flight, for tests and for a screen that
    /// wants to settle before a snapshot.
    public func awaitPending() async {
        await loadTask?.value
        await loadMoreTask?.value
    }

    /// `sortChildren`: creates descending, stable.
    public nonisolated static func sortEntries(_ entries: [LexiconGroupEntry]) -> [LexiconGroupEntry] {
        entries.sorted { $0.counts.creates > $1.counts.creates }
    }

    // MARK: Derived

    private var query: String {
        filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// The rows matching the filter; nil until loaded.
    public var visibleEntries: [LexiconGroupEntry]? {
        guard let entries = entries.value else { return nil }
        let needle = query
        if needle.isEmpty { return entries }
        return entries.filter { $0.name.lowercased().contains(needle) }
    }

    /// The chrome bar's count: "3/12" while filtering, else "12"; nil
    /// until loaded.
    public var statusLabel: String? {
        guard let entries = entries.value else { return nil }
        if query.isEmpty { return String(entries.count) }
        return "\(visibleEntries?.count ?? 0)/\(entries.count)"
    }

    /// "1.2k creates · 30 repos · 12 entries" under the heading; nil while
    /// the total is unknown (the skeleton) and on the search view.
    public var summaryLine: String? {
        guard let total else { return nil }
        var line = "\(UFOsFormat.formatCount(total.creates)) creates · \(UFOsFormat.formatCount(total.didsEstimate)) repos"
        if let count = entries.value?.count {
            line += " · \(count) entries"
        }
        return line
    }

    /// The copy when the listing itself is empty.
    public var emptyMessage: String? {
        guard let entries = entries.value, entries.isEmpty else { return nil }
        return isPrefixView ? "Nothing is published under \(prefix)." : "No lexicons matched \u{201C}\(prefix)\u{201D}."
    }

    /// An empty namespace may still be a lexicon itself; the link under
    /// the empty copy on the prefix view.
    public var emptyLexiconPath: String? {
        guard isPrefixView, emptyMessage != nil else { return nil }
        return NSID.lexiconPathFor(prefix)
    }

    public var emptyLexiconLinkLabel: String? {
        emptyLexiconPath == nil ? nil : "View \(prefix) as a lexicon →"
    }

    /// The copy when the filter hides every row.
    public var noMatchMessage: String? {
        guard let entries = entries.value, !entries.isEmpty, visibleEntries?.isEmpty ?? false else { return nil }
        let typed = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        return isPrefixView
            ? "No entries under \(prefix) match \u{201C}\(typed)\u{201D}."
            : "No results match \u{201C}\(typed)\u{201D}."
    }

    public var errorMessage: String? {
        entries.errorMessage.map { "Couldn't reach the UFOs API: \($0)" }
    }

    /// The "Load more" button's visibility: a cursor, under a non-empty list.
    public var canLoadMore: Bool {
        isPrefixView && cursor != nil && !(visibleEntries?.isEmpty ?? true)
    }
}

// MARK: - Detail page (LexiconDetail.tsx)

/// The window-dependent numbers of the detail page: current and prior
/// window stats plus the timeseries buckets.
public struct LexiconActivity: Hashable, Sendable {
    public var current: JustCount
    public var prior: JustCount
    public var buckets: [JustCount]

    public init(current: JustCount, prior: JustCount, buckets: [JustCount]) {
        self.current = current
        self.prior = prior
        self.buckets = buckets
    }

    /// `statTotal`: every counter summed, the "any activity at all" test.
    public var total: Int {
        current.creates + current.updates + current.deletes + current.didsEstimate
    }

    public func series(for metric: Metric) -> [Int] {
        buckets.map { $0.stat(for: metric) }
    }
}

/// One headline tile: the metric's current value and its delta against
/// the prior window. Port of `StatTile`.
public struct LexiconStatTile: Hashable, Sendable, Identifiable {
    public var id: String { metric.rawValue }
    public let metric: Metric
    public let current: Int
    public let prior: Int

    public init(metric: Metric, current: Int, prior: Int) {
        self.metric = metric
        self.current = current
        self.prior = prior
    }

    public var label: String { metric.label }
    public var valueLabel: String { UFOsFormat.formatCount(current) }
    /// Nil when the prior window is zero: no meaningful percentage.
    public var deltaPct: Double? {
        prior > 0 ? (Double(current - prior) / Double(prior)) * 100 : nil
    }
    public var deltaLabel: String? { deltaPct.map(UFOsFormat.formatPct) }
}

/// One recent record sample. The web keys rows by DID, rkey and index
/// because the sampler can repeat a record.
public struct LexiconSampleRow: Hashable, Sendable, Identifiable {
    public var id: String { "\(record.did)-\(record.rkey)-\(index)" }
    public let record: ApiRecord
    public let index: Int

    public init(record: ApiRecord, index: Int) {
        self.record = record
        self.index = index
    }

    public var didLabel: String { shortDid(record.did) }
    public var rkey: String { record.rkey }
    public var atUri: String { record.atUri }
    /// The record page, nil when the sample does not form a valid AT URI.
    public var explorerPath: String? { explorePath(fromAtUri: record.atUri) }
    public var preview: String { RecordPreview.previewFor(record.record) }

    public func relativeTime(now: Date = Date()) -> String {
        LexiconDetailModel.relativeTime(record.time, now: now)
    }
}

/// Per-lexicon detail page (`/explore/lexicons/[nsid]`): headline stats
/// with deltas against the prior window, the trend series, sibling
/// collections in the same lexicon group, and recent record samples, all
/// from the UFOs API. Loads for any string; an unknown NSID shows empty
/// states rather than an error.
@MainActor
@Observable
public final class LexiconDetailModel {
    /// `METRIC_ORDER`: the tile and chart-toggle order.
    public nonisolated static let metricOrder: [Metric] = [.creates, .updates, .deletes, .dids]
    public nonisolated static let siblingLimit = 10
    public nonisolated static let sampleLimit = 8
    public nonisolated static let chartEmptyMessage = "No recorded activity in this window."
    public nonisolated static let samplesEmptyMessage = "No recent records sampled for this lexicon."

    public let nsid: String

    /// Changing the window after `load()` refetches the activity only;
    /// the previous values stay visible until the new ones land.
    public var window: UFOsWindow = .sevenDays {
        didSet { if window != oldValue, hasStarted { reloadActivity() } }
    }
    /// Which counter the trend chart plots. Pure display state.
    public var metric: Metric = .creates

    /// `.failed` only when every window-dependent request failed; a single
    /// miss reads as zero, as the web's `allSettled` fallbacks do.
    public private(set) var activity: Loadable<LexiconActivity> = .idle
    public private(set) var isActivityRefreshing = false
    /// Sibling collections in the group, creates descending, capped.
    public private(set) var siblings: Loadable<[NsidCount]> = .idle
    public private(set) var samples: Loadable<[ApiRecord]> = .idle

    /// The chrome bar's "search for another lexicon" field.
    public var search = ""

    @ObservationIgnored private let ufos: UFOsClient
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var activityTask: Task<Void, Never>?
    @ObservationIgnored private var activityGeneration = 0
    @ObservationIgnored private var sectionsTask: Task<Void, Never>?
    @ObservationIgnored private var sectionsGeneration = 0

    public init(nsid: String, http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.nsid = nsid
        ufos = UFOsClient(http: http)
        self.clock = clock
    }

    // MARK: Header

    public var publisher: String { NSID.publisherForNsid(nsid) }
    /// The top-2-segment group the header links to.
    public var group: String { NSID.namespaceKey(nsid) }
    public var groupPath: String { NSID.groupPathFor(group) }
    /// The parent lexicon group the siblings come from.
    public var groupPrefix: String { NSID.groupPrefix(nsid) }
    public var schemaPath: String { NSID.schemaPathFor(nsid) }

    // MARK: Loading

    /// Fetch everything: the activity for the current window and the
    /// NSID-only sections (siblings and samples).
    @discardableResult
    public func load() -> Task<Void, Never> {
        hasStarted = true
        let activity = reloadActivity()
        let sections = reloadSections()
        return Task {
            await activity.value
            await sections.value
        }
    }

    /// Refetch the stats and the timeseries for the current window.
    @discardableResult
    public func reloadActivity() -> Task<Void, Never> {
        activityTask?.cancel()
        activityGeneration += 1
        let gen = activityGeneration
        if activity.value != nil {
            isActivityRefreshing = true
        } else {
            activity = .loading
        }
        let window = window
        let nsid = nsid
        let client = ufos
        let now = clock()
        let task = Task { [weak self] in
            let sinceIso = UFOsClient.isoAgo(hours: Double(window.hours), now: now)
            let nowIso = Formatting.isoTimestamp(now)
            let priorSinceIso = UFOsClient.isoAgo(hours: Double(window.hours * 2), now: now)
            async let currentCall = client.fetchCollectionStats(collections: [nsid], since: sinceIso, until: nowIso)
            async let priorCall = client.fetchCollectionStats(collections: [nsid], since: priorSinceIso, until: sinceIso)
            async let seriesCall = client.fetchTimeseries(collection: nsid, since: sinceIso, step: window.step)
            let (current, prior, series) = await (currentCall, priorCall, seriesCall)
            guard let self, gen == self.activityGeneration, !Task.isCancelled else { return }
            self.isActivityRefreshing = false
            if current.failed, prior.failed, series.failed {
                self.activity = .failed(LexiconsModel.apiUnavailableMessage)
                return
            }
            self.activity = .loaded(LexiconActivity(
                current: current.stats[nsid] ?? .zero,
                prior: prior.stats[nsid] ?? .zero,
                buckets: series.series[nsid] ?? []
            ))
        }
        activityTask = task
        return task
    }

    /// Refetch the siblings and the samples.
    @discardableResult
    public func reloadSections() -> Task<Void, Never> {
        sectionsTask?.cancel()
        sectionsGeneration += 1
        let gen = sectionsGeneration
        siblings = .loading
        samples = .loading
        let nsid = nsid
        let client = ufos
        let task = Task { [weak self] in
            async let siblingsCall = LexiconDetailModel.loadSiblings(client: client, nsid: nsid)
            async let samplesCall = LexiconDetailModel.loadSamples(client: client, nsid: nsid)
            let (siblings, samples) = await (siblingsCall, samplesCall)
            guard let self, gen == self.sectionsGeneration, !Task.isCancelled else { return }
            self.siblings = siblings
            self.samples = samples
        }
        sectionsTask = task
        return task
    }

    public func cancel() {
        activityTask?.cancel()
        activityTask = nil
        isActivityRefreshing = false
        sectionsTask?.cancel()
        sectionsTask = nil
    }

    /// Wait for the fetches in flight, including a window refetch, for
    /// tests and for a screen that wants to settle before a snapshot.
    public func awaitPending() async {
        await activityTask?.value
        await sectionsTask?.value
    }

    /// `/prefix` needs a 2+ segment group prefix (a single segment 400s)
    /// and 500s when an `order` is passed, so the order is omitted and
    /// the children are ranked here. The lexicon itself is excluded.
    private nonisolated static func loadSiblings(client: UFOsClient, nsid: String) async -> Loadable<[NsidCount]> {
        let prefix = NSID.groupPrefix(nsid)
        guard prefix.contains(".") else { return .loaded([]) }
        let page = await client.fetchPrefix(prefix: prefix)
        if page.failed { return .failed(LexiconsModel.apiUnavailableMessage) }
        var collections: [NsidCount] = []
        for child in page.children {
            if case .collection(let name, let counts) = child, name != nsid {
                collections.append(NsidCount(nsid: name, counts: counts))
            }
        }
        collections.sort { $0.counts.creates > $1.counts.creates }
        return .loaded(Array(collections.prefix(siblingLimit)))
    }

    private nonisolated static func loadSamples(client: UFOsClient, nsid: String) async -> Loadable<[ApiRecord]> {
        let result = await client.fetchRecentRecords(collections: [nsid])
        if result.failed { return .failed(LexiconsModel.apiUnavailableMessage) }
        return .loaded(result.records)
    }

    // MARK: Derived

    /// The four headline tiles in `metricOrder`; nil until the activity
    /// lands (the tiles show a skeleton).
    public var statTiles: [LexiconStatTile]? {
        activity.value.map { activity in
            LexiconDetailModel.metricOrder.map { metric in
                LexiconStatTile(metric: metric, current: activity.current.stat(for: metric), prior: activity.prior.stat(for: metric))
            }
        }
    }

    /// The chart's data: the buckets projected to `metric`; empty until
    /// loaded.
    public var series: [Int] {
        activity.value?.series(for: metric) ?? []
    }

    /// Whether the chart has anything to draw.
    public var hasSeriesActivity: Bool {
        series.contains { $0 > 0 }
    }

    public var chartTitle: String {
        "\(metric.label) over the last \(window.label)"
    }

    /// `hasActivity`: true while unknown so the notice does not flash.
    public var hasActivity: Bool {
        activity.value.map { $0.total > 0 } ?? true
    }

    /// The muted line under the chart once the window is known to be quiet.
    public var noActivityMessage: String? {
        guard activity.value != nil, !hasActivity else { return nil }
        return "No recorded activity for this lexicon in the last \(window.label)."
    }

    public var activityErrorMessage: String? {
        activity.errorMessage.map { "Couldn't reach the UFOs API: \($0)" }
    }

    public var siblingsEmptyMessage: String {
        "No sibling collections found in \(groupPrefix)."
    }

    /// The "Browse all of <group>" link under the siblings: only with
    /// siblings to show and a prefix `/prefix` can enumerate.
    public var browseGroupPath: String? {
        guard let siblings = siblings.value, !siblings.isEmpty, groupPrefix.contains(".") else { return nil }
        return NSID.groupPathFor(groupPrefix)
    }

    public var browseGroupLabel: String? {
        browseGroupPath == nil ? nil : "Browse all of \(groupPrefix) →"
    }

    /// The first `sampleLimit` samples as rows; nil until loaded.
    public var visibleSamples: [LexiconSampleRow]? {
        samples.value.map { records in
            records.prefix(LexiconDetailModel.sampleLimit).enumerated().map { LexiconSampleRow(record: $1, index: $0) }
        }
    }

    /// The chrome bar's submit: route through the group page, which
    /// resolves a namespace, a free-text term, or a full NSID that turns
    /// out to have nothing published under it. Nil for a blank field.
    public func submitSearch() -> SearchDestination? {
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return .lexiconGroup(prefix: trimmed)
    }

    /// Port of `relativeTime`: "just now" for the future, then seconds,
    /// minutes, hours and days, each rounded like `Math.round`.
    public nonisolated static func relativeTime(_ date: Date, now: Date = Date()) -> String {
        let diff = now.timeIntervalSince(date)
        guard diff.isFinite, diff >= 0 else { return "just now" }
        let s = Int(diff.rounded(.toNearestOrAwayFromZero))
        if s < 60 { return "\(s)s ago" }
        let m = Int((Double(s) / 60).rounded(.toNearestOrAwayFromZero))
        if m < 60 { return "\(m)m ago" }
        let h = Int((Double(m) / 60).rounded(.toNearestOrAwayFromZero))
        if h < 24 { return "\(h)h ago" }
        let d = Int((Double(h) / 24).rounded(.toNearestOrAwayFromZero))
        return "\(d)d ago"
    }
}
