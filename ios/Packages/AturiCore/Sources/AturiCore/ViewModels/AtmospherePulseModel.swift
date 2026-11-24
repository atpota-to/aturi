import Foundation
import Observation

// Port of the state behind "This week in the Atmosphere" on the explore
// landing (src/components/explore/lexicons/AtmospherePulse.tsx): the
// trending strip's Top and Trending views as two ranked cards, Most active
// and Rising, beside the new-lexicons list, all under one window and one
// metric control. The full strip, with sparklines, lives on the Lexicons
// tab, which each card's footer leads to.
//
// New lexicons come from aturi.to's `/api/lexicons/new` rather than UFOs
// directly: finding them costs UFOs around thirty requests, so the site
// computes the answer once per cache period behind its CDN
// (src/app/api/lexicons/new/route.ts), as the web's own cards read it.

/// One NSID UFOs saw for the first time in the window.
public struct NewLexicon: Codable, Hashable, Sendable, Identifiable {
    public var id: String { nsid }
    public let nsid: String
    public let creates: Int
    public let didsEstimate: Int

    public init(nsid: String, creates: Int, didsEstimate: Int) {
        self.nsid = nsid
        self.creates = creates
        self.didsEstimate = didsEstimate
    }
}

/// `/api/lexicons/new`'s answer: the first fifty of `count` new lexicons,
/// each used by at least `minAccounts` accounts. Its shape follows the
/// explorer section and is not part of the documented REST API.
public struct NewLexiconsAnswer: Codable, Hashable, Sendable {
    public let ok: Bool
    public let minAccounts: Int?
    public let historyBegins: String?
    public let count: Int
    public let lexicons: [NewLexicon]

    public init(ok: Bool = true, minAccounts: Int? = 3, historyBegins: String? = nil, count: Int, lexicons: [NewLexicon]) {
        self.ok = ok
        self.minAccounts = minAccounts
        self.historyBegins = historyBegins
        self.count = count
        self.lexicons = lexicons
    }
}

/// Reads `https://aturi.to/api/lexicons/new?window=7d`. Nil on any failure,
/// a non-2xx answer or an answer that does not say `ok`.
public struct NewLexiconsClient: Sendable {
    public static let path = "/api/lexicons/new"

    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    public static func url(window: UFOsWindow) -> URL {
        makeURL(Endpoints.aturiBase, path: path, query: [("window", window.rawValue)])
    }

    public func fetch(window: UFOsWindow) async -> NewLexiconsAnswer? {
        guard let answer = await http.getJSONOrNil(NewLexiconsAnswer.self, from: Self.url(window: window)),
              answer.ok
        else { return nil }
        return answer
    }
}

/// The landing's three cards, one `Loadable` each, so a slow or failed card
/// never holds up the others. Changing the window refetches all three, the
/// metric the two ranked ones; the previous rows stay up meanwhile, so the
/// skeleton only shows on the first load.
@MainActor
@Observable
public final class AtmospherePulseModel {
    /// The ranked cards' `RESULT_COUNT` / `EXPANDED_COUNT`.
    public nonisolated static let resultCount = LexiconsModel.resultCount
    public nonisolated static let expandedCount = LexiconsModel.expandedCount
    /// `NEW_RESULT_COUNT` / `NEW_EXPANDED_COUNT`.
    public nonisolated static let newResultCount = 10
    public nonisolated static let newExpandedCount = 25
    public nonisolated static let rankingEmptyMessage = LexiconsModel.rankingEmptyMessage
    public nonisolated static let newEmptyMessage = "Nothing new with 3+ accounts in this window."
    public nonisolated static let newUnavailableMessage = "aturi.to did not answer"

    public var window: UFOsWindow = .sevenDays {
        didSet { if window != oldValue, hasStarted { reloadAll() } }
    }
    public var metric: Metric = .dids {
        didSet { if metric != oldValue, hasStarted { reloadRankings() } }
    }
    /// "Show top 20" on each ranked card; the fetch limit follows it.
    public var topExpanded = false {
        didSet { if topExpanded != oldValue, hasStarted { reloadTop() } }
    }
    public var risingExpanded = false {
        didSet { if risingExpanded != oldValue, hasStarted { reloadRising() } }
    }
    /// "Show 25 of N": the new list is fetched whole, so this only slices.
    public var newExpanded = false

