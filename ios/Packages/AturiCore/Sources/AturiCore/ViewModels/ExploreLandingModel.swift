import Foundation
import Observation

// Port of the state behind src/components/explore/ExploreLanding.tsx,
// SearchBox.tsx and SearchRecommendations.tsx: the search input with its
// debounced AppView typeahead, the "recent" / "frequent" rows drawn from the
// device-local history (and their one-time avatar backfill), the example
// repos under the box, and the signed-in account's own repo chip. Routing a
// submitted string is `SearchRouting`; recording it is `SearchHistoryStore`.
//
// The model never navigates. `submit`, `pick(actor:)` and `pick(entry:)`
// return the `SearchDestination` the screen should push, which is the
// `router.push(path)` the web performs.

@MainActor
@Observable
public final class ExploreLandingModel {
    /// `SUGGESTIONS` from ExploreLanding.tsx: the "Try:" chips.
    public nonisolated static let exampleRepos = ["dame.is", "anisota.net", "aturi.to", "atpota.to"]
    /// `TYPEAHEAD_DEBOUNCE_MS`.
    public nonisolated static let typeaheadDebounce: TimeInterval = 0.18
    /// The explorer search box asks for eight suggestions (the compact
    /// header panel asks for six; this model backs the explorer).
    public nonisolated static let typeaheadLimit = 8
    /// Shortest query worth a typeahead request, in UTF-16 units like the
    /// web's `length` check.
    public nonisolated static let typeaheadMinLength = 2
    /// `RECENTS_LIMIT` / `FREQUENT_LIMIT`.
    public nonisolated static let recentsLimit = 6
    public nonisolated static let frequentLimit = 4

    /// The text in the box. Every change re-arms the typeahead timer and
    /// opens the suggestion area, as typing does on the web.
    public var query: String {
        didSet {
            if query != oldValue { queryDidChange() }
        }
    }

    /// Whether the suggestion area is open: set on focus and on typing,
    /// cleared on submit, on a pick and on dismiss.
    public var isFocused = false

    /// The AppView's suggestions for the current query. `idle` when the
    /// query is not worth asking about (blank, a DID, an at:// URI, or
    /// under two characters).
    public private(set) var typeahead: Loadable<[ActorTypeaheadResult]> = .idle

    /// True from the keystroke until the (debounced) lookup answers. The
    /// previous suggestions stay on screen meanwhile, as they do on the web.
    public private(set) var isTypeaheadPending = false

    /// Keyboard highlight into `suggestions`; -1 for none.
    public private(set) var highlightIndex = -1

    /// Submitting an unrecognised URL costs a round trip to the AT Tags
    /// endpoint, so the button reflects that instead of appearing to
    /// swallow the tap.
    public private(set) var isResolving = false

    /// The signed-in account, if any. Changing the DID refetches the
    /// profile that upgrades the "your repo" chip from DID to handle.
    public var session: SessionState {
        didSet {
            if session.did != oldValue.did { refreshSessionProfile() }
        }
    }

    /// The signed-in account's AppView profile once it lands; nil while
    /// loading, when signed out, or when the AppView does not know the account.
    public private(set) var sessionProfile: BskyProfile?

    /// The device-local history behind the recommendation rows.
    public let history: SearchHistoryStore

    @ObservationIgnored private let http: HTTPClient
    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let debounce: TimeInterval
    @ObservationIgnored private var typeaheadTask: Task<Void, Never>?
    @ObservationIgnored private var profileTask: Task<Void, Never>?
    /// Actors already looked up for avatar backfill this session, so a
    /// dropdown that opens ten times does not ask the AppView ten times
    /// about an account that legitimately has no avatar.
    @ObservationIgnored private var enrichmentAttempted: Set<String> = []

    /// - Parameters:
    ///   - history: the history store; defaults to the app group suite so
    ///     the share extension and the app see one list.
    ///   - http: the transport every AppView and AT Tags call goes through,
    ///     injectable for tests.
    ///   - typeaheadDebounce: injectable so tests do not wait on the real timer.
    public init(
        history: SearchHistoryStore? = nil,
        http: HTTPClient = .shared,
        session: SessionState = .signedOut,
        initialQuery: String = "",
        typeaheadDebounce: TimeInterval = ExploreLandingModel.typeaheadDebounce
    ) {
        self.history = history ?? SearchHistoryStore(defaults: PreferencesStore.appGroupDefaults())
        self.http = http
        self.appView = AppViewClient(client: http)
        self.debounce = typeaheadDebounce
        self.query = initialQuery
        self.session = session
        if session.isSignedIn { refreshSessionProfile() }
    }

