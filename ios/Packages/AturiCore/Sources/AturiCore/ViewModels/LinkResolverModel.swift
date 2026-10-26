import Foundation
import Observation

// Port of the universal-link pages (src/app/[handle]/page.tsx,
// profile/[handle]/post/[rkey]/page.tsx, [handle]/[collection]/[rkey]/page.tsx)
// and the state half of WaypointPicker.tsx and AutoRedirectGate.tsx: a pasted
// or shared string in, the identity it names, a preview card and the
// personalised waypoint picker out. This is where a universal link, an
// `at://` URL and the share extension all land.
//
// The pipeline is the web's, one hop per page: `extractAtUriComponents`
// (linkGenerator.ts) reads the input, `parseURI` (uriParser.ts) types it,
// `resolveHandleStatus` decides between a real account, "no such handle"
// and "the resolver is down", and the preview is then fetched the way
// profileFetcher.ts / recordFetcher.ts fetch it. A missing preview never
// hides the picker: the web shows a notice and the picker below it, and so
// does `LinkPreview.unavailable`.

/// The identity (and record) a link resolved to: everything the picker,
/// the share sheet and auto-redirect need, available before the preview
/// has loaded.
public struct ResolvedLink: Hashable, Sendable {
    /// What `extractAtUriComponents` read out of the input.
    public var components: AtUriComponents
    /// The typed reading of those components.
    public var parsed: ParsedURI
    /// The record type the picker is narrowed to.
    public var type: WaypointType
    public var did: String
    /// The handle shown and handed to the waypoint URL builders: the input's
    /// handle, or the DID document's handle when the input was a DID (the
    /// DID itself when the document names none).
    public var handle: String
    /// `getDisplayName(resolvedHandle, did)`: "@alice.test", or a shortened DID.
    public var displayName: String
    public var collection: String?
    public var rkey: String?
    /// `at://did[/collection/rkey]`, the canonical address of the page.
    public var atUri: String
    /// The aturi.to universal link for the share sheet.
    public var aturiLink: String

    public init(
        components: AtUriComponents,
        parsed: ParsedURI,
        type: WaypointType,
        did: String,
        handle: String,
        displayName: String,
        collection: String? = nil,
        rkey: String? = nil,
        atUri: String,
        aturiLink: String
    ) {
        self.components = components
        self.parsed = parsed
        self.type = type
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.collection = collection
        self.rkey = rkey
        self.atUri = atUri
        self.aturiLink = aturiLink
    }

    public var isRecord: Bool {
        collection != nil && rkey != nil
    }

    /// What `AutoRedirectGate` receives on the web.
    public var autoRedirectContext: AutoRedirectContext {
        AutoRedirectContext(type: type, handle: handle, did: did, collection: collection, rkey: rkey)
    }
}

/// The preview card, or why there is none.
public enum LinkPreview: Hashable, Sendable {
    /// A Bluesky post from getPostThread, with the post it replies to.
    case post(BskyPost, parent: BskyPost?)
    /// An AppView profile plus the repo's collection list (nil when the
    /// scan failed, which leaves every waypoint visible).
    case profile(BskyProfile, collections: [String]?)
    /// Any other record, read from the account's PDS, with the identity the
    /// read went through (`pds` is the host that served it).
    case record(AtRecord, identity: IdentityBundle)
    /// The handle definitively does not resolve: the web's 404. No picker.
    case notFound
    /// The identity resolved (so the picker renders) but no preview could be
    /// loaded: a deleted record, an account the AppView does not index, or
    /// a host that is down. The message is the web's notice copy.
    case unavailable(String)
}

@MainActor
@Observable
public final class LinkResolverModel {
    /// Our own host, dropped from auto-redirect destinations so a favourite
    /// served from aturi.to cannot loop.
    public nonisolated static let selfHost = Endpoints.aturiHost
    /// How long the "opening in <favourite>" countdown runs before the app
    /// follows an auto-redirect preference on its own. The web redirects
    /// before paint; on iOS an unexpected app switch is worse, so the
    /// preference becomes a cancellable countdown.
    public nonisolated static let autoRedirectDelay: TimeInterval = 1.5

