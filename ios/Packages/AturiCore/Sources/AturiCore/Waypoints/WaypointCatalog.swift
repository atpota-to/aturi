import Foundation

// Port of src/utils/waypoints.data.ts: the catalog of every client ("waypoint")
// the app can hand a record or an identity to, plus the helpers that pick
// recommendations, group the catalog for the picker, build compose-intent
// links, and classify a waypoint against the collections a repo actually
// holds. The web file is the source of truth; keep entries in the same order
// and with the same URL branches so the two never drift.

/// The kind of thing a universal-link page is about.
public enum WaypointType: String, Codable, CaseIterable, Sendable, Hashable {
    case post
    case profile
    case list
    case record
    case unknown
}

/// Keys identifying which "data family" a waypoint belongs to for auto-redirect
/// purposes. Two waypoints can only be the endpoints of an auto-redirect when
/// they share at least one family key (they render the same underlying atproto
/// collections). Display groupings live in `WaypointCatalog.categories` and
/// are independent of this.
public enum RedirectCompatFamily: String, Codable, CaseIterable, Sendable, Hashable {
    case blueskySocial = "bluesky-social"
    case standardSite = "standard-site"
    case tangled
    case margin
    case grain
    case pinksky
    case semble
    case streamplace
    case popfeed
    case sifa
    case blento
    case atprotoExplorer = "atproto-explorer"
}

/// A client's support for Bluesky-style compose intent links: a URL that opens
/// the app's composer, optionally pre-filled with text.
/// See https://docs.bsky.app/docs/advanced-guides/intent-links.
///
/// bsky.app established `/intent/compose?text=...`, and the social-app forks in
/// the catalog inherit the same route. Only add an entry once the client's own
/// route has been confirmed: a link to a client that does not handle it lands
/// the user on a 404 or an empty home feed.
public struct ComposeIntent: Sendable, Hashable {
    /// The compose route, absolute and free of any query string.
    public let url: String
    /// Query parameter carrying the pre-filled post text. Nil when the client
    /// routes the intent but ignores the text: the link still opens a
    /// composer, just an empty one.
    public let textParam: String?
    /// Deep link into the client's native app for the same intent, when it
    /// publishes a scheme (e.g. `bluesky://intent/compose`).
    public let appUrl: String?

    public init(url: String, textParam: String? = nil, appUrl: String? = nil) {
        self.url = url
        self.textParam = textParam
        self.appUrl = appUrl
    }
}

/// One entry of the catalog. `Equatable`/`Hashable` compare by `id` only,
/// since the URL and description builders are closures.
public struct Waypoint: Identifiable, Sendable, Hashable {
    public let id: String
    public let name: String
    /// Human copy for the picker row, keyed by the collection in play
    /// (nil for a profile).
    public let describe: @Sendable (String?) -> String
    /// URL builder: (handle, collection, rkey, did). Returns nil when the
    /// client has no meaningful destination for the input (e.g. Offprint
    /// without a record) rather than a broken URL.
    public let url: @Sendable (String, String?, String?, String?) -> String?
    public let supportedTypes: [WaypointType]
    /// Must be a key of `WaypointCatalog.categories`.
    public let category: String
    /// Compose intent support, when the client has a confirmed intent route.
    /// Nil means "no known support" rather than a proven absence.
    public let composeIntent: ComposeIntent?
    /// Data families this waypoint participates in. An empty array means the
    /// waypoint can never be an auto-redirect source or destination (dev
    /// tools / generic record viewers land here by design).
    public let redirectCompat: [RedirectCompatFamily]
    /// NSID prefixes that signal this waypoint is meaningfully usable for the
    /// target repo. Trailing-dot prefixes cover whole namespaces, full NSIDs
    /// single-collection apps. Nil for generic explorers, which have no
    /// opinion and stay in the "unknown" state.
    public let expectedCollections: [String]?

    public init(
        id: String,
        name: String,
        describe: @escaping @Sendable (String?) -> String,
        url: @escaping @Sendable (String, String?, String?, String?) -> String?,
        supportedTypes: [WaypointType],
        category: String,
        composeIntent: ComposeIntent? = nil,
        redirectCompat: [RedirectCompatFamily],
        expectedCollections: [String]? = nil
    ) {
        self.id = id
        self.name = name
        // The web builders test `collection && rkey` and `did || handle`, so
        // an empty string behaves like "not given". Normalising here keeps
        // every branch below identical to the TypeScript without each one
        // having to repeat the check.
        self.describe = { collection in describe(Waypoint.blankToNil(collection)) }
        self.url = { handle, collection, rkey, did in
            url(handle, Waypoint.blankToNil(collection), Waypoint.blankToNil(rkey), Waypoint.blankToNil(did))
        }
        self.supportedTypes = supportedTypes
        self.category = category
        self.composeIntent = composeIntent
        self.redirectCompat = redirectCompat
        self.expectedCollections = expectedCollections
    }

    /// Labelled spelling of the `url` closure.
    public func url(handle: String, collection: String? = nil, rkey: String? = nil, did: String? = nil) -> String? {
        url(handle, collection, rkey, did)
    }

    /// Labelled spelling of the `describe` closure.
    public func describe(collection: String?) -> String {
        describe(collection)
    }

