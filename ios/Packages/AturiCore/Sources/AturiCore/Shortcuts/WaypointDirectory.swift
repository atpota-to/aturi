import Foundation

// The waypoint list the Shortcuts and Siri actions offer: every built-in
// client in catalog order, then the person's custom waypoints. Unlike the
// picker it is not narrowed to the person's groups or to the page in hand,
// because a shortcut names its client up front, before any link is known.

/// One client a shortcut can name.
public struct WaypointListing: Hashable, Sendable, Identifiable {
    /// The waypoint id: a catalog id, or `custom:<id>`.
    public var id: String
    public var name: String
    /// The host its links point at ("deer.social"), when it can be worked
    /// out: probed from the URL builder for a built-in, the declared domain
    /// for a custom waypoint.
    public var host: String?
    /// The catalog category ("Bluesky Forks"), or "My Waypoints".
    public var category: String
    public var isCustom: Bool
    public var supportedTypes: [WaypointType]

    public init(id: String, name: String, host: String?, category: String, isCustom: Bool, supportedTypes: [WaypointType]) {
        self.id = id
        self.name = name
        self.host = host
        self.category = category
        self.isCustom = isCustom
        self.supportedTypes = supportedTypes
    }
}

/// Why a client link could not be built for a resolved link.
public enum ClientLinkFailure: Error, Hashable, Sendable {
    /// No built-in or custom waypoint has this id (a custom waypoint that
    /// was deleted after the shortcut was made).
    case unknownWaypoint
    /// The client does not open this kind of page.
    case unsupportedType(WaypointType)
    /// The client has no page for this input (Offprint without a record,
    /// a custom template whose placeholders have no value).
    case noDestination
    /// A custom waypoint's template produced something other than an http
    /// or https link.
    case unsafeDestination
}

public enum WaypointDirectory {
    /// Every built-in in catalog order, then the custom waypoints in the
    /// order the person saved them.
    public static func listings(customWaypoints: [CustomWaypoint]) -> [WaypointListing] {
        let builtins = WaypointCatalog.ordered.map { waypoint in
            WaypointListing(
                id: waypoint.id,
                name: waypoint.name,
                host: WaypointCatalog.host(of: waypoint.id),
                category: WaypointCatalog.categories[waypoint.category]?.name ?? waypoint.category,
                isCustom: false,
                supportedTypes: waypoint.supportedTypes
            )
        }
        let customs = customWaypoints.map { custom in
            WaypointListing(
                id: custom.id,
                name: custom.name,
                host: custom.domain.flatMap(Preferences.presence),
                category: Preferences.customGroupName,
                isCustom: true,
                supportedTypes: custom.supportedTypes
            )
        }
        return builtins + customs
    }

    /// The listings whose name, host or id contains `query`, ignoring case
    /// and diacritics, in listing order. A blank query matches everything.
    public static func listings(matching query: String, customWaypoints: [CustomWaypoint]) -> [WaypointListing] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let all = listings(customWaypoints: customWaypoints)
        guard !needle.isEmpty else { return all }
        return all.filter { listing in
            [listing.name, listing.host ?? "", listing.id].contains { field in
                field.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            }
        }
    }

    /// The listings for `ids`, in the order asked for; ids that no longer
    /// exist are dropped.
    public static func listings(ids: [String], customWaypoints: [CustomWaypoint]) -> [WaypointListing] {
        let byId = Dictionary(listings(customWaypoints: customWaypoints).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return ids.compactMap { byId[$0] }
    }

    /// The waypoint behind an id, custom waypoints first as the picker
    /// resolves them; nil for an id that no longer exists.
    public static func waypoint(id: String, customWaypoints: [CustomWaypoint]) -> Waypoint? {
        if let custom = customWaypoints.first(where: { $0.id == id }) {
            return Personalize.customToWaypoint(custom)
        }
        return WaypointCatalog.all[id]
    }

    /// The link that opens `link` in the client `waypointId`, built the way
    /// the picker builds the row for it. A shortcut can run with nobody
    /// watching (a personal automation), so a custom waypoint, whose template
    /// lives in a PDS record that any token holder can write, must produce
    /// an http or https link, as auto-redirect requires; built-in links come
    /// from the catalog and are trusted as the picker trusts them.
    public static func clientLink(for link: ResolvedLink, waypointId: String, customWaypoints: [CustomWaypoint]) -> Result<String, ClientLinkFailure> {
        guard let waypoint = waypoint(id: waypointId, customWaypoints: customWaypoints) else {
            return .failure(.unknownWaypoint)
        }
        guard waypoint.supports(link.type) else {
            return .failure(.unsupportedType(link.type))
        }
        guard let url = waypoint.url(handle: link.handle, collection: link.collection, rkey: link.rkey, did: link.did) else {
            return .failure(.noDestination)
        }
        let isCustom = customWaypoints.contains { $0.id == waypointId }
        if isCustom, !isSafeRedirectUrl(url) {
            return .failure(.unsafeDestination)
        }
        return .success(url)
    }
}