    public private(set) var top: Loadable<[LexiconRankingRow]> = .idle
    public private(set) var rising: Loadable<[LexiconRankingRow]> = .idle
    public private(set) var newLexicons: Loadable<NewLexiconsAnswer> = .idle

    @ObservationIgnored private let ufos: UFOsClient
    @ObservationIgnored private let newClient: NewLexiconsClient
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var topTask: Task<Void, Never>?
    @ObservationIgnored private var risingTask: Task<Void, Never>?
    @ObservationIgnored private var newTask: Task<Void, Never>?
    @ObservationIgnored private var topGeneration = 0
    @ObservationIgnored private var risingGeneration = 0
    @ObservationIgnored private var newGeneration = 0

    public init(http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        ufos = UFOsClient(http: http)
        newClient = NewLexiconsClient(http: http)
        self.clock = clock
    }

    // MARK: Loading

    /// Fetch all three cards. Toggles set before this call are honoured by
    /// the first fetch and only start refetching once it has run.
    @discardableResult
    public func load() -> Task<Void, Never> {
        hasStarted = true
        reloadAll()
        return Task { await self.awaitPending() }
    }

    public func awaitPending() async {
        await topTask?.value
        await risingTask?.value
        await newTask?.value
    }

    public func cancel() {
        topTask?.cancel()
        risingTask?.cancel()
        newTask?.cancel()
    }

    private func reloadAll() {
        reloadRankings()
        reloadNew()
    }

    private func reloadRankings() {
        reloadTop()
        reloadRising()
    }

    private func reloadTop() {
        topTask?.cancel()
        topGeneration += 1
        let gen = topGeneration
        if top.value == nil { top = .loading }
        let request = rankingRequest(mode: .top, expanded: topExpanded)
        topTask = Task { [weak self] in
            let rows = await request()
            guard let self, gen == self.topGeneration, !Task.isCancelled else { return }
            if let rows {
                self.top = .loaded(rows)
            } else {
                self.top = .failed(LexiconsModel.apiUnavailableMessage)
            }
        }
    }

    private func reloadRising() {
        risingTask?.cancel()
        risingGeneration += 1
        let gen = risingGeneration
        if rising.value == nil { rising = .loading }
        let request = rankingRequest(mode: .trending, expanded: risingExpanded)
        risingTask = Task { [weak self] in
            let rows = await request()
            guard let self, gen == self.risingGeneration, !Task.isCancelled else { return }
            if let rows {
                self.rising = .loaded(rows)
            } else {
                self.rising = .failed(LexiconsModel.apiUnavailableMessage)
            }
        }
    }

    /// The cards draw no sparklines, so no per-row series requests; Most
    /// active fetches the prior window too so its rows carry a delta.
    private func rankingRequest(mode: LexiconRankingMode, expanded: Bool) -> @Sendable () async -> [LexiconRankingRow]? {
        let window = window
        let metric = metric
        let limit = expanded ? Self.expandedCount : Self.resultCount
        let client = ufos
        let now = clock()
        return {
            await LexiconsModel.fetchRanking(
                window: window, mode: mode, metric: metric, resultCount: limit,
                withSeries: false, withPrior: true,
                client: client, now: now
            )
        }
    }

    private func reloadNew() {
        newTask?.cancel()
        newGeneration += 1
        let gen = newGeneration
        if newLexicons.value == nil { newLexicons = .loading }
        let window = window
        let client = newClient
        newTask = Task { [weak self] in
            let answer = await client.fetch(window: window)
            guard let self, gen == self.newGeneration, !Task.isCancelled else { return }
            if let answer {
                self.newLexicons = .loaded(answer)
            } else {
                self.newLexicons = .failed(AtmospherePulseModel.newUnavailableMessage)
            }
        }
    }

    // MARK: Rows

    public var visibleTop: [LexiconRankingRow]? {
        top.value.map { Array($0.prefix(topExpanded ? Self.expandedCount : Self.resultCount)) }
    }