    public func supports(_ type: WaypointType) -> Bool {
        supportedTypes.contains(type)
    }

    private static func blankToNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    public static func == (lhs: Waypoint, rhs: Waypoint) -> Bool {
        lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

/// Display grouping for the picker. Nested subcategories render under their
/// parent rather than as a top-level group.
public struct WaypointCategory: Identifiable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let description: String?
    public let defaultWaypointId: String
    public let subcategories: [WaypointCategory]

    public init(
        id: String,
        name: String,
        description: String? = nil,
        defaultWaypointId: String,
        subcategories: [WaypointCategory] = []
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.defaultWaypointId = defaultWaypointId
        self.subcategories = subcategories
    }
}

public struct CategorizedWaypoints: Sendable, Hashable {
    public let category: WaypointCategory
    public let waypoints: [Waypoint]

    public init(category: WaypointCategory, waypoints: [Waypoint]) {
        self.category = category
        self.waypoints = waypoints
    }
}

/// Copy shown in the settings UI so the user understands what each
/// "Favorite for X" controls.
public struct RedirectCompatFamilyMeta: Sendable, Hashable {
    public let id: RedirectCompatFamily
    public let name: String
    public let description: String

    public init(id: RedirectCompatFamily, name: String, description: String) {
        self.id = id
        self.name = name
        self.description = description
    }
}

/// The picker's "Recommended for ..." row.
public struct RecommendedWaypoints: Sendable, Hashable {
    public let waypoints: [Waypoint]
    public let label: String

    public init(waypoints: [Waypoint], label: String) {
        self.waypoints = waypoints
        self.label = label
    }
}

/// Recommendation table entry, keyed by collection NSID, by namespace prefix,
/// or by record type.
public struct RecommendedWaypointConfig: Sendable, Hashable {
    public let waypointIds: [String]
    public let label: String?

    public init(waypointIds: [String], label: String? = nil) {
        self.waypointIds = waypointIds
        self.label = label
    }
}

/// Result of comparing a waypoint's `expectedCollections` against the set of
/// NSIDs found in the target repo.
///
///   - present: the user has at least one record under a matching prefix.
///   - absent: the waypoint declared collections but none are in the repo.
///   - unknown: the waypoint declared no expectations, or the repo has not
///     been scanned yet (scan disabled, no DID).
public enum WaypointActivity: String, Sendable, Hashable {
    case present
    case absent
    case unknown
}

/// JSON-safe view of a client's compose intent, for surfaces that cannot hold
/// a closure (share sheets, docs tables, the share extension).
public struct ComposeIntentDescriptor: Sendable, Hashable {
    /// Ready to open. Pre-filled when text was supplied and the client reads it.
    public let url: String
    /// The same URL with a literal `{text}` where the post text goes.
    public let urlTemplate: String
    /// Query parameter carrying the text; nil when the client ignores it.
    public let textParam: String?
    /// False when the composer opens empty no matter what you pass: the link
    /// is still a valid "start a post over there" jump, just not a share.
    public let prefillsText: Bool
    /// Native-app deep link for the same intent, when the client publishes one.
    public let appUrl: String?

    public init(url: String, urlTemplate: String, textParam: String?, prefillsText: Bool, appUrl: String?) {
        self.url = url
        self.urlTemplate = urlTemplate
        self.textParam = textParam
        self.prefillsText = prefillsText
        self.appUrl = appUrl
    }
}

/// JS `encodeURIComponent`: everything but the unreserved set
/// `A-Z a-z 0-9 - _ . ! ~ * ' ( )` is percent-encoded as UTF-8. Foundation's
/// `.urlQueryAllowed` is far too permissive (it keeps `&`, `=`, `/`, `:`), so
/// the set is spelled out.
private let waypointUnreservedCharacters = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
)

private func waypointPercentEncode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: waypointUnreservedCharacters) ?? value
}

/// The `/intent/compose?text=...` shape bsky.app established and every
/// social-app fork inherits verbatim, down to the parameter name.
private func socialAppComposeIntent(_ origin: String, appUrl: String? = nil) -> ComposeIntent {
    ComposeIntent(url: "\(origin)/intent/compose", textParam: "text", appUrl: appUrl)
}

private func isPublicationCollection(_ collection: String?) -> Bool {
    guard let collection else { return false }
    return collection.hasPrefix("site.standard.") || collection.hasPrefix("pub.leaflet.")
}