    // MARK: Derived state

    /// The suggestion rows, empty until the AppView answers.
    public var suggestions: [ActorTypeaheadResult] {
        typeahead.value ?? []
    }

    public var highlightedSuggestion: ActorTypeaheadResult? {
        guard highlightIndex >= 0, highlightIndex < suggestions.count else { return nil }
        return suggestions[highlightIndex]
    }

    /// `showList`: the typeahead dropdown is open.
    public var showsSuggestionList: Bool {
        isFocused && !suggestions.isEmpty
    }

    public var recents: [SearchHistoryEntry] {
        history.recents(limit: ExploreLandingModel.recentsLimit)
    }

    public var frequent: [SearchHistoryEntry] {
        history.frequent(limit: ExploreLandingModel.frequentLimit)
    }

    /// `showRecommendations`: only on an empty, focused input with something
    /// to recommend. Once the user types, the typeahead list takes over.
    public var showsRecommendations: Bool {
        guard isFocused, !showsSuggestionList else { return false }
        guard query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return !recents.isEmpty || !frequent.isEmpty
    }

    /// `myRepo`: the signed-in account's handle, or its DID until the
    /// profile lands (the explorer route accepts both). Nil when signed out.
    public var myRepo: String? {
        guard let did = session.did else { return nil }
        if let profile = sessionProfile, profile.did == did, !profile.handle.isEmpty {
            return profile.handle
        }
        return did
    }

    /// The example chips, minus the user's own repo when it happens to be
    /// one of the hard-coded examples, so it is not shown twice.
    public var otherExampleRepos: [String] {
        guard let mine = myRepo else { return ExploreLandingModel.exampleRepos }
        return ExploreLandingModel.exampleRepos.filter { $0 != mine }
    }

    // MARK: Focus and keyboard

    /// The input gained focus: open the suggestion area and re-read the
    /// history so visits recorded since (this screen or the extension) show up.
    public func focus() {
        history.reload()
        isFocused = true
    }

    public func dismissSuggestions() {
        isFocused = false
    }

    /// ArrowDown: wrap around the list.
    public func highlightNext() {
        guard !suggestions.isEmpty else { return }
        highlightIndex = (highlightIndex + 1) % suggestions.count
    }

    /// ArrowUp: wrap around the list.
    public func highlightPrevious() {
        guard !suggestions.isEmpty else { return }
        highlightIndex = highlightIndex <= 0 ? suggestions.count - 1 : highlightIndex - 1
    }

    /// Pointer hover over a row.
    public func setHighlight(_ index: Int) {
        highlightIndex = (index >= 0 && index < suggestions.count) ? index : -1
    }

    // MARK: Typeahead