    /// The input the current resolution is for.
    public private(set) var input = ""
    /// The resolution and preview. `failed` is retryable (a parse error or
    /// the resolver being unreachable); `loaded(.notFound)` is terminal.
    public private(set) var state: Loadable<LinkPreview> = .idle
    /// Set as soon as the identity resolves, before the preview arrives, so
    /// the picker can render under a skeleton card. Nil until then and
    /// after a failure.
    public private(set) var link: ResolvedLink?
    /// Collection NSIDs found in the target repo, when scanned (profile
    /// pages). Waypoints whose `expectedCollections` match none of them are
    /// hidden; nil leaves every waypoint visible.
    public private(set) var repoCollections: [String]?
    /// True while the auto-redirect countdown runs.
    public private(set) var isAutoRedirectArmed = false
    /// The destination the countdown fired for, until the screen consumes it.
    public private(set) var autoRedirectFired: AutoRedirectTarget?

    /// The user's picker preferences: groups, layout, favourites, custom waypoints.
    public let preferences: PreferencesStore

    @ObservationIgnored private let identity: IdentityResolver
    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let pds: PDSClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var redirectTask: Task<Void, Never>?

    /// - Parameters:
    ///   - preferences: the store the picker personalises with; defaults to
    ///     the app group suite.
    ///   - http: the transport every lookup goes through. When it is the
    ///     shared client the shared identity resolver (and its caches) is
    ///     used; a test transport gets a resolver of its own.
    ///   - identity: an explicit resolver, overriding the rule above.
    public init(
        preferences: PreferencesStore? = nil,
        http: HTTPClient = .shared,
        identity: IdentityResolver? = nil
    ) {
        self.preferences = preferences ?? PreferencesStore()
        self.identity = identity ?? (http === HTTPClient.shared ? IdentityResolver.shared : IdentityResolver(http: http))
        self.appView = AppViewClient(client: http)
        self.pds = PDSClient(http: http)
    }

    // MARK: Loading

    /// Resolve `input`, cancelling whatever was in flight.
    public func load(_ input: String) {
        start(input)
    }

    /// `load` and wait for it to settle.
    public func resolve(_ input: String) async {
        start(input)
        await loadTask?.value
    }

    /// Retry the current input (the error panel's button, pull to refresh).
    public func reload() {
        start(input)
    }

    /// Wait for the load in flight, if any.
    public func awaitLoad() async {
        await loadTask?.value
    }

