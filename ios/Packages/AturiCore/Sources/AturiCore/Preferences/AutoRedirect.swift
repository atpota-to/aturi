import Foundation

// Port of the pure decision half of src/utils/autoRedirect.ts: given the
// record a universal link is about and the user's family favourites, which
// client (if any) should open it. The web's localStorage cache, breadcrumb
// and back/forward suppression are browser concerns and are not ported; on
// iOS the app surfaces the target as a one-tap button and a cancellable
// countdown instead of navigating without a tap.
//
// A signed-in account's `to.aturi.client.declaration` record fills
// any family it has no favourite for (`effectiveFavorites`); it never
// overrides a favourite, and the master switch still decides.

/// The record a universal-link page is about.
public struct AutoRedirectContext: Hashable, Sendable {
    public var type: WaypointType
    public var handle: String
    public var did: String?
    public var collection: String?
    public var rkey: String?

    public init(type: WaypointType, handle: String, did: String? = nil, collection: String? = nil, rkey: String? = nil) {
        self.type = type
        self.handle = handle
        self.did = did
        self.collection = collection
        self.rkey = rkey
    }
}

/// A waypoint that can render the current page, with its URL resolved.
public struct AutoRedirectCandidate: Hashable, Sendable, Identifiable {
    public var id: String
    public var url: String
    public var families: [RedirectCompatFamily]

    public init(id: String, url: String, families: [RedirectCompatFamily]) {
        self.id = id
        self.url = url
        self.families = families
    }
}

public struct AutoRedirectTarget: Hashable, Sendable {
    public var waypointId: String
    public var family: RedirectCompatFamily
    public var url: String

    public init(waypointId: String, family: RedirectCompatFamily, url: String) {
        self.waypointId = waypointId
        self.family = family
        self.url = url
    }
}

/// The slice of preferences the web caches before paint: the master switch
/// and the favourites. Kept so the two surfaces describe the same thing.
public struct AutoRedirectCache: Hashable, Sendable {
    public var enabled: Bool
    public var byFamily: [RedirectCompatFamily: String]

    public init(enabled: Bool, byFamily: [RedirectCompatFamily: String]) {
        self.enabled = enabled
        self.byFamily = byFamily
    }

    /// `parseAutoRedirectCache`: junk is nil, a missing switch is disabled,
    /// unknown families and non-string ids are dropped.
    public init?(parsing raw: String) {
        guard let data = raw.data(using: .utf8), let json = try? JSONValue.parse(data), json.objectValue != nil else { return nil }
        self.init(json: json)
    }

    public init?(json: JSONValue) {
        guard json.objectValue != nil else { return nil }
        var byFamily: [RedirectCompatFamily: String] = [:]
        let source = json["byFamily"]?.objectValue ?? [:]
        for family in WaypointCatalog.compatFamilyOrder {
            if let id = source[family.rawValue]?.stringValue, !id.isEmpty { byFamily[family] = id }
        }
        self.init(enabled: json["enabled"]?.boolValue == true, byFamily: byFamily)
    }

    public var jsonValue: JSONValue {
        var families: [String: JSONValue] = [:]
        for (family, id) in byFamily { families[family.rawValue] = .string(id) }
        return .object(["enabled": .bool(enabled), "byFamily": .object(families)])
    }
}

/// The signed-in account's declaration as auto-redirect reads it: the
/// record, and which half of each mobile/desktop split applies here.
public struct DeclaredClients: Hashable, Sendable {
    public var record: PreferredClientsRecord
    public var platform: ClientPlatform

    public init(record: PreferredClientsRecord, platform: ClientPlatform) {
        self.record = record
        self.platform = platform
    }
}

/// Prefix of the favourite id a declared client stands under when it isn't a
/// catalog waypoint, e.g. `declared:bluesky-social`.
public let declaredClientIdPrefix = "declared:"

/// Families a declared client from outside the catalog may serve. Catalog
/// clients bring their own `expectedCollections`; these bring only
/// templates, so the family's scope stands in. Any other family counts a
/// declaration only when it names a catalog waypoint.
private let templateClientFamilies: Set<RedirectCompatFamily> = [.blueskySocial, .atprotoExplorer]