/// The catalog and every pure helper over it. Mirrors the exported names of
/// `waypoints.data.ts` (`WAYPOINT_DESTINATIONS_DATA` is `all`, `WAYPOINT_ORDER`
/// is `order`, and so on).
public enum WaypointCatalog {
    /// Registry of compat families.
    public static let compatFamilies: [RedirectCompatFamily: RedirectCompatFamilyMeta] = [
        .blueskySocial: RedirectCompatFamilyMeta(
            id: .blueskySocial,
            name: "Bluesky clients",
            description: "Apps that render bsky posts, profiles, and lists at /profile/:handle."
        ),
        .standardSite: RedirectCompatFamilyMeta(
            id: .standardSite,
            name: "Publications",
            description: "Readers for Standard Site and Leaflet publications."
        ),
        .tangled: RedirectCompatFamilyMeta(
            id: .tangled,
            name: "Tangled",
            description: "Tangled repositories and related records."
        ),
        .margin: RedirectCompatFamilyMeta(
            id: .margin,
            name: "Margin",
            description: "Annotations, highlights, and bookmarks on margin.at."
        ),
        .grain: RedirectCompatFamilyMeta(
            id: .grain,
            name: "Grain",
            description: "Photo galleries on grain.social."
        ),
        .pinksky: RedirectCompatFamilyMeta(
            id: .pinksky,
            name: "Pinkleap",
            description: "Pinkleap browsing experience."
        ),
        .semble: RedirectCompatFamilyMeta(
            id: .semble,
            name: "Semble",
            description: "Semble profiles."
        ),
        .streamplace: RedirectCompatFamilyMeta(
            id: .streamplace,
            name: "Streamplace",
            description: "Streamplace profiles."
        ),
        .popfeed: RedirectCompatFamilyMeta(
            id: .popfeed,
            name: "Popfeed",
            description: "Popfeed profiles."
        ),
        .sifa: RedirectCompatFamilyMeta(
            id: .sifa,
            name: "Sifa",
            description: "Sifa profiles."
        ),
        .blento: RedirectCompatFamilyMeta(
            id: .blento,
            name: "Blento",
            description: "Blento profiles."
        ),
        .atprotoExplorer: RedirectCompatFamilyMeta(
            id: .atprotoExplorer,
            name: "Record explorers",
            description: "Raw AT Protocol record explorers (pdsls, atp.tools, Aturi Explore) that render any record by its AT URI."
        ),
    ]

    /// Tiebreak order for auto-redirect: the first family with a favorite that
    /// can render the page wins.
    public static let compatFamilyOrder: [RedirectCompatFamily] = [
        .blueskySocial,
        .standardSite,
        .pinksky,
        .tangled,
        .margin,
        .grain,
        .semble,
        .streamplace,
        .popfeed,
        .sifa,
        .blento,
        .atprotoExplorer,
    ]

    /// Every waypoint keyed by id (`WAYPOINT_DESTINATIONS_DATA`).
    public static let all: [String: Waypoint] = {
        var table: [String: Waypoint] = [:]
        for waypoint in entries {
            table[waypoint.id] = waypoint
        }
        return table
    }()

    /// Render order for the picker (`WAYPOINT_ORDER`).
    public static let order: [String] = [
        "anisota",
        "bluesky",
        "bluepy",
        "reddwarf",
        "impro",
        "blacksky",
        "leaflet",
        "aturi",
        "pinksky",
        "margin",
        "semble",
        "streamplace",
        "grain",
        "popfeed",
        "sifa",
        "blento",
        "anisotaReader",
        "offprint",
        "pckt",
        "standardReader",
        "aturiExplore",
        "pdsls",
        "tangled",
        "atptools",
        "taproot",
        "witchsky",
        "mu",
        "deer",
        "lea",
        "northsky",
    ]

    /// `getWaypointCountData`.
    public static var count: Int { order.count }

    public static let categories: [String: WaypointCategory] = [
        "blueskyClients": WaypointCategory(
            id: "blueskyClients",
            name: "Bluesky Clients",
            description: "Official and alternative Bluesky clients",
            defaultWaypointId: "bluesky",
            subcategories: [
                WaypointCategory(
                    id: "blueskyForks",
                    name: "Bluesky Forks",
                    description: "Community-built Bluesky variants",
                    defaultWaypointId: "blacksky"
                ),
            ]
        ),
        "blueskyForks": WaypointCategory(
            id: "blueskyForks",
            name: "Bluesky Forks",
            description: "Community-built Bluesky variants",
            defaultWaypointId: "blacksky"
        ),
        "publications": WaypointCategory(
            id: "publications",
            name: "Publications",
            description: "Readers for Standard Site and Leaflet publications",
            defaultWaypointId: "leaflet"
        ),
        "atmosphereApps": WaypointCategory(
            id: "atmosphereApps",
            name: "Atmosphere",
            description: "Apps built on the AT Protocol",
            defaultWaypointId: "tangled"
        ),
        "devTools": WaypointCategory(
            id: "devTools",
            name: "Dev Tools",
            description: "Tools for developers and debugging",
            defaultWaypointId: "aturiExplore"
        ),
    ]

    public static let categoryOrder: [String] = [
        "blueskyClients",
        "blueskyForks",
        "publications",
        "atmosphereApps",
        "devTools",
    ]

    /// Recommendations keyed by exact collection NSID or by record type.
    public static let recommendedByCollection: [String: RecommendedWaypointConfig] = [
        "app.bsky.feed.post": RecommendedWaypointConfig(
            waypointIds: ["bluesky", "anisota", "blacksky"],
            label: "Recommended for Posts"
        ),
        "profile": RecommendedWaypointConfig(
            waypointIds: ["bluesky", "anisota"],
            label: "Recommended for Profiles"
        ),
        "app.bsky.graph.list": RecommendedWaypointConfig(
            waypointIds: ["bluesky", "anisota"],
            label: "Recommended for Lists"
        ),
        "community.lexicon.calendar.event": RecommendedWaypointConfig(
            waypointIds: ["aturiExplore", "pdsls", "atptools"],
            label: "Recommended for Events"
        ),
        "sh.tangled.repo": RecommendedWaypointConfig(
            waypointIds: ["tangled"],
            label: "Recommended for Repos"
        ),
        "record": RecommendedWaypointConfig(
            waypointIds: ["aturiExplore", "pdsls", "atptools", "taproot"],
            label: "Recommended for Records"
        ),
    ]