    /// Cancel everything in flight (screen leaving).
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        cancelAutoRedirect()
    }

    private func start(_ raw: String) {
        loadTask?.cancel()
        cancelAutoRedirect()
        input = raw
        link = nil
        repoCollections = nil
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            state = .idle
            loadTask = nil
            return
        }
        state = .loading
        loadTask = Task { [weak self] in
            await self?.perform(trimmed)
        }
    }

    private func perform(_ trimmed: String) async {
        /* The identity half is `LinkResolution`, shared with the Shortcuts
           actions. It throws only when this task was cancelled between
           hops, and a cancelled load leaves the state to its successor. */
        let resolution: LinkResolution
        do {
            resolution = try await LinkResolution.resolve(trimmed, identity: identity)
        } catch {
            return
        }
        let resolved: ResolvedLink
        switch resolution {
        case .invalid(let message), .unavailable(let message):
            state = .failed(message)
            return
        case .notFound:
            state = .loaded(.notFound)
            return
        case .resolved(let link):
            resolved = link
        }
        link = resolved

        switch resolved.type {
        case .profile:
            await loadProfile(resolved)
        case .post:
            await loadPost(resolved)
        default:
            await loadRecord(resolved)
        }
    }

    /// The profile page: the AppView profile and the repo's collection list
    /// are fetched together. A nil scan leaves every waypoint visible rather
    /// than wrongly hiding them.
    private func loadProfile(_ resolved: ResolvedLink) async {
        async let profileLookup = appView.getProfile(resolved.did)
        async let collectionsLookup = identity.fetchRepoCollections(resolved.did)
        let (profile, collections) = await (profileLookup, collectionsLookup)
        guard !Task.isCancelled else { return }
        repoCollections = collections
        if let profile {
            state = .loaded(.profile(profile, collections: collections))
        } else {
            state = .loaded(.unavailable(LinkResolverModel.unavailableMessage(for: .profile)))
        }
    }

    /// The post page: getPostThread for the rich card, falling back to the
    /// generic record read the way `fetchRecordData` does.
    private func loadPost(_ resolved: ResolvedLink) async {
        if let thread = await appView.getPostThread(resolved.atUri) {
            guard !Task.isCancelled else { return }
            state = .loaded(.post(thread.post, parent: thread.parent))
            return
        }
        guard !Task.isCancelled else { return }
        await loadRecord(resolved)
    }

    private func loadRecord(_ resolved: ResolvedLink) async {
        guard resolved.isRecord else {
            state = .loaded(.unavailable(LinkResolverModel.unavailableMessage(for: resolved.type)))
            return
        }
        let fetched = await resolved.fetchRecord(identity: identity, pds: pds)
        guard !Task.isCancelled else { return }
        if let (record, bundle) = fetched {
            state = .loaded(.record(record, identity: bundle))
        } else {
            state = .loaded(.unavailable(LinkResolverModel.unavailableMessage(for: resolved.type)))
        }
    }

    /// The notice the web shows above the picker when there is no preview.
    public nonisolated static func unavailableMessage(for type: WaypointType) -> String {
        switch type {
        case .profile:
            return "We couldn't load a profile preview for this account. It may not be indexed by the Bluesky AppView, or the AppView may be temporarily unavailable. You can still open it in a client below."
        case .post:
            return "We couldn't load a preview for this post. It may have been deleted, or the account's host server may be temporarily unavailable. You can still try opening it in a client below."
        case .list:
            return "We couldn't load a preview for this list. It may have been deleted, or the account's host server may be temporarily unavailable. You can still try opening it in a client below."
        case .record, .unknown:
            return "We couldn't load a preview for this record. It may have been deleted, or the account's host server may be temporarily unavailable. You can still try opening it in a client below."
        }
    }

    // MARK: Picker

    private var prefs: Preferences {
        preferences.prefs
    }

    /// `null` means "no opinion": nothing gets hidden. An empty array is a
    /// real answer (a repo with no collections), so only nil short-circuits.
    private var repoCollectionSet: Set<String>? {
        repoCollections.map(Set.init)
    }

    /// Keep a waypoint unless the repo scan positively confirmed it has no
    /// records for it: `present` and `unknown` pass, only `absent` is dropped.
    private func isActiveForRepo(_ waypoint: Waypoint) -> Bool {
        WaypointCatalog.activity(of: waypoint, repoCollections: repoCollectionSet) != .absent
    }

    /// Whether the waypoint can render this page at all: active for the
    /// repo and able to build a URL for it.
    private func isRenderable(_ waypoint: Waypoint) -> Bool {
        isActiveForRepo(waypoint) && url(for: waypoint) != nil
    }

    /// The waypoint's destination for the resolved link; nil before
    /// resolution and when the client has no page for this input.
    public func url(for waypoint: Waypoint) -> String? {
        guard let link else { return nil }
        return waypoint.url(handle: link.handle, collection: link.collection, rkey: link.rkey, did: link.did)
    }

    /// The picker's groups: the user's arrangement (`personalizeCategorized`)
    /// narrowed to waypoints that are active for the repo and can build a
    /// URL. Groups left empty by the filter are dropped, as the classic
    /// layout drops them on the web. Empty before the identity resolves.
    public var waypoints: [CategorizedWaypoints] {
        guard let link else { return [] }
        return Personalize.personalizeCategorized(prefs, type: link.type).compactMap { group in
            let renderable = group.waypoints.filter(isRenderable)
            guard !renderable.isEmpty else { return nil }
            return CategorizedWaypoints(category: group.category, waypoints: renderable)
        }
    }

    /// The "Recommended for ..." row: the catalog's recommendation for the
    /// collection, narrowed to waypoints the user surfaces and that can
    /// render the page. Nil before resolution; an empty list when the user
    /// has hidden every recommended client.
    public var recommended: RecommendedWaypoints? {
        guard let link else { return nil }
        let raw = WaypointCatalog.recommended(for: link.type, collection: link.collection)
        let personalised = Personalize.personalizeRecommended(raw.waypoints, prefs: prefs).filter(isRenderable)
        return RecommendedWaypoints(waypoints: personalised, label: raw.label)
    }

    /// The first recommendation: the "Open in <client>" primary action.
    public var featured: Waypoint? {
        recommended?.waypoints.first
    }

    /// Every waypoint the user has surfaced in any group, scoped to this
    /// record type and active for the repo (`availableWaypoints` on the web).
    public var availableWaypoints: [Waypoint] {
        guard let link else { return [] }
        var seen = Set<String>()
        let customById = Dictionary(prefs.customWaypoints.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var out: [Waypoint] = []
        for group in prefs.waypointGroups {
            for id in group.waypointIds where seen.insert(id).inserted {
                if let custom = customById[id] {
                    if custom.supportedTypes.contains(link.type) {
                        out.append(Personalize.customToWaypoint(custom))
                    }
                    continue
                }
                if let builtin = WaypointCatalog.all[id], builtin.supportedTypes.contains(link.type) {
                    out.append(builtin)
                }
            }
        }
        return out.filter(isActiveForRepo)
    }

    public var hasWaypoints: Bool {
        !availableWaypoints.isEmpty
    }

    /// Copy for the empty picker.
    public nonisolated static let noWaypointsMessage = "No waypoints available for this content type yet."

    /// `getContextText`: the line under the picker's heading.
    public var contextText: String {
        guard let link else { return "" }
        let display = link.displayName
        switch link.type {
        case .post: return "Open post by \(display) on..."
        case .profile: return "Open profile for \(display) on..."
        case .list: return "Open list by \(display) on..."
        case .record: return "Open record from \(display) on..."
        case .unknown: return "Open content from \(display) on..."
        }
    }

    /// The aturi.to link the share button hands out.
    public var shareLink: String? {
        link?.aturiLink
    }

    public var layout: WaypointLayout {
        prefs.waypointLayout
    }

    /// The layout switch above the list; saved to preferences so it follows
    /// the account.
    public func setLayout(_ layout: WaypointLayout) {
        guard layout != prefs.waypointLayout else { return }
        preferences.update { $0.setWaypointLayout(layout) }
    }

    // MARK: New-waypoint banner

    /// Built-ins that shipped since the user last acknowledged the catalog,
    /// surfaced as a dismissable banner with one-tap add.
    public var newWaypoints: [Waypoint] {
        prefs.newBuiltinWaypointIds.compactMap { WaypointCatalog.all[$0] }
    }

    /// The banner's "Add": into their default groups, and marked known.
    public func addNewWaypoints() {
        let ids = prefs.newBuiltinWaypointIds
        guard !ids.isEmpty else { return }
        preferences.update { $0.addWaypointsToDefaultGroups(ids) }
    }

    /// The banner's dismiss: marked known, not added.
    public func dismissNewWaypoints() {
        let ids = prefs.newBuiltinWaypointIds
        guard !ids.isEmpty else { return }
        preferences.update { $0.markWaypointsKnown(ids) }
    }

    // MARK: Auto-redirect

    /// Where the user's auto-redirect preference would send this page, or
    /// nil for "show the picker". The pure decision from autoRedirect.ts;
    /// the app surfaces it as a one-tap button and, when opened from a
    /// universal link, the countdown below.
    public var autoRedirectTarget: AutoRedirectTarget? {
        guard let link else { return nil }
        return resolveAutoRedirect(prefs, context: link.autoRedirectContext, selfHost: LinkResolverModel.selfHost)
    }

    /// The favourite's display name for the "Open in <name>" button,
    /// built-in or custom (`SuppressedNotice` on the web).
    public var autoRedirectTargetName: String? {
        guard let target = autoRedirectTarget else { return nil }
        return LinkResolverModel.waypointName(target.waypointId, customWaypoints: prefs.customWaypoints)
    }

    /// The compat family's display name for the same notice.
    public var autoRedirectFamilyName: String? {
        guard let target = autoRedirectTarget else { return nil }
        return WaypointCatalog.compatFamilies[target.family]?.name ?? target.family.rawValue
    }

    /// The name of a waypoint id, built-in or custom, with the web's
    /// fallback for an id that no longer exists.
    public nonisolated static func waypointName(_ waypointId: String, customWaypoints: [CustomWaypoint]) -> String {
        if let builtin = WaypointCatalog.all[waypointId] { return builtin.name }
        if let custom = customWaypoints.first(where: { $0.id == waypointId }) { return custom.name }
        return "your preferred client"
    }

    /// Start the countdown: after `delay`, `autoRedirectFired` is set to the
    /// target for the screen to open. Returns the target the countdown is
    /// for, or nil (and nothing armed) when the preference does not apply
    /// to this page. Any sign of interaction should call `cancelAutoRedirect`.
    @discardableResult
    public func armAutoRedirect(after delay: TimeInterval = LinkResolverModel.autoRedirectDelay) -> AutoRedirectTarget? {
        cancelAutoRedirect()
        guard let target = autoRedirectTarget else { return nil }
        isAutoRedirectArmed = true
        redirectTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard !Task.isCancelled, let self else { return }
            self.redirectTask = nil
            self.isAutoRedirectArmed = false
            self.autoRedirectFired = target
        }
        return target
    }

    /// Stop the countdown (the visitor tapped, scrolled, or left).
    public func cancelAutoRedirect() {
        redirectTask?.cancel()
        redirectTask = nil
        isAutoRedirectArmed = false
    }

    /// Take the fired target so the screen opens it exactly once.
    public func consumeAutoRedirect() -> AutoRedirectTarget? {
        defer { autoRedirectFired = nil }
        return autoRedirectFired
    }
}