private func declaredTemplatesCover(_ family: RedirectCompatFamily, collection: String?) -> Bool {
    if family == .blueskySocial {
        guard let collection, !collection.isEmpty else { return true }
        return collection.hasPrefix("app.bsky.")
    }
    return templateClientFamilies.contains(family)
}

/// The declared client auto-redirect would follow for a family, and the
/// favourite id it stands under: the catalog id when the client is a
/// catalog waypoint of that family, else a `declared:` id for the families
/// a template-only client may serve.
public func declaredFavorite(_ declared: DeclaredClients, family: RedirectCompatFamily) -> (id: String, client: DeclaredClient)? {
    guard let client = declared.record.client(for: family.rawValue, platform: declared.platform) else { return nil }
    if let waypoint = client.waypoint, WaypointCatalog.all[waypoint]?.redirectCompat.contains(family) == true {
        return (waypoint, client)
    }
    if templateClientFamilies.contains(family) {
        return (declaredClientIdPrefix + family.rawValue, client)
    }
    return nil
}

/// The favourites auto-redirect acts on: the user's own, with declared
/// clients filling the families left empty when `followDeclaredClients`
/// allows. A favourite always wins, even one that can't render the page.
public func effectiveFavorites(_ prefs: Preferences, declared: DeclaredClients?) -> [RedirectCompatFamily: String] {
    var out: [RedirectCompatFamily: String] = [:]
    for family in WaypointCatalog.compatFamilyOrder {
        if let own = prefs.favoriteByFamily[family], !own.isEmpty {
            out[family] = own
            continue
        }
        guard let declared, prefs.followDeclaredClients, let fill = declaredFavorite(declared, family: family) else { continue }
        out[family] = fill.id
    }
    return out
}

/// Whether a resolved destination is safe to open without a tap. Custom
/// waypoint templates come from the user's PDS record, which anything
/// holding a token for their PDS can write, and auto-redirect follows the
/// result with no interaction: only http and https schemes pass, and our own
/// host is refused so a template pointing back at aturi.to cannot loop.
/// Anything unparsable is unsafe. Leading and trailing whitespace is
/// trimmed the way `new URL` trims it, so "  javascript:..." is still rejected
/// by its scheme rather than accepted as relative.
public func isSafeRedirectUrl(_ url: String, selfHost: String? = nil) -> Bool {
    let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let colon = trimmed.firstIndex(of: ":") else { return false }
    let scheme = trimmed[trimmed.startIndex..<colon].lowercased()
    guard scheme == "https" || scheme == "http" else { return false }
    guard let host = WaypointCatalog.hostComponent(of: trimmed) else { return false }
    if let selfHost, !selfHost.isEmpty, host == selfHost.lowercased() { return false }
    return true
}

/// Whether a waypoint claims the collection in play. One that declares
/// `expectedCollections` only handles those namespaces; one that declares
/// none has no opinion and passes, which is what lets a generic explorer
/// favourite work on every kind of page.
private func waypointClaimsCollection(expectedCollections: [String]?, collection: String?) -> Bool {
    guard let collection, !collection.isEmpty else { return true }
    guard let expected = expectedCollections, !expected.isEmpty else { return true }
    return WaypointCatalog.activity(expectedCollections: expected, repoCollections: [collection]) == .present
}

/// Every built-in waypoint that could open this page, in catalog order. A
/// waypoint qualifies when it opts into redirects at all (an empty
/// `redirectCompat` is the explicit opt-out), handles this record type,
/// claims this collection, and produces a URL that passes
/// `isSafeRedirectUrl`. `selfHost` drops Aturi Explore, a member of the
/// explorer family that lives on aturi.to.
public func buildAutoRedirectCandidates(_ context: AutoRedirectContext, selfHost: String? = nil) -> [AutoRedirectCandidate] {
    var out: [AutoRedirectCandidate] = []
    for id in WaypointCatalog.order {
        guard let waypoint = WaypointCatalog.all[id] else { continue }
        if waypoint.redirectCompat.isEmpty { continue }
        if !waypoint.supportedTypes.contains(context.type) { continue }
        if !waypointClaimsCollection(expectedCollections: waypoint.expectedCollections, collection: context.collection) { continue }
        guard let url = waypoint.url(handle: context.handle, collection: context.collection, rkey: context.rkey, did: context.did) else { continue }
        if !isSafeRedirectUrl(url, selfHost: selfHost) { continue }
        out.append(AutoRedirectCandidate(id: id, url: url, families: waypoint.redirectCompat))
    }
    return out
}