    /// Recommendations keyed by collection NSID prefix. A collection is walked
    /// from its longest dotted prefix to its shortest (never fewer than two
    /// segments) looking for a registered prefix, so `site.standard.blog.entry`
    /// matches `site.standard`. For apps that own a whole namespace and have a
    /// consistent set of compatible waypoints across all their record types.
    public static let recommendedByNamespacePrefix: [String: RecommendedWaypointConfig] = [
        "site.standard": RecommendedWaypointConfig(
            waypointIds: ["leaflet", "standardReader", "anisotaReader", "offprint", "pckt", "pdsls"],
            label: "Recommended for Publications"
        ),
        "pub.leaflet": RecommendedWaypointConfig(
            waypointIds: ["leaflet", "anisotaReader", "offprint", "pckt", "pdsls"],
            label: "Recommended for Publications"
        ),
        "sh.tangled": RecommendedWaypointConfig(
            waypointIds: ["tangled", "pdsls", "atptools"],
            label: "Recommended for Tangled"
        ),
        "at.margin": RecommendedWaypointConfig(
            waypointIds: ["margin", "pdsls", "atptools"],
            label: "Recommended for Margin"
        ),
        "social.grain": RecommendedWaypointConfig(
            waypointIds: ["grain", "pdsls", "atptools"],
            label: "Recommended for Grain"
        ),
    ]

    /// Placeholder a compose intent template leaves for the caller's post text.
    public static let composeIntentTextPlaceholder = "{text}"

    // MARK: Lookups

    /// `getWaypointDataForType`: catalog order, narrowed to a record type.
    public static func forType(_ type: WaypointType) -> [Waypoint] {
        order.compactMap { all[$0] }.filter { $0.supportedTypes.contains(type) }
    }

    /// Catalog order, unfiltered.
    public static var ordered: [Waypoint] {
        order.compactMap { all[$0] }
    }

    /// `getCategorizedWaypointsData`. Categories declared as subcategories of
    /// another category are skipped at the top level; their waypoints are
    /// rendered nested under the parent by the picker.
    public static func categorized(for type: WaypointType) -> [CategorizedWaypoints] {
        let available = forType(type)
        var subcategoryIds = Set<String>()
        for category in categories.values {
            for subcategory in category.subcategories {
                subcategoryIds.insert(subcategory.id)
            }
        }

        var result: [CategorizedWaypoints] = []
        for categoryId in categoryOrder {
            if subcategoryIds.contains(categoryId) { continue }
            guard let category = categories[categoryId] else { continue }
            let waypoints = available.filter { $0.category == categoryId }
            if !waypoints.isEmpty {
                result.append(CategorizedWaypoints(category: category, waypoints: waypoints))
            }
        }
        return result
    }

    private static func namespacePrefixMatch(for collection: String) -> RecommendedWaypointConfig? {
        let segments = collection.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        var count = segments.count - 1
        while count >= 2 {
            let prefix = segments[0..<count].joined(separator: ".")
            if let config = recommendedByNamespacePrefix[prefix] {
                return config
            }
            count -= 1
        }
        return nil
    }

    /// `getRecommendedWaypointsData`: exact collection first, then namespace
    /// prefix, then record type, then a bare "Recommended: Bluesky".
    public static func recommended(for type: WaypointType, collection: String? = nil) -> RecommendedWaypoints {
        var config: RecommendedWaypointConfig?

        if let collection, let exact = recommendedByCollection[collection] {
            config = exact
        } else if let collection {
            config = namespacePrefixMatch(for: collection)
        }

        if config == nil, let byType = recommendedByCollection[type.rawValue] {
            config = byType
        }

        let resolved = config ?? RecommendedWaypointConfig(waypointIds: ["bluesky"], label: "Recommended")
        let waypoints = resolved.waypointIds.compactMap { all[$0] }
        let label = resolved.label.flatMap { $0.isEmpty ? nil : $0 } ?? "Recommended"
        return RecommendedWaypoints(waypoints: waypoints, label: label)
    }

    /// `getFeaturedWaypointData`: the first recommendation, if any.
    public static func featured(for type: WaypointType, collection: String? = nil) -> Waypoint? {
        recommended(for: type, collection: collection).waypoints.first
    }

    /// `waypointActivity`: prefix-match each entry in `expectedCollections`
    /// against the collections known to exist on the target repo. Unknown when
    /// the waypoint declared no expectations or no scan has run yet (nil).
    public static func activity(of waypoint: Waypoint, repoCollections: Set<String>?) -> WaypointActivity {
        activity(expectedCollections: waypoint.expectedCollections, repoCollections: repoCollections)
    }

