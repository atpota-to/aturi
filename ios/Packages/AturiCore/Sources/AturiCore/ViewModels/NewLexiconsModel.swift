import Foundation
import Observation

/// Port of the state behind "New lexicons" on /explore/lexicons
/// (src/components/explore/lexicons/NewLexicons.tsx): NSIDs UFOs saw for the
/// first time in the window, used by three or more accounts, under the
/// section's own window control. The landing's "New this week" card reads
/// the same `/api/lexicons/new` through `AtmospherePulseModel`, under the
/// pulse's shared window; this one stands alone on the Lexicons tab.
///
/// As in the trending strip, the previous answer stays up while a new
/// window loads, so the skeleton only shows on the first load.
@MainActor
@Observable
public final class NewLexiconsModel {
    /// `NEW_RESULT_COUNT` / `NEW_EXPANDED_COUNT`.
    public nonisolated static let resultCount = AtmospherePulseModel.newResultCount
    public nonisolated static let expandedCount = AtmospherePulseModel.newExpandedCount

    public nonisolated static let title = "New lexicons"
    public nonisolated static let subtitle = "Record types seen for the first time in this window, with three or more accounts using them."
    public nonisolated static let emptyMessage = AtmospherePulseModel.newEmptyMessage

    public var window: UFOsWindow = .sevenDays {
        didSet { if window != oldValue, hasStarted { reload() } }
    }
    /// "Show 25 of N": the list is fetched whole, so this only slices.
    public var expanded = false

    public private(set) var answer: Loadable<NewLexiconsAnswer> = .idle
    /// A fetch is in flight, the first or a window change.
    public private(set) var isFetching = false

    @ObservationIgnored private let client: NewLexiconsClient
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared) {
        client = NewLexiconsClient(http: http)
    }

    // MARK: Loading

    /// Fetch the list for the current window. A window chosen before this
    /// call is honoured by it; changes after it refetch on their own.
    @discardableResult
    public func load() -> Task<Void, Never> {
        hasStarted = true
        reload()
        return Task { await self.awaitPending() }
    }

    public func awaitPending() async {
        await task?.value
    }

    public func cancel() {
        task?.cancel()
        isFetching = false
    }

    private func reload() {
        task?.cancel()
        generation += 1
        let gen = generation
        if answer.value == nil { answer = .loading }
        isFetching = true
        let window = window
        let client = client
        task = Task { [weak self] in
            let fetched = await client.fetch(window: window)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.isFetching = false
            if let fetched {
                self.answer = .loaded(fetched)
            } else {
                self.answer = .failed(AtmospherePulseModel.newUnavailableMessage)
            }
        }
    }

    // MARK: Rows

    public var visible: [NewLexicon]? {
        answer.value.map { Array($0.lexicons.prefix(expanded ? Self.expandedCount : Self.resultCount)) }
    }

    /// A window change is loading behind rows that are already up.
    public var isRefreshing: Bool {
        isFetching && answer.value != nil
    }

    public var showsToggle: Bool {
        (answer.value?.count ?? 0) > Self.resultCount
    }

    public var toggleLabel: String {
        let count = answer.value?.count ?? 0
        return expanded
            ? "Show \(Self.resultCount)"
            : "Show \(Swift.min(count, Self.expandedCount)) of \(count)"
    }

    public var errorMessage: String? {
        answer.errorMessage.map { "Couldn\u{2019}t load new lexicons: \($0)" }
    }

    /// What "first seen" means, under the rows once an answer is in. Nil
    /// when the answer does not say when UFOs' history begins.
    public var note: String? {
        guard let historyBegins = answer.value?.historyBegins, !historyBegins.isEmpty else { return nil }
        return "First seen means no activity UFOs recorded between \(historyBegins), when its history begins, and the start of the window. Account counts are estimates, and a few accounts can still be one developer testing."
    }
}