/// The winning destination, or nil for "show the picker". Families are
/// walked in `compatFamilyOrder`, which is the tiebreak when two families
/// claim the same record. A favourite is skipped when its waypoint cannot
/// render this page and when the waypoint no longer belongs to the family
/// it was saved under; inheriting a stale redirect would be worse than the
/// picker.
public func resolveAutoRedirectTarget(favoriteByFamily: [RedirectCompatFamily: String]?, candidates: [AutoRedirectCandidate]) -> AutoRedirectTarget? {
    guard let favoriteByFamily else { return nil }
    for family in WaypointCatalog.compatFamilyOrder {
        guard let waypointId = favoriteByFamily[family], !waypointId.isEmpty else { continue }
        guard let candidate = candidates.first(where: { $0.id == waypointId }) else { continue }
        guard candidate.families.contains(family) else { continue }
        return AutoRedirectTarget(waypointId: waypointId, family: family, url: candidate.url)
    }
    return nil
}

/// Candidates drawn from the user's custom waypoints, appended after the
/// built-ins so a built-in wins a tie within a family.
private func buildCustomAutoRedirectCandidates(_ customWaypoints: [CustomWaypoint], context: AutoRedirectContext, selfHost: String?) -> [AutoRedirectCandidate] {
    var out: [AutoRedirectCandidate] = []
    for custom in customWaypoints {
        let families = custom.redirectCompat ?? []
        if families.isEmpty { continue }
        if !custom.supportedTypes.contains(context.type) { continue }
        let target = CustomWaypointContext(handle: context.handle, did: context.did, collection: context.collection, rkey: context.rkey)
        guard let url = customWaypointUrl(custom, context: target) else { continue }
        if !isSafeRedirectUrl(url, selfHost: selfHost) { continue }
        out.append(AutoRedirectCandidate(id: custom.id, url: url, families: families))
    }
    return out
}

/// Candidates for the declared clients standing under `declared:` ids,
/// built from the record's own templates. Catalog clients stand under their
/// catalog id and are already among the built-in candidates.
private func buildDeclaredAutoRedirectCandidates(_ declared: DeclaredClients, favorites: [RedirectCompatFamily: String], context: AutoRedirectContext, selfHost: String?) -> [AutoRedirectCandidate] {
    var out: [AutoRedirectCandidate] = []
    for family in WaypointCatalog.compatFamilyOrder {
        let id = declaredClientIdPrefix + family.rawValue
        guard favorites[family] == id, declaredTemplatesCover(family, collection: context.collection),
              let client = declaredFavorite(declared, family: family)?.client
        else { continue }
        let target = CustomWaypointContext(handle: context.handle, did: context.did, collection: context.collection, rkey: context.rkey)
        guard let url = preferredClientUrl(client, target: target), isSafeRedirectUrl(url, selfHost: selfHost) else { continue }
        out.append(AutoRedirectCandidate(id: id, url: url, families: [family]))
    }
    return out
}

/// The full decision: master switch, then built-ins, customs and declared
/// clients, over the effective favourites.
public func resolveAutoRedirect(_ prefs: Preferences, context: AutoRedirectContext, selfHost: String? = nil, declared: DeclaredClients? = nil) -> AutoRedirectTarget? {
    guard prefs.autoRedirect else { return nil }
    let favorites = effectiveFavorites(prefs, declared: declared)
    var candidates = buildAutoRedirectCandidates(context, selfHost: selfHost)
    candidates.append(contentsOf: buildCustomAutoRedirectCandidates(prefs.customWaypoints, context: context, selfHost: selfHost))
    if let declared {
        candidates.append(contentsOf: buildDeclaredAutoRedirectCandidates(declared, favorites: favorites, context: context, selfHost: selfHost))
    }
    return resolveAutoRedirectTarget(favoriteByFamily: favorites, candidates: candidates)
}

/// The cache slice of a preferences value: the effective favourites.
public func autoRedirectCacheFor(_ prefs: Preferences, declared: DeclaredClients? = nil) -> AutoRedirectCache {
    AutoRedirectCache(enabled: prefs.autoRedirect, byFamily: effectiveFavorites(prefs, declared: declared))
}