    /// The same classification for anything carrying an `expectedCollections`
    /// list (custom waypoints included).
    public static func activity(expectedCollections: [String]?, repoCollections: Set<String>?) -> WaypointActivity {
        guard let repoCollections else { return .unknown }
        guard let expected = expectedCollections, !expected.isEmpty else { return .unknown }
        for collection in repoCollections {
            for prefix in expected where collection == prefix || collection.hasPrefix(prefix) {
                return .present
            }
        }
        return .absent
    }

    // MARK: Compose intents

    /// Whether the client can be handed a link that opens its composer.
    public static func supportsComposeIntent(_ waypoint: Waypoint) -> Bool {
        waypoint.composeIntent != nil
    }

    /// A link that opens the client's composer, pre-filled with `text` when
    /// the client reads it. Nil when the client has no known intent route.
    public static func composeIntentUrl(_ waypoint: Waypoint, text: String? = nil) -> String? {
        guard let intent = waypoint.composeIntent else { return nil }
        return appendComposeText(intent.url, textParam: intent.textParam, text: text)
    }

    /// The native-app flavour of `composeIntentUrl`. Nil unless the client
    /// publishes a scheme of its own; fall back to the https link rather than
    /// treating nil as "unsupported".
    public static func composeIntentAppUrl(_ waypoint: Waypoint, text: String? = nil) -> String? {
        guard let intent = waypoint.composeIntent, let appUrl = intent.appUrl else { return nil }
        return appendComposeText(appUrl, textParam: intent.textParam, text: text)
    }

    /// The client's intent URL with a literal `{text}` where the post text
    /// goes. Clients that ignore the text get a template with no placeholder.
    public static func composeIntentTemplate(_ waypoint: Waypoint) -> String? {
        guard let intent = waypoint.composeIntent else { return nil }
        guard let textParam = intent.textParam, !textParam.isEmpty else { return intent.url }
        return "\(intent.url)?\(textParam)=\(composeIntentTextPlaceholder)"
    }

    /// Catalog-ordered list of every client with a compose intent route,
    /// optionally narrowed to those that also render a given record type.
    public static func composeIntentWaypoints(for type: WaypointType? = nil) -> [Waypoint] {
        let candidates = type.map(forType) ?? ordered
        return candidates.filter(supportsComposeIntent)
    }

    /// Serialize a waypoint's compose intent. Nil when it has none.
    public static func describeComposeIntent(_ waypoint: Waypoint, text: String? = nil) -> ComposeIntentDescriptor? {
        guard let intent = waypoint.composeIntent,
              let url = composeIntentUrl(waypoint, text: text),
              let template = composeIntentTemplate(waypoint)
        else { return nil }
        let textParam = intent.textParam.flatMap { $0.isEmpty ? nil : $0 }
        return ComposeIntentDescriptor(
            url: url,
            urlTemplate: template,
            textParam: textParam,
            prefillsText: textParam != nil,
            appUrl: composeIntentAppUrl(waypoint, text: text)
        )
    }

    private static func appendComposeText(_ base: String, textParam: String?, text: String?) -> String {
        guard let textParam, !textParam.isEmpty, let text, !text.isEmpty else { return base }
        return "\(base)?\(textParam)=\(waypointPercentEncode(text))"
    }

    // MARK: Hosts

    /// `waypointHost` from autoRedirect.ts: the host a built-in waypoint's
    /// links point at, or nil when it cannot build one at all. Probed rather
    /// than declared, because the catalog stores URL builders and not hosts.
    /// The settings UI uses this to drop waypoints served from aturi.to itself
    /// out of the redirect destination lists.
    public static func host(of waypointId: String) -> String? {
        guard let waypoint = all[waypointId] else { return nil }
        let probes: [(String?, String?)] = [
            (nil, nil),
            ("app.bsky.feed.post", "probe"),
            ("com.example.probe", "probe"),
        ]
        for (collection, rkey) in probes {
            guard let url = waypoint.url("probe.example", collection, rkey, "did:plc:probe") else { continue }
            return hostComponent(of: url)
        }
        return nil
    }