    public var visibleRising: [LexiconRankingRow]? {
        rising.value.map { Array($0.prefix(risingExpanded ? Self.expandedCount : Self.resultCount)) }
    }

    public var visibleNew: [NewLexicon]? {
        newLexicons.value.map { Array($0.lexicons.prefix(newExpanded ? Self.newExpandedCount : Self.newResultCount)) }
    }

    /// The bar's length in Most active, on a log scale as the web draws it:
    /// app.bsky.feed.like sits two orders of magnitude above the rest, and a
    /// linear bar drew rows 2 to 10 as the same stub. At least 2%.
    public nonisolated static func barFraction(_ value: Int, max: Int) -> Double {
        let top = Swift.max(1, max)
        let fraction = log10(Double(value) + 1) / log10(Double(top) + 1)
        return Swift.min(1, Swift.max(0.02, fraction))
    }

    // MARK: Copy (WINDOW_NAMES and METRIC_NOUN in AtmospherePulse.tsx)

    public nonisolated static func windowLabel(_ window: UFOsWindow) -> String {
        switch window {
        case .oneDay: return "Day"
        case .sevenDays: return "Week"
        case .thirtyDays: return "Month"
        }
    }

    public nonisolated static func windowNoun(_ window: UFOsWindow) -> String {
        switch window {
        case .oneDay: return "day"
        case .sevenDays: return "week"
        case .thirtyDays: return "month"
        }
    }

    public nonisolated static func metricNoun(_ metric: Metric) -> String {
        switch metric {
        case .dids: return "Accounts"
        case .creates: return "Records created"
        case .updates: return "Records updated"
        case .deletes: return "Records deleted"
        }
    }

    public var heading: String {
        switch window {
        case .oneDay: return "Today in the Atmosphere"
        case .sevenDays: return "This week in the Atmosphere"
        case .thirtyDays: return "This month in the Atmosphere"
        }
    }

    public var headingDetail: String {
        "Compared with the \(Self.windowNoun(window)) before, via UFOs"
    }

    private var comparison: String {
        switch window {
        case .oneDay: return "yesterday \u{2192} today"
        case .sevenDays: return "last week \u{2192} this week"
        case .thirtyDays: return "last month \u{2192} this month"
        }
    }

    public var topSubtitle: String {
        "By \(metricUnit)"
    }

    public var risingSubtitle: String {
        "\(Self.metricNoun(metric)) \(comparison)"
    }

    public var newTitle: String {
        window == .oneDay ? "New today" : "New this \(Self.windowNoun(window))"
    }

    public var newSubtitle: String {
        "By accounts"
    }

    /// The unit a row's figures count, for accessibility labels.
    public var metricUnit: String {
        Self.metricNoun(metric).lowercased()
    }

    // MARK: Card feet

    public var showsTopToggle: Bool {
        guard let rows = visibleTop else { return false }
        return topExpanded || rows.count >= Self.resultCount
    }

    public var showsRisingToggle: Bool {
        guard let rows = visibleRising else { return false }
        return risingExpanded || rows.count >= Self.resultCount
    }

    public var topToggleLabel: String {
        topExpanded ? "Show top \(Self.resultCount)" : "Show top \(Self.expandedCount)"
    }

    public var risingToggleLabel: String {
        risingExpanded ? "Show top \(Self.resultCount)" : "Show top \(Self.expandedCount)"
    }

    public var showsNewToggle: Bool {
        (newLexicons.value?.count ?? 0) > Self.newResultCount
    }

    public var newToggleLabel: String {
        let count = newLexicons.value?.count ?? 0
        return newExpanded
            ? "Show \(Self.newResultCount)"
            : "Show \(Swift.min(count, Self.newExpandedCount)) of \(count)"
    }

    // MARK: Errors

    public var topErrorMessage: String? {
        top.errorMessage.map { "Couldn\u{2019}t reach the UFOs API: \($0)" }
    }

    public var risingErrorMessage: String? {
        rising.errorMessage.map { "Couldn\u{2019}t reach the UFOs API: \($0)" }
    }

    public var newErrorMessage: String? {
        newLexicons.errorMessage.map { "Couldn\u{2019}t load new lexicons: \($0)" }
    }
}