    /// Whether the value is worth a typeahead request. The AppView typeahead
    /// is handle and display-name oriented, so DIDs and at:// URIs are
    /// skipped rather than sent and discarded.
    public nonisolated static func shouldQueryTypeahead(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return false }
        if trimmed.hasPrefix("did:") || trimmed.hasPrefix("at://") { return false }
        return trimmed.utf16.count >= typeaheadMinLength
    }

    private func queryDidChange() {
        isFocused = true
        typeaheadTask?.cancel()
        typeaheadTask = nil
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ExploreLandingModel.shouldQueryTypeahead(trimmed) else {
            typeahead = .idle
            highlightIndex = -1
            isTypeaheadPending = false
            return
        }
        isTypeaheadPending = true
        let delay = debounce
        let limit = ExploreLandingModel.typeaheadLimit
        let appView = self.appView
        typeaheadTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            let results = await appView.searchActorsTypeahead(trimmed, limit: limit)
            guard !Task.isCancelled, let self else { return }
            self.typeahead = .loaded(results)
            self.highlightIndex = -1
            self.isTypeaheadPending = false
            self.typeaheadTask = nil
        }
    }

    /// Wait for the debounced lookup in flight, if any. For tests and for a
    /// screen that wants to settle before a snapshot.
    public func awaitPendingTypeahead() async {
        await typeaheadTask?.value
    }

    // MARK: Submitting and picking

    /// The form's submit. A highlighted suggestion wins; otherwise the text
    /// is routed (asking aturi.to about the page's AT Tags when it is an
    /// unrecognised URL) and recorded as a query visit. Nil when the text
    /// routes nowhere, or when a submit is already in flight.
    public func submit() async -> SearchDestination? {
        isFocused = false
        if let actor = highlightedSuggestion {
            return pick(actor: actor)
        }
        guard !isResolving else { return nil }
        isResolving = true
        defer { isResolving = false }
        let value = query
        guard let path = await SearchRouting.resolveSearchPathAsync(value, http: http) else { return nil }
        history.recordQueryVisit(value, path: path)
        return SearchDestination(explorePath: path)
    }

    /// A typeahead row was chosen: remember the actor (with avatar and
    /// display name, which a free-text search never captures) and go to
    /// the repo.
    public func pick(actor: ActorTypeaheadResult) -> SearchDestination {
        history.recordActorVisit(did: actor.did, handle: actor.handle, displayName: actor.displayName, avatar: actor.avatar)
        isFocused = false
        return .repo(actor.handle)
    }

    /// A recommendation row was chosen. Re-picking bumps the count; the
    /// merge logic keeps the stored avatar and handle.
    public func pick(entry: SearchHistoryEntry) -> SearchDestination {
        history.recordQueryVisit(entry.label, path: entry.path)
        isFocused = false
        return SearchDestination(explorePath: entry.path)
    }

    // MARK: Avatar backfill

    /// Port of `enrichRecommendationAvatars`: entries recorded from
    /// free-text searches only know their path and label, so the displayed
    /// actor entries without an avatar are resolved against the AppView and
    /// the avatar, display name and handle written back into the history,
    /// once per actor per session. PDS entries have no actor and are
    /// skipped. Returns whether anything changed, so the screen can redraw.
    @discardableResult
    public func enrichRecommendationAvatars() async -> Bool {
        var pending: [(path: String, actor: String)] = []
        for entry in recents + frequent {
            if let avatar = entry.avatar, !avatar.isEmpty { continue }
            guard let actor = SearchHistory.actorFromPath(entry.path) else { continue }
            guard enrichmentAttempted.insert(actor).inserted else { continue }
            pending.append((entry.path, actor))
        }
        guard !pending.isEmpty else { return false }

        let appView = self.appView
        let profiles = await withTaskGroup(of: (String, BskyProfile?).self, returning: [(String, BskyProfile?)].self) { group in
            for item in pending {
                group.addTask { (item.path, await appView.getProfile(item.actor)) }
            }
            var collected: [(String, BskyProfile?)] = []
            for await result in group { collected.append(result) }
            return collected
        }

        var changed = false
        for (path, profile) in profiles {
            guard let profile else { continue }
            var patch = SearchHistoryPatch()
            if let avatar = profile.avatar, !avatar.isEmpty { patch.avatar = avatar }
            if !profile.did.isEmpty { patch.did = profile.did }
            if !profile.handle.isEmpty { patch.handle = profile.handle }
            let displayName = profile.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !displayName.isEmpty {
                patch.label = displayName
                if !profile.handle.isEmpty { patch.sublabel = "@\(profile.handle)" }
            }
            if patch == SearchHistoryPatch() { continue }
            if history.enrich(path: path, patch: patch) { changed = true }
        }
        return changed
    }

    // MARK: Session profile

    private func refreshSessionProfile() {
        profileTask?.cancel()
        profileTask = nil
        sessionProfile = nil
        guard let did = session.did else { return }
        let appView = self.appView
        profileTask = Task { [weak self] in
            let profile = await appView.getProfile(did)
            guard !Task.isCancelled, let self else { return }
            self.sessionProfile = profile
            self.profileTask = nil
        }
    }

    /// Wait for the signed-in profile lookup in flight, if any.
    public func awaitSessionProfile() async {
        await profileTask?.value
    }

    // MARK: Lifecycle

    /// Cancel the lookups in flight (screen leaving).
    public func cancel() {
        typeaheadTask?.cancel()
        typeaheadTask = nil
        isTypeaheadPending = false
        profileTask?.cancel()
        profileTask = nil
    }
}