    /// Host (with port when one is spelled out) of an absolute URL, parsed by
    /// hand: waypoint URLs carry `at://` and DIDs in their paths, which
    /// Foundation's URL parser does not reliably accept.
    static func hostComponent(of url: String) -> String? {
        guard let schemeRange = url.range(of: "://") else { return nil }
        let scheme = url[url.startIndex..<schemeRange.lowerBound]
        guard !scheme.isEmpty, scheme.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == "." }) else {
            return nil
        }
        let rest = url[schemeRange.upperBound...]
        let end = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
        var authority = String(rest[rest.startIndex..<end])
        if let at = authority.lastIndex(of: "@") {
            authority = String(authority[authority.index(after: at)...])
        }
        guard !authority.isEmpty else { return nil }
        return authority.lowercased()
    }

    // MARK: Entries

    /// Every waypoint, in declaration order of the web catalog. `all` is
    /// built from this; `order` decides rendering.
    private static let entries: [Waypoint] = [
        Waypoint(
            id: "aturi",
            name: "Aturi",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on aturi.to" }
                if collection == "app.bsky.graph.list" { return "View list on aturi.to" }
                if isPublicationCollection(collection) { return "View document on aturi.to" }
                if collection != nil { return "View record on aturi.to" }
                return "View profile on aturi.to"
            },
            url: { handle, collection, rkey, did in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://aturi.to/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://aturi.to/profile/\(handle)/lists/\(rkey)"
                    }
                    // Generic AT-record viewer; prefer the DID (stable across
                    // handle changes) when one is available.
                    let identifier = did ?? handle
                    return "https://aturi.to/profile/\(identifier)/\(collection)/\(rkey)"
                }
                return "https://aturi.to/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.blueskySocial, .standardSite]
        ),

        Waypoint(
            id: "anisota",
            name: "Anisota",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on anisota.net" }
                if collection == "app.bsky.graph.list" { return "View list on anisota.net" }
                if isPublicationCollection(collection) { return "View document on anisota.net" }
                return "View profile on anisota.net"
            },
            url: { handle, collection, rkey, did in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://anisota.net/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://anisota.net/profile/\(handle)/lists/\(rkey)"
                    }
                    if isPublicationCollection(collection) {
                        // Anisota's document viewer addresses records by DID when available.
                        let identifier = did ?? handle
                        return "https://anisota.net/profile/\(identifier)/document/\(rkey)"
                    }
                    return "https://anisota.net/profile/\(handle)"
                }
                return "https://anisota.net/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyClients",
            // Anisota implements the Bluesky intent shape, then extends it with
            // extras that are Anisota-only; only the interoperable subset is
            // declared here.
            composeIntent: socialAppComposeIntent("https://anisota.net"),
            // Bluesky-shaped records only: the Standard Site / Leaflet role
            // belongs to `anisotaReader`, so the Publications destination list
            // does not show the same site twice.
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky.", "net.anisota."]
        ),

        Waypoint(
            id: "bluesky",
            name: "Bluesky",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on bsky.app" }
                if collection == "app.bsky.graph.list" { return "View list on bsky.app" }
                return "View profile on bsky.app"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://bsky.app/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://bsky.app/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://bsky.app/profile/\(handle)"
                }
                return "https://bsky.app/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyClients",
            composeIntent: socialAppComposeIntent("https://bsky.app", appUrl: "bluesky://intent/compose"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "blacksky",
            name: "Blacksky",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on blacksky.community" }
                if collection == "app.bsky.graph.list" { return "View list on blacksky.community" }
                return "View profile on blacksky.community"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://blacksky.community/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://blacksky.community/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://blacksky.community/profile/\(handle)"
                }
                return "https://blacksky.community/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyForks",
            composeIntent: socialAppComposeIntent("https://blacksky.community"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "reddwarf",
            name: "Red Dwarf",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on reddwarf.app" }
                return "View profile on reddwarf.app"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://reddwarf.app/profile/\(handle)/post/\(rkey)"
                    }
                    return "https://reddwarf.app/profile/\(handle)"
                }
                return "https://reddwarf.app/profile/\(handle)"
            },
            // No `list`: Red Dwarf has no `/profile/:handle/lists/:rkey` route,
            // so offering it for a list would land the user on the author.
            supportedTypes: [.post, .profile, .record],
            category: "blueskyClients",
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "impro",
            name: "Impro",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on impro.social" }
                if collection == "app.bsky.graph.list" { return "View list on impro.social" }
                return "View profile on impro.social"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://impro.social/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://impro.social/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://impro.social/profile/\(handle)"
                }
                return "https://impro.social/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyClients",
            // Impro routes /intent/compose to its home view, which opens the
            // composer for a signed-in user, but never reads `?text`.
            composeIntent: ComposeIntent(url: "https://impro.social/intent/compose"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "lea",
            name: "Lea",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on lea.ac" }
                return "View profile on lea.ac"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://lea.ac/profile/\(handle)/post/\(rkey)"
                    }
                    return "https://lea.ac/profile/\(handle)"
                }
                return "https://lea.ac/profile/\(handle)"
            },
            // No `list`: `/lists/:rkey` 404s on lea.ac.
            supportedTypes: [.post, .profile, .record],
            category: "blueskyClients",
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "leaflet",
            name: "Leaflet",
            describe: { _ in "View profile on leaflet.pub" },
            url: { handle, _, _, _ in "https://leaflet.pub/p/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "publications",
            redirectCompat: [.standardSite],
            expectedCollections: ["pub.leaflet.", "site.standard."]
        ),

        Waypoint(
            id: "pdsls",
            name: "PDSls",
            describe: { _ in "View raw record on pdsls.dev" },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if let collection, let rkey {
                    return "https://pdsls.dev/at://\(identifier)/\(collection)/\(rkey)"
                }
                return "https://pdsls.dev/at://\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "devTools",
            redirectCompat: [.atprotoExplorer]
        ),

        Waypoint(
            id: "aturiExplore",
            name: "Aturi Explore",
            describe: { collection in
                if collection != nil { return "Inspect record on aturi.to/explore" }
                return "Browse repo on aturi.to/explore"
            },
            url: { handle, collection, rkey, did in
                // The explorer keys URLs by DID when available so handle
                // changes do not break shared links.
                let identifier = did ?? handle
                if let collection, let rkey {
                    return "https://aturi.to/explore/\(identifier)/\(collection)/\(waypointPercentEncode(rkey))"
                }
                if let collection {
                    return "https://aturi.to/explore/\(identifier)/\(collection)"
                }
                return "https://aturi.to/explore/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "devTools",
            redirectCompat: [.atprotoExplorer]
        ),

        Waypoint(
            id: "atptools",
            name: "atp.tools",
            describe: { _ in "View raw record on atp.tools" },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if let collection, let rkey {
                    return "https://atp.tools/at:/\(identifier)/\(collection)/\(rkey)"
                }
                return "https://atp.tools/at:/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "devTools",
            redirectCompat: [.atprotoExplorer]
        ),

        Waypoint(
            id: "bluepy",
            name: "Bluepy",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on bluepy.social" }
                if collection == "app.bsky.graph.list" { return "View list on bluepy.social" }
                if collection != nil { return "View record on bluepy.social" }
                return "View profile on bluepy.social"
            },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if let collection, let rkey {
                    return "https://bluepy.social/at://\(identifier)/\(collection)/\(rkey)"
                }
                return "https://bluepy.social/at://\(identifier)/app.bsky.actor.profile/self"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyClients",
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "witchsky",
            name: "Witchsky",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on witchsky.app" }
                if collection == "app.bsky.graph.list" { return "View list on witchsky.app" }
                return "View profile on witchsky.app"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://witchsky.app/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://witchsky.app/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://witchsky.app/profile/\(handle)"
                }
                return "https://witchsky.app/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyForks",
            composeIntent: socialAppComposeIntent("https://witchsky.app"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "deer",
            name: "Deer",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on deer.social" }
                if collection == "app.bsky.graph.list" { return "View list on deer.social" }
                return "View profile on deer.social"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://deer.social/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://deer.social/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://deer.social/profile/\(handle)"
                }
                return "https://deer.social/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyForks",
            composeIntent: socialAppComposeIntent("https://deer.social"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "mu",
            name: "Mu",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on mu.social" }
                if collection == "app.bsky.graph.list" { return "View list on mu.social" }
                return "View profile on mu.social"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://mu.social/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://mu.social/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://mu.social/profile/\(handle)"
                }
                return "https://mu.social/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyForks",
            composeIntent: socialAppComposeIntent("https://mu.social"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "northsky",
            name: "Northsky",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on northsky.app" }
                if collection == "app.bsky.graph.list" { return "View list on northsky.app" }
                return "View profile on northsky.app"
            },
            url: { handle, collection, rkey, _ in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        return "https://northsky.app/profile/\(handle)/post/\(rkey)"
                    }
                    if collection == "app.bsky.graph.list" {
                        return "https://northsky.app/profile/\(handle)/lists/\(rkey)"
                    }
                    return "https://northsky.app/profile/\(handle)"
                }
                return "https://northsky.app/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "blueskyForks",
            composeIntent: socialAppComposeIntent("https://northsky.app"),
            redirectCompat: [.blueskySocial],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "tangled",
            name: "Tangled",
            describe: { _ in "View profile on tangled.org" },
            url: { handle, _, _, _ in "https://tangled.org/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.tangled],
            expectedCollections: ["sh.tangled."]
        ),

        Waypoint(
            id: "pinksky",
            name: "Pinkleap",
            describe: { collection in
                if collection == "app.bsky.feed.post" { return "View post on pinkleap.app" }
                return "View profile on pinkleap.app"
            },
            url: { handle, collection, rkey, did in
                if let collection, let rkey {
                    if collection == "app.bsky.feed.post" {
                        let identifier = did ?? handle
                        let atUri = "at://\(identifier)/\(collection)/\(rkey)"
                        let encodedUri = waypointPercentEncode(atUri)
                        let encodedDid = waypointPercentEncode(identifier)
                        return "https://pinkleap.app/feed?uri=\(encodedUri)&src=profile&index=1&did=\(encodedDid)&showThreads=\(encodedDid)"
                    }
                    return "https://pinkleap.app/profile/\(handle)"
                }
                return "https://pinkleap.app/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.pinksky],
            expectedCollections: ["app.bsky."]
        ),

        Waypoint(
            id: "margin",
            name: "Margin",
            describe: { collection in
                if collection == "at.margin.annotation" { return "View annotation on margin.at" }
                if collection == "at.margin.highlight" { return "View highlight on margin.at" }
                if collection == "at.margin.bookmark" { return "View bookmark on margin.at" }
                if collection?.hasPrefix("at.margin.") == true { return "View on margin.at" }
                return "View profile on margin.at"
            },
            url: { handle, collection, rkey, did in
                if let collection, let rkey, collection.hasPrefix("at.margin.") {
                    let recordType = String(collection.dropFirst("at.margin.".count))
                    let identifier = did ?? handle

                    if recordType == "annotation" || recordType == "highlight" || recordType == "bookmark" {
                        // margin.at addresses these by the author's domain, so
                        // a handle is preferred over a DID when it looks like one.
                        let handleLooksLikeDomain = handle.contains(".") && !handle.hasPrefix("did:")
                        let domain = handleLooksLikeDomain ? handle : identifier
                        return "https://margin.at/\(domain)/\(recordType)/\(rkey)"
                    }

                    return "https://margin.at/profile/\(identifier)"
                }

                let identifier = did ?? handle
                return "https://margin.at/profile/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.margin],
            expectedCollections: ["at.margin."]
        ),

        Waypoint(
            id: "semble",
            name: "Semble",
            describe: { _ in "View profile on semble.so" },
            url: { handle, _, _, _ in "https://semble.so/profile/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.semble],
            expectedCollections: ["so.semble."]
        ),

        Waypoint(
            id: "streamplace",
            name: "Streamplace",
            describe: { _ in "View profile on stream.place" },
            url: { handle, _, _, _ in "https://stream.place/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.streamplace],
            expectedCollections: ["place.stream."]
        ),

        Waypoint(
            id: "grain",
            name: "Grain",
            describe: { collection in
                if collection == "social.grain.gallery" { return "View gallery on grain.social" }
                return "View profile on grain.social"
            },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if collection == "social.grain.gallery", let rkey {
                    return "https://grain.social/profile/\(identifier)/gallery/\(rkey)"
                }
                return "https://grain.social/profile/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.grain],
            expectedCollections: ["social.grain."]
        ),

        Waypoint(
            id: "popfeed",
            name: "Popfeed",
            describe: { _ in "View profile on popfeed.social" },
            url: { handle, _, _, did in
                let identifier = did ?? handle
                return "https://popfeed.social/profile/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.popfeed],
            expectedCollections: ["social.popfeed."]
        ),

        Waypoint(
            id: "sifa",
            name: "Sifa",
            describe: { _ in "View profile on sifa.id" },
            url: { handle, _, _, _ in "https://sifa.id/p/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.sifa],
            expectedCollections: ["id.sifa."]
        ),

        Waypoint(
            id: "blento",
            name: "Blento",
            describe: { _ in "View profile on blento.app" },
            url: { handle, _, _, _ in "https://blento.app/\(handle)" },
            supportedTypes: [.post, .profile, .list, .record],
            category: "atmosphereApps",
            redirectCompat: [.blento],
            expectedCollections: ["app.blento."]
        ),

        Waypoint(
            id: "anisotaReader",
            name: "Anisota Reader",
            describe: { collection in
                if isPublicationCollection(collection) { return "Read document on anisota.net" }
                return "View publications on anisota.net"
            },
            url: { handle, collection, rkey, did in
                if let collection, let rkey, isPublicationCollection(collection) {
                    let identifier = did ?? handle
                    return "https://anisota.net/profile/\(identifier)/document/\(rkey)"
                }
                return "https://anisota.net/profile/\(handle)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "publications",
            redirectCompat: [.standardSite],
            expectedCollections: ["pub.leaflet.", "site.standard."]
        ),

        Waypoint(
            id: "offprint",
            name: "Offprint",
            describe: { collection in
                if isPublicationCollection(collection) { return "Read document on offprint.app" }
                return "View on offprint.app"
            },
            url: { handle, collection, rkey, did in
                // Offprint only has record-level URLs; without a collection and
                // rkey there is no meaningful destination, so the waypoint is
                // hidden in profile-only views.
                guard let collection, let rkey else { return nil }
                let identifier = did ?? handle
                return "https://offprint.app/\(identifier)/\(collection)/\(rkey)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "publications",
            redirectCompat: [.standardSite],
            expectedCollections: ["pub.leaflet.", "site.standard."]
        ),

        Waypoint(
            id: "pckt",
            name: "pckt",
            describe: { collection in
                if isPublicationCollection(collection) { return "Read document on pckt.blog" }
                return "View on pckt.blog"
            },
            url: { handle, collection, rkey, did in
                // Same shape as Offprint: record-level URLs only.
                guard let collection, let rkey else { return nil }
                let identifier = did ?? handle
                return "https://pckt.blog/\(identifier)/\(collection)/\(rkey)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "publications",
            redirectCompat: [.standardSite],
            expectedCollections: ["pub.leaflet.", "site.standard."]
        ),

        Waypoint(
            id: "standardReader",
            name: "Standard Reader",
            describe: { collection in
                if isPublicationCollection(collection) { return "Read document on standard-reader.app" }
                return "View documents on standard-reader.app"
            },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if let collection, let rkey, isPublicationCollection(collection) {
                    return "https://standard-reader.app/a/\(identifier)/\(rkey)"
                }
                return "https://standard-reader.app/u/\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "publications",
            redirectCompat: [.standardSite],
            expectedCollections: ["pub.leaflet.", "site.standard."]
        ),

        Waypoint(
            id: "taproot",
            name: "Taproot",
            describe: { collection in
                if collection != nil { return "Inspect record on atproto.at" }
                return "Browse repo on atproto.at"
            },
            url: { handle, collection, rkey, did in
                let identifier = did ?? handle
                if let collection, let rkey {
                    return "https://atproto.at/uri/at://\(identifier)/\(collection)/\(rkey)"
                }
                return "https://atproto.at/uri/at://\(identifier)"
            },
            supportedTypes: [.post, .profile, .list, .record],
            category: "devTools",
            redirectCompat: []
        ),
    ]
}
