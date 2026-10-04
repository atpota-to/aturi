import Foundation

// Port of src/utils/preferences.ts and src/utils/exploreSections.ts, plus the
// record shape of src/utils/atproto/preferencesPds.ts.
//
// Preferences live in two places: the signed-in user's PDS as a
// `to.aturi.actor.preferences/self` record (the cross-device source of
// truth) and the app group's UserDefaults (anonymous customisation and the
// fast path). The web reads both leniently through `mergeWithDefaults`, so
// every decode here goes through the same function on a `JSONValue`; nothing
// in a hand-edited or newer-client record can make decoding fail.

// MARK: - Explore page sections (exploreSections.ts)

/// One entry of a page's saved section list: array order is display order,
/// `hidden` is per-section visibility.
public struct SectionConfig: Codable, Hashable, Sendable {
    public var id: String
    public var hidden: Bool

    public init(id: String, hidden: Bool) {
        self.id = id
        self.hidden = hidden
    }

    /// `isValidSectionConfig`: an object with a string `id` and boolean `hidden`.
    public init?(json: JSONValue) {
        guard let id = json["id"]?.stringValue, let hidden = json["hidden"]?.boolValue else { return nil }
        self.init(id: id, hidden: hidden)
    }

    public var jsonValue: JSONValue {
        .object(["id": .string(id), "hidden": .bool(hidden)])
    }
}

public enum SectionKind: String, Sendable, Hashable {
    case recordData = "record-data"
    case helper
}

public enum ExplorePage: String, Codable, CaseIterable, Sendable, Hashable {
    case record
    case repo
}

/// Section metadata lives here rather than in stored preferences so sections
/// can be recategorised without a migration.
public struct SectionMeta: Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let description: String
    public let kind: SectionKind

    public init(id: String, label: String, description: String, kind: SectionKind) {
        self.id = id
        self.label = label
        self.description = description
        self.kind = kind
    }
}

public enum ExploreSections {
    /// Record-page sections in default display order.
    public static let recordSectionMeta: [SectionMeta] = [
        SectionMeta(id: "richPreview", label: "Rich preview", description: "The rendered Bluesky post card (or margin-lexicon card). Records without a card skip this.", kind: .recordData),
        SectionMeta(id: "structuredJson", label: "Rich JSON preview", description: "The record's fields as a structured, linkified table.", kind: .recordData),
        SectionMeta(id: "rawJson", label: "Raw JSON", description: "The full, linkified record JSON.", kind: .recordData),
        SectionMeta(id: "engagement", label: "Engagement counts", description: "Followers / posts and similar counts (non-post records).", kind: .helper),
        SectionMeta(id: "copyRow", label: "Copy & links", description: "Copy AT-URI / DID / JSON, plus outbound links.", kind: .helper),
        SectionMeta(id: "lexiconUsage", label: "Lexicon usage", description: "How this record's lexicon is used across the network.", kind: .helper),
        SectionMeta(id: "backlinks", label: "Backlinks", description: "Records elsewhere that reference this one.", kind: .helper),
        SectionMeta(id: "signIn", label: "Sign in to edit", description: "Prompt to sign in (only shown when signed out).", kind: .helper),
    ]

    /// Repo/profile-page sections in default display order. The breadcrumb
    /// and the tabbed collections view are fixed and not configurable.
    public static let repoSectionMeta: [SectionMeta] = [
        SectionMeta(id: "relationship", label: "Relationship bar", description: "The \"you + @them\" signals strip (silent for own / signed-out).", kind: .helper),
        SectionMeta(id: "profile", label: "Rich profile card", description: "Avatar, display name, bio, banner and stats.", kind: .recordData),
        SectionMeta(id: "identity", label: "Identity row", description: "Handle, DID and PDS.", kind: .recordData),
        SectionMeta(id: "repoGlance", label: "Repo at a glance", description: "Size, creation date and inbound activity tiles.", kind: .helper),
    ]

    /// Sections that count toward the "at least one data view always stays
    /// visible" rule. The rich preview card is a rendering and hides freely.
    public static let guaranteedDataIds: [ExplorePage: [String]] = [
        .record: ["structuredJson", "rawJson"],
        .repo: ["profile", "identity"],
    ]

    /// Everything shown except raw JSON, which is off by default.
    public static let defaultRecordSections: [SectionConfig] = recordSectionMeta.map {
        SectionConfig(id: $0.id, hidden: $0.id == "rawJson")
    }

    public static let defaultRepoSections: [SectionConfig] = repoSectionMeta.map {
        SectionConfig(id: $0.id, hidden: false)
    }

    public static func meta(for page: ExplorePage) -> [SectionMeta] {
        page == .record ? recordSectionMeta : repoSectionMeta
    }

    public static func defaults(for page: ExplorePage) -> [SectionConfig] {
        page == .record ? defaultRecordSections : defaultRepoSections
    }

    public static func isGuaranteedDataView(_ page: ExplorePage, id: String) -> Bool {
        guaranteedDataIds[page]?.contains(id) ?? false
    }

    /// Keep known ids in their saved order and visibility, drop unknown ids,
    /// then append any default section missing from the saved list so a
    /// section added in a later release shows up for existing users.
    public static func reconcile(saved: [SectionConfig], defaults: [SectionConfig]) -> [SectionConfig] {
        let known = Set(defaults.map(\.id))
        var seen = Set<String>()
        var out: [SectionConfig] = []
        for section in saved where known.contains(section.id) && !seen.contains(section.id) {
            out.append(section)
            seen.insert(section.id)
        }
        for section in defaults where !seen.contains(section.id) {
            out.append(section)
            seen.insert(section.id)
        }
        return out
    }

    /// Number of currently visible guaranteed data views for a page.
    public static func countVisibleGuaranteed(_ sections: [SectionConfig], page: ExplorePage) -> Int {
        let ids = guaranteedDataIds[page] ?? []
        return sections.filter { !$0.hidden && ids.contains($0.id) }.count
    }

    /// Whether a section id is marked hidden in a saved list (absent is visible).
    public static func sectionHidden(_ sections: [SectionConfig], id: String) -> Bool {
        sections.first { $0.id == id }?.hidden == true
    }
}

// MARK: - Custom waypoints

/// The inputs a custom waypoint template is expanded against. Every field is
/// optional because a profile page has no collection and a handle-only page
/// has no DID yet; `expandTemplate` refuses a template whose placeholder has
/// no value.
public struct CustomWaypointContext: Hashable, Sendable {
    public var handle: String?
    public var did: String?
    public var collection: String?
    public var rkey: String?

    public init(handle: String? = nil, did: String? = nil, collection: String? = nil, rkey: String? = nil) {
        self.handle = handle
        self.did = did
        self.collection = collection
        self.rkey = rkey
    }
}

/// A user-defined waypoint. Ids are `custom:<id>`; templates carry
/// `{handle}`, `{did}`, `{actor}`, `{collection}` and `{rkey}` placeholders.
public struct CustomWaypoint: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    /// Display hint, not used for routing.
    public var domain: String?
    public var description: String?
    public var supportedTypes: [WaypointType]
    public var templates: [WaypointType: String]
    /// Data families this waypoint participates in for auto-redirect. Nil or
    /// empty means it is never an auto-redirect destination, the right
    /// default for a personal bookmark.
    public var redirectCompat: [RedirectCompatFamily]?

    public init(
        id: String,
        name: String,
        domain: String? = nil,
        description: String? = nil,
        supportedTypes: [WaypointType],
        templates: [WaypointType: String],
        redirectCompat: [RedirectCompatFamily]? = nil
    ) {
        self.id = id
        self.name = name
        self.domain = domain
        self.description = description
        self.supportedTypes = supportedTypes
        self.templates = templates
        self.redirectCompat = redirectCompat
    }

    /// `isValidCustomWaypoint`. The preferences record is user-writable in the
    /// PDS, so a template value that is not a string, or a `redirectCompat`
    /// that is not an array of strings, rejects the whole waypoint rather
    /// than shipping one that would crash the picker or never redirect.
    /// Strings naming a type or family this build does not know are dropped
    /// from the arrays; the web keeps them but they never match anything.
    public init?(json: JSONValue) {
        guard let id = json["id"]?.stringValue,
              let name = json["name"]?.stringValue,
              let rawTypes = json["supportedTypes"]?.arrayValue,
              let rawTemplates = json["templates"]?.objectValue else { return nil }
        var types: [WaypointType] = []
        for raw in rawTypes {
            guard let s = raw.stringValue else { return nil }
            if let type = WaypointType(rawValue: s) { types.append(type) }
        }
        var templates: [WaypointType: String] = [:]
        for (key, raw) in rawTemplates {
            guard let s = raw.stringValue else { return nil }
            if let type = WaypointType(rawValue: key) { templates[type] = s }
        }
        var families: [RedirectCompatFamily]?
        if let rawFamilies = json["redirectCompat"] {
            guard let list = rawFamilies.arrayValue else { return nil }
            var out: [RedirectCompatFamily] = []
            for raw in list {
                guard let s = raw.stringValue else { return nil }
                if let family = RedirectCompatFamily(rawValue: s) { out.append(family) }
            }
            families = out
        }
        self.init(
            id: id,
            name: name,
            domain: json["domain"]?.stringValue,
            description: json["description"]?.stringValue,
            supportedTypes: types,
            templates: templates,
            redirectCompat: families
        )
    }

    /// The JSON the web writes for one custom waypoint. Optional fields are
    /// omitted when nil, like `JSON.stringify` drops `undefined`.
    public var jsonValue: JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id),
            "name": .string(name),
            "supportedTypes": .array(supportedTypes.map { .string($0.rawValue) }),
            "templates": .object(Dictionary(uniqueKeysWithValues: templates.map { ($0.key.rawValue, JSONValue.string($0.value)) })),
        ]
        if let domain { object["domain"] = .string(domain) }
        if let description { object["description"] = .string(description) }
        if let redirectCompat { object["redirectCompat"] = .array(redirectCompat.map { .string($0.rawValue) }) }
        return .object(object)
    }

    /// `customWaypointUrl` for this waypoint.
    public func url(for context: CustomWaypointContext) -> String? {
        customWaypointUrl(self, context: context)
    }

    /// Cheap unique id for a new custom waypoint: `custom:<ms base36><8 random base36>`.
    public static func newId(now: Date = Date()) -> String {
        "custom:\(Preferences.base36Timestamp(now))\(Preferences.randomBase36(length: 8))"
    }
}

extension CustomWaypoint: Codable {
    public init(from decoder: Decoder) throws {
        let json = try JSONValue(from: decoder)
        guard let parsed = CustomWaypoint(json: json) else {
            throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "not a custom waypoint"))
        }
        self = parsed
    }

    public func encode(to encoder: Encoder) throws {
        try jsonValue.encode(to: encoder)
    }
}

/// Expand a template into a URL, substituting placeholders. Identifier
/// placeholders go first so a template naming both handle and DID is not
/// mangled; `{actor}` prefers the DID, falling back to the handle, like the
/// built-in waypoints. Nil when a placeholder in the template has no value.
/// Colons in DIDs are un-encoded afterwards because they are URL-safe.
public func expandTemplate(_ template: String, context: CustomWaypointContext) -> String? {
    var out = template
    let actor = Preferences.presence(context.did) ?? Preferences.presence(context.handle)
    let replacements: [(String, String?)] = [
        ("{handle}", context.handle),
        ("{did}", context.did),
        ("{actor}", actor),
        ("{collection}", context.collection),
        ("{rkey}", context.rkey),
    ]
    for (token, value) in replacements where out.contains(token) {
        guard let value, !value.isEmpty else { return nil }
        out = out.replacingOccurrences(of: token, with: URIEncoding.encodeComponent(value))
    }
    return out.replacingOccurrences(of: "did%3A", with: "did:")
}

/// Which of a custom waypoint's templates renders a target, expanded. A
/// record prefers the template matching its collection (post / list), then
/// the generic `record` one, then `post`; anything without both collection
/// and rkey is a profile. `record` and `profile` are the last-resort
/// fallbacks so a waypoint with one template still produces something.
/// Shared by the picker and auto-redirect, which must agree.
public func customWaypointUrl(_ waypoint: CustomWaypoint, context: CustomWaypointContext) -> String? {
    let isRecord = Preferences.presence(context.collection) != nil && Preferences.presence(context.rkey) != nil
    var key: WaypointType = .profile
    if isRecord {
        if waypoint.supportedTypes.contains(.post), context.collection == "app.bsky.feed.post" {
            key = .post
        } else if waypoint.supportedTypes.contains(.list), context.collection == "app.bsky.graph.list" {
            key = .list
        } else if waypoint.supportedTypes.contains(.record) {
            key = .record
        } else {
            key = .post
        }
    }
    let template = Preferences.presence(waypoint.templates[key])
        ?? Preferences.presence(waypoint.templates[.record])
        ?? Preferences.presence(waypoint.templates[.profile])
    guard let template else { return nil }
    return expandTemplate(template, context: context)
}

/// Compat families a waypoint id belongs to, built-in or custom. An unknown
/// id, or one declaring no families, is `[]`: never an auto-redirect
/// destination.
public func getRedirectCompatFor(_ waypointId: String, customWaypoints: [CustomWaypoint]) -> [RedirectCompatFamily] {
    if waypointId.hasPrefix("custom:") {
        return customWaypoints.first { $0.id == waypointId }?.redirectCompat ?? []
    }
    return WaypointCatalog.all[waypointId]?.redirectCompat ?? []
}

// MARK: - Groups and layouts

/// A user-defined waypoint group: an ordered list of waypoint ids. The same
/// waypoint may sit in several groups; one in no group is hidden from the
/// picker.
public struct WaypointGroup: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var waypointIds: [String]
    public var collapsed: Bool?

    public init(id: String, name: String, waypointIds: [String], collapsed: Bool? = nil) {
        self.id = id
        self.name = name
        self.waypointIds = waypointIds
        self.collapsed = collapsed
    }

    /// `isValidWaypointGroup`: string id and name, and an array of string ids.
    public init?(json: JSONValue) {
        guard let id = json["id"]?.stringValue,
              let name = json["name"]?.stringValue,
              let rawIds = json["waypointIds"]?.arrayValue else { return nil }
        var ids: [String] = []
        for raw in rawIds {
            guard let s = raw.stringValue else { return nil }
            ids.append(s)
        }
        self.init(id: id, name: name, waypointIds: ids, collapsed: json["collapsed"]?.boolValue)
    }

    public var jsonValue: JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id),
            "name": .string(name),
            "waypointIds": .array(waypointIds.map { .string($0) }),
        ]
        if let collapsed { object["collapsed"] = .bool(collapsed) }
        return .object(object)
    }
}

extension WaypointGroup: Codable {
    public init(from decoder: Decoder) throws {
        let json = try JSONValue(from: decoder)
        guard let parsed = WaypointGroup(json: json) else {
            throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "not a waypoint group"))
        }
        self = parsed
    }

    public func encode(to encoder: Encoder) throws {
        try jsonValue.encode(to: encoder)
    }
}

/// How the universal-link picker draws its waypoints: `dense` is one line
/// per waypoint, `grid` icon tiles, `classic` full cards with descriptions.
public enum WaypointLayout: String, Codable, CaseIterable, Sendable, Hashable {
    case dense
    case grid
    case classic

    public static let `default`: WaypointLayout = .dense
}

/// Where the Pinned section shows up and which list backs it.
public enum PinScope: String, Codable, CaseIterable, Sendable, Hashable {
    /// `pinnedLexicons` only on the user's own repo.
    case own
    /// `pinnedLexicons` on every repo.
    case all
    /// `pinnedLexicons` on own, `pinnedLexiconsOthers` on everyone else's.
    case split
}

/// Which list backs a pin click. The "others" list only exists in split mode.
public enum PinTarget: String, Sendable, Hashable {
    case mine
    case others
}

/// Pin entry helpers. A pin is either an exact NSID or an NSID group
/// (`prefix.*`) covering everything nested beneath the prefix. Older clients
/// that do not understand the wildcard simply never match it.
public enum PinnedLexicons {
    public static let groupSuffix = ".*"

    public static func isGroup(_ entry: String) -> Bool {
        entry.hasSuffix(groupSuffix)
    }

    /// `app.bsky.feed.*` -> `app.bsky.feed`; an exact entry is returned as is.
    public static func groupPrefix(_ entry: String) -> String {
        isGroup(entry) ? String(entry.dropLast(groupSuffix.count)) : entry
    }

    /// Exact entries match only themselves; group entries match the prefix
    /// itself and anything nested beneath it.
    public static func matches(entry: String, nsid: String) -> Bool {
        guard isGroup(entry) else { return entry == nsid }
        let prefix = groupPrefix(entry)
        return nsid == prefix || nsid.hasPrefix(prefix + ".")
    }

    /// True when some group pin in `list` covers `nsid`.
    public static func covered(by list: [String], nsid: String) -> Bool {
        list.contains { isGroup($0) && matches(entry: $0, nsid: nsid) }
    }

    /// Which list a pin click targets given the scope and whose repo it is.
    public static func target(scope: PinScope, isOwnRepo: Bool) -> PinTarget {
        scope == .split && !isOwnRepo ? .others : .mine
    }

    /// Loose NSID validation: at least three dotted segments, each a letter
    /// followed by letters, digits or hyphens. Catches typos without
    /// blocking unusual but valid NSIDs.
    public static func isLikelyNsid(_ input: String) -> Bool {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, s.count <= 253 else { return false }
        let segments = s.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 3 else { return false }
        return segments.allSatisfy(isNsidSegment)
    }

    /// Anything pinnable from the settings input: a single NSID or a group
    /// wildcard whose prefix has at least two segments (`app.bsky.*`).
    public static func isLikelyPinEntry(_ input: String) -> Bool {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isGroup(s) else { return isLikelyNsid(s) }
        guard s.count <= 253 else { return false }
        let segments = groupPrefix(s).split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 2 else { return false }
        return segments.allSatisfy(isNsidSegment)
    }

    private static func isNsidSegment(_ segment: Substring) -> Bool {
        guard let first = segment.first, first.isASCII, first.isLetter else { return false }
        return segment.dropFirst().allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }
}

// MARK: - Preferences

/// The user's synced preferences. Field names match the JSON keys the web
/// writes; see the informal lexicon at the top of preferencesPds.ts.
public struct Preferences: Hashable, Sendable {
    public static let recordCollection = "to.aturi.actor.preferences"
    public static let recordKey = "self"
    /// UserDefaults / localStorage key.
    public static let localStorageKey = "aturi.prefs.v1"
    public static let customGroupId = "custom"
    public static let customGroupName = "My Waypoints"
    /// `new Date(0).toISOString()`, the `updatedAt` of never-saved prefs.
    public static let epochUpdatedAt = "1970-01-01T00:00:00.000Z"

    /// The app-wide palette; follows the user across devices.
    public var colorScheme: ColorScheme
    /// Display order of the picker's groups, and in-group order of ids.
    public var waypointGroups: [WaypointGroup]
    /// Legacy hide list, read for migration and still written for older clients.
    public var hiddenWaypoints: [String]
    /// Legacy order, read for migration and still written for older clients.
    public var waypointOrder: [String]
    public var customWaypoints: [CustomWaypoint]
    /// Master switch for auto-redirect. Off by default and deliberately so:
    /// on, aturi's own page is invisible to the person who set it.
    public var autoRedirect: Bool
    /// Preferred waypoint per compat family. Absent means no favourite; the
    /// web's explicit `null` spelling is dropped on read.
    public var favoriteByFamily: [RedirectCompatFamily: String]
    public var waypointLayout: WaypointLayout
    /// Built-in ids the user has been notified about; a new built-in is one
    /// missing from this list.
    public var knownWaypointIds: [String]
    /// Release-notes cursor owned by the web. Carried through untouched so a
    /// write from this device does not make the web re-announce a release.
    public var lastSeenReleaseId: String
    /// Whether the web shows its "What's new" modal. Carried through untouched.
    public var announceReleases: Bool
    public var pinnedLexicons: [String]
    public var pinnedLexiconsOthers: [String]
    public var pinScope: PinScope
    public var collectionGroupsCollapsedByDefault: Bool
    public var hideRelationshipBar: Bool
    public var hideRepoGlance: Bool
    public var repoGlanceCollapsedByDefault: Bool
    public var minimalProfile: Bool
    /// Deprecated: folded into `hideRichPreview`; read once on migration.
    public var minimalPostPreview: Bool
    public var hideRichPreview: Bool
    public var hideRichJsonPreview: Bool
    public var showRawRecordJson: Bool
    /// Source of truth for record-page layout; the booleans above are derived
    /// from it on write for older clients.
    public var recordSections: [SectionConfig]
    public var repoSections: [SectionConfig]
    /// ISO timestamp of the last local change; breaks ties between local and
    /// PDS copies on sign-in.
    public var updatedAt: String

    public init(
        colorScheme: ColorScheme = .default,
        waypointGroups: [WaypointGroup]? = nil,
        hiddenWaypoints: [String] = [],
        waypointOrder: [String] = [],
        customWaypoints: [CustomWaypoint] = [],
        autoRedirect: Bool = false,
        favoriteByFamily: [RedirectCompatFamily: String] = [:],
        waypointLayout: WaypointLayout = .default,
        knownWaypointIds: [String]? = nil,
        lastSeenReleaseId: String = "",
        announceReleases: Bool = true,
        pinnedLexicons: [String] = [],
        pinnedLexiconsOthers: [String] = [],
        pinScope: PinScope = .own,
        collectionGroupsCollapsedByDefault: Bool = false,
        hideRelationshipBar: Bool = false,
        hideRepoGlance: Bool = false,
        repoGlanceCollapsedByDefault: Bool = false,
        minimalProfile: Bool = false,
        minimalPostPreview: Bool = false,
        hideRichPreview: Bool = false,
        hideRichJsonPreview: Bool = false,
        showRawRecordJson: Bool = false,
        recordSections: [SectionConfig] = ExploreSections.defaultRecordSections,
        repoSections: [SectionConfig] = ExploreSections.defaultRepoSections,
        updatedAt: String = Preferences.epochUpdatedAt
    ) {
        self.colorScheme = colorScheme
        self.waypointGroups = waypointGroups ?? Preferences.defaultWaypointGroups()
        self.hiddenWaypoints = hiddenWaypoints
        self.waypointOrder = waypointOrder
        self.customWaypoints = customWaypoints
        self.autoRedirect = autoRedirect
        self.favoriteByFamily = favoriteByFamily
        self.waypointLayout = waypointLayout
        self.knownWaypointIds = knownWaypointIds ?? WaypointCatalog.order
        self.lastSeenReleaseId = lastSeenReleaseId
        self.announceReleases = announceReleases
        self.pinnedLexicons = pinnedLexicons
        self.pinnedLexiconsOthers = pinnedLexiconsOthers
        self.pinScope = pinScope
        self.collectionGroupsCollapsedByDefault = collectionGroupsCollapsedByDefault
        self.hideRelationshipBar = hideRelationshipBar
        self.hideRepoGlance = hideRepoGlance
        self.repoGlanceCollapsedByDefault = repoGlanceCollapsedByDefault
        self.minimalProfile = minimalProfile
        self.minimalPostPreview = minimalPostPreview
        self.hideRichPreview = hideRichPreview
        self.hideRichJsonPreview = hideRichJsonPreview
        self.showRawRecordJson = showRawRecordJson
        self.recordSections = recordSections
        self.repoSections = repoSections
        self.updatedAt = updatedAt
    }

    /// `DEFAULT_PREFERENCES`. `lastSeenReleaseId` is empty rather than the
    /// newest release id because the release list lives in the web app; the
    /// web reads an empty cursor as "announce the newest release once".
    public static let defaults = Preferences()

    // MARK: Lenient decoding (mergeWithDefaults)

    /// Fill missing or malformed fields with defaults. A payload with the
    /// legacy hide/order shape but no groups is migrated so the user's prior
    /// arrangement carries over. Anything that is not an object is the
    /// defaults.
    public static func mergeWithDefaults(_ input: JSONValue?) -> Preferences {
        guard let input, input.objectValue != nil else { return defaults }
        let colorScheme = ColorScheme(stored: input["colorScheme"]?.stringValue) ?? .default
        let customWaypoints = (input["customWaypoints"]?.arrayValue ?? []).compactMap(CustomWaypoint.init(json:))
        let autoRedirect = input["autoRedirect"]?.boolValue ?? false
        let favoriteByFamily = sanitizeFavoriteByFamily(input["favoriteByFamily"])
        let hiddenWaypoints = stringArray(input["hiddenWaypoints"])
        let waypointOrder = stringArray(input["waypointOrder"])
        let storedGroups = (input["waypointGroups"]?.arrayValue ?? []).compactMap(WaypointGroup.init(json:))
        let waypointGroups = storedGroups.isEmpty
            ? migrateToGroups(customWaypoints: customWaypoints, hiddenWaypoints: hiddenWaypoints, waypointOrder: waypointOrder)
            : storedGroups
        let waypointLayout = input["waypointLayout"]?.stringValue.flatMap(WaypointLayout.init(rawValue:)) ?? .default
        let knownWaypointIds = migrateKnownWaypointIds(input["knownWaypointIds"], waypointGroups: waypointGroups, hiddenWaypoints: hiddenWaypoints)
        // Absent means the prefs predate release notes: an empty cursor makes
        // the web announce the newest release once rather than swallow it.
        let lastSeenReleaseId = input["lastSeenReleaseId"]?.stringValue ?? ""
        let announceReleases = input["announceReleases"]?.boolValue ?? true
        let pinnedLexicons = stringArray(input["pinnedLexicons"])
        let pinnedLexiconsOthers = stringArray(input["pinnedLexiconsOthers"])
        let pinScope = input["pinScope"]?.stringValue.flatMap(PinScope.init(rawValue:)) ?? .own
        let collectionGroupsCollapsedByDefault = input["collectionGroupsCollapsedByDefault"]?.boolValue ?? false
        let hideRelationshipBar = input["hideRelationshipBar"]?.boolValue ?? false
        let hideRepoGlance = input["hideRepoGlance"]?.boolValue ?? false
        let repoGlanceCollapsedByDefault = input["repoGlanceCollapsedByDefault"]?.boolValue ?? false
        let minimalProfile = input["minimalProfile"]?.boolValue ?? false
        let minimalPostPreview = input["minimalPostPreview"]?.boolValue ?? false
        // hideRichPreview superseded the post-only minimalPostPreview; a blob
        // that predates it carries the old value over.
        let hideRichPreview = input["hideRichPreview"]?.boolValue ?? minimalPostPreview
        let hideRichJsonPreview = input["hideRichJsonPreview"]?.boolValue ?? false
        let showRawRecordJson = input["showRawRecordJson"]?.boolValue ?? false
        // Section lists are the source of truth; prefs that predate them are
        // seeded from the per-section booleans so the chosen layout survives.
        let recordSections: [SectionConfig]
        if let saved = input["recordSections"]?.arrayValue {
            recordSections = ExploreSections.reconcile(saved: saved.compactMap(SectionConfig.init(json:)), defaults: ExploreSections.defaultRecordSections)
        } else {
            recordSections = ExploreSections.defaultRecordSections.map { section in
                switch section.id {
                case "richPreview": return SectionConfig(id: section.id, hidden: hideRichPreview)
                case "structuredJson": return SectionConfig(id: section.id, hidden: hideRichJsonPreview)
                case "rawJson": return SectionConfig(id: section.id, hidden: !showRawRecordJson)
                default: return section
                }
            }
        }
        let repoSections: [SectionConfig]
        if let saved = input["repoSections"]?.arrayValue {
            repoSections = ExploreSections.reconcile(saved: saved.compactMap(SectionConfig.init(json:)), defaults: ExploreSections.defaultRepoSections)
        } else {
            repoSections = ExploreSections.defaultRepoSections.map { section in
                switch section.id {
                case "relationship": return SectionConfig(id: section.id, hidden: hideRelationshipBar)
                case "profile": return SectionConfig(id: section.id, hidden: minimalProfile)
                case "repoGlance": return SectionConfig(id: section.id, hidden: hideRepoGlance)
                default: return section
                }
            }
        }
        return Preferences(
            colorScheme: colorScheme,
            waypointGroups: waypointGroups,
            hiddenWaypoints: hiddenWaypoints,
            waypointOrder: waypointOrder,
            customWaypoints: customWaypoints,
            autoRedirect: autoRedirect,
            favoriteByFamily: favoriteByFamily,
            waypointLayout: waypointLayout,
            knownWaypointIds: knownWaypointIds,
            lastSeenReleaseId: lastSeenReleaseId,
            announceReleases: announceReleases,
            pinnedLexicons: pinnedLexicons,
            pinnedLexiconsOthers: pinnedLexiconsOthers,
            pinScope: pinScope,
            collectionGroupsCollapsedByDefault: collectionGroupsCollapsedByDefault,
            hideRelationshipBar: hideRelationshipBar,
            hideRepoGlance: hideRepoGlance,
            repoGlanceCollapsedByDefault: repoGlanceCollapsedByDefault,
            minimalProfile: minimalProfile,
            minimalPostPreview: minimalPostPreview,
            hideRichPreview: hideRichPreview,
            hideRichJsonPreview: hideRichJsonPreview,
            showRawRecordJson: showRawRecordJson,
            recordSections: recordSections,
            repoSections: repoSections,
            updatedAt: input["updatedAt"]?.stringValue ?? epochUpdatedAt
        )
    }

    /// The `value` of a `to.aturi.actor.preferences/self` record, read leniently.
    public init(recordValue: JSONValue) {
        self = Preferences.mergeWithDefaults(recordValue)
    }

    /// Keep only entries keyed by a family this build knows and pointing at a
    /// non-empty string id. A retired family, a newer client's key, a
    /// non-string, and the explicit `null` spelling are all dropped.
    static func sanitizeFavoriteByFamily(_ input: JSONValue?) -> [RedirectCompatFamily: String] {
        guard let source = input?.objectValue else { return [:] }
        var out: [RedirectCompatFamily: String] = [:]
        for family in WaypointCatalog.compatFamilyOrder {
            guard let id = source[family.rawValue]?.stringValue, !id.isEmpty else { continue }
            out[family] = id
        }
        return out
    }

    /// Seed `knownWaypointIds` for payloads that predate the field: anything
    /// in a group or the legacy hide list counts as seen, and no signal at all
    /// means a fresh user for whom every built-in is already known. An
    /// explicit array from storage is trusted.
    private static func migrateKnownWaypointIds(_ stored: JSONValue?, waypointGroups: [WaypointGroup], hiddenWaypoints: [String]) -> [String] {
        if let list = stored?.arrayValue {
            return list.compactMap(\.stringValue)
        }
        var seed: [String] = []
        var seen = Set<String>()
        for group in waypointGroups {
            for id in group.waypointIds where !id.hasPrefix("custom:") && seen.insert(id).inserted {
                seed.append(id)
            }
        }
        for id in hiddenWaypoints where !id.hasPrefix("custom:") && seen.insert(id).inserted {
            seed.append(id)
        }
        return seed.isEmpty ? WaypointCatalog.order : seed
    }

    private static func stringArray(_ value: JSONValue?) -> [String] {
        (value?.arrayValue ?? []).compactMap(\.stringValue)
    }

    /// Non-empty strings only, the JS truthiness test the web applies.
    static func presence(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    // MARK: Encoding

    /// Every field, the shape `JSON.stringify(prefs)` writes to localStorage
    /// and the shape `Codable` uses.
    public func jsonValue() -> JSONValue {
        .object([
            "colorScheme": .string(colorScheme.rawValue),
            "waypointGroups": .array(waypointGroups.map(\.jsonValue)),
            "hiddenWaypoints": .array(hiddenWaypoints.map { .string($0) }),
            "waypointOrder": .array(waypointOrder.map { .string($0) }),
            "customWaypoints": .array(customWaypoints.map(\.jsonValue)),
            "autoRedirect": .bool(autoRedirect),
            "favoriteByFamily": favoriteByFamilyValue,
            "waypointLayout": .string(waypointLayout.rawValue),
            "knownWaypointIds": .array(knownWaypointIds.map { .string($0) }),
            "lastSeenReleaseId": .string(lastSeenReleaseId),
            "announceReleases": .bool(announceReleases),
            "pinnedLexicons": .array(pinnedLexicons.map { .string($0) }),
            "pinnedLexiconsOthers": .array(pinnedLexiconsOthers.map { .string($0) }),
            "pinScope": .string(pinScope.rawValue),
            "collectionGroupsCollapsedByDefault": .bool(collectionGroupsCollapsedByDefault),
            "hideRelationshipBar": .bool(hideRelationshipBar),
            "hideRepoGlance": .bool(hideRepoGlance),
            "repoGlanceCollapsedByDefault": .bool(repoGlanceCollapsedByDefault),
            "minimalProfile": .bool(minimalProfile),
            "minimalPostPreview": .bool(minimalPostPreview),
            "hideRichPreview": .bool(hideRichPreview),
            "hideRichJsonPreview": .bool(hideRichJsonPreview),
            "showRawRecordJson": .bool(showRawRecordJson),
            "recordSections": .array(recordSections.map(\.jsonValue)),
            "repoSections": .array(repoSections.map(\.jsonValue)),
            "updatedAt": .string(updatedAt),
        ])
    }

    /// The record `writePreferencesToPds` puts: the synced fields, the
    /// per-section booleans derived from the section lists for older clients
    /// and the extension, the legacy hide/order fields for older clients, and
    /// a fresh `updatedAt` so concurrent edits elsewhere are detectable.
    public func toRecordValue(now: Date = Date()) -> JSONValue {
        .object([
            "$type": .string(Preferences.recordCollection),
            "colorScheme": .string(colorScheme.rawValue),
            "waypointGroups": .array(waypointGroups.map(\.jsonValue)),
            "customWaypoints": .array(customWaypoints.map(\.jsonValue)),
            "autoRedirect": .bool(autoRedirect),
            "favoriteByFamily": favoriteByFamilyValue,
            "waypointLayout": .string(waypointLayout.rawValue),
            "knownWaypointIds": .array(knownWaypointIds.map { .string($0) }),
            "lastSeenReleaseId": .string(lastSeenReleaseId),
            "announceReleases": .bool(announceReleases),
            "pinnedLexicons": .array(pinnedLexicons.map { .string($0) }),
            "pinnedLexiconsOthers": .array(pinnedLexiconsOthers.map { .string($0) }),
            "pinScope": .string(pinScope.rawValue),
            "collectionGroupsCollapsedByDefault": .bool(collectionGroupsCollapsedByDefault),
            "repoGlanceCollapsedByDefault": .bool(repoGlanceCollapsedByDefault),
            "recordSections": .array(recordSections.map(\.jsonValue)),
            "repoSections": .array(repoSections.map(\.jsonValue)),
            "hideRelationshipBar": .bool(ExploreSections.sectionHidden(repoSections, id: "relationship")),
            "hideRepoGlance": .bool(ExploreSections.sectionHidden(repoSections, id: "repoGlance")),
            "minimalProfile": .bool(ExploreSections.sectionHidden(repoSections, id: "profile")),
            "hideRichPreview": .bool(ExploreSections.sectionHidden(recordSections, id: "richPreview")),
            "hideRichJsonPreview": .bool(ExploreSections.sectionHidden(recordSections, id: "structuredJson")),
            "showRawRecordJson": .bool(!ExploreSections.sectionHidden(recordSections, id: "rawJson")),
            "hiddenWaypoints": .array(hiddenWaypoints.map { .string($0) }),
            "waypointOrder": .array(waypointOrder.map { .string($0) }),
            "updatedAt": .string(Formatting.isoTimestamp(now)),
        ])
    }

    private var favoriteByFamilyValue: JSONValue {
        var object: [String: JSONValue] = [:]
        for family in WaypointCatalog.compatFamilyOrder {
            if let id = favoriteByFamily[family] { object[family.rawValue] = .string(id) }
        }
        return .object(object)
    }

    // MARK: Comparison and merging

    /// The web's `preferencesAreEqual`: every synced field, ignoring the two
    /// legacy lists that are only ever migrated from.
    public static func preferencesAreEqual(_ a: Preferences, _ b: Preferences) -> Bool {
        a.updatedAt == b.updatedAt
            && a.colorScheme == b.colorScheme
            && a.waypointLayout == b.waypointLayout
            && a.pinScope == b.pinScope
            && a.collectionGroupsCollapsedByDefault == b.collectionGroupsCollapsedByDefault
            && a.hideRelationshipBar == b.hideRelationshipBar
            && a.hideRepoGlance == b.hideRepoGlance
            && a.repoGlanceCollapsedByDefault == b.repoGlanceCollapsedByDefault
            && a.minimalProfile == b.minimalProfile
            && a.minimalPostPreview == b.minimalPostPreview
            && a.hideRichPreview == b.hideRichPreview
            && a.recordSections == b.recordSections
            && a.repoSections == b.repoSections
            && a.hideRichJsonPreview == b.hideRichJsonPreview
            && a.showRawRecordJson == b.showRawRecordJson
            && a.autoRedirect == b.autoRedirect
            && a.favoriteByFamily == b.favoriteByFamily
            && a.waypointGroups == b.waypointGroups
            && a.customWaypoints == b.customWaypoints
            && a.knownWaypointIds == b.knownWaypointIds
            && a.lastSeenReleaseId == b.lastSeenReleaseId
            && a.announceReleases == b.announceReleases
            && a.pinnedLexicons == b.pinnedLexicons
            && a.pinnedLexiconsOthers == b.pinnedLexiconsOthers
    }

    /// `pickNewer` from preferencesPds.ts: the copy with the later
    /// `updatedAt`, preferring `b` (the PDS copy on sign-in) on a tie or when
    /// either timestamp does not parse.
    public static func pickNewer(_ a: Preferences, _ b: Preferences) -> Preferences {
        secondIsAtLeastAsNew(a, b) ? b : a
    }

    /// `new Date(b.updatedAt) >= new Date(a.updatedAt)`; false when either
    /// timestamp does not parse, like a NaN comparison.
    static func secondIsAtLeastAsNew(_ a: Preferences, _ b: Preferences) -> Bool {
        guard let bTime = Formatting.isoDate(b.updatedAt), let aTime = Formatting.isoDate(a.updatedAt) else { return false }
        return bTime >= aTime
    }

    /// Whether the local copy carries anything worth pushing to a PDS that
    /// has no record yet (the provider's `hasLocalCustomization`).
    public var hasLocalCustomization: Bool {
        colorScheme != Preferences.defaults.colorScheme
            || !customWaypoints.isEmpty
            || !hiddenWaypoints.isEmpty
            || !waypointOrder.isEmpty
            || waypointGroups != Preferences.defaults.waypointGroups
    }

    // MARK: Auto-redirect and layout

    public mutating func setAutoRedirect(_ enabled: Bool) {
        autoRedirect = enabled
    }

    /// Set, or with nil clear, the favourite for one family. Clearing removes
    /// the key rather than storing a null.
    public mutating func setFavorite(for family: RedirectCompatFamily, waypointId: String?) {
        if let waypointId, !waypointId.isEmpty {
            favoriteByFamily[family] = waypointId
        } else {
            favoriteByFamily.removeValue(forKey: family)
        }
    }

    public mutating func setWaypointLayout(_ layout: WaypointLayout) {
        waypointLayout = layout
    }

    // MARK: Pinned lexicons

    private func pinList(_ target: PinTarget) -> [String] {
        target == .others ? pinnedLexiconsOthers : pinnedLexicons
    }

    private mutating func setPinList(_ target: PinTarget, _ list: [String]) {
        if target == .others { pinnedLexiconsOthers = list } else { pinnedLexicons = list }
    }

    public mutating func togglePinnedLexicon(_ nsid: String, target: PinTarget = .mine) {
        let list = pinList(target)
        setPinList(target, list.contains(nsid) ? list.filter { $0 != nsid } : list + [nsid])
    }

    public mutating func addPinnedLexicon(_ nsid: String, target: PinTarget = .mine) {
        let list = pinList(target)
        guard !list.contains(nsid) else { return }
        setPinList(target, list + [nsid])
    }

    public mutating func removePinnedLexicon(_ nsid: String, target: PinTarget = .mine) {
        setPinList(target, pinList(target).filter { $0 != nsid })
    }

    public mutating func setPinScope(_ scope: PinScope) {
        pinScope = scope
    }

    // MARK: Groups

    /// The default groups, one per built-in category in `categoryOrder`
    /// holding that category's waypoints in catalog order, plus a custom
    /// group when there are custom waypoints. What a new user sees.
    public static func defaultWaypointGroups(customWaypoints: [CustomWaypoint] = []) -> [WaypointGroup] {
        var groups: [WaypointGroup] = []
        for categoryId in WaypointCatalog.categoryOrder {
            let ids = WaypointCatalog.order.filter { WaypointCatalog.all[$0]?.category == categoryId }
            if ids.isEmpty { continue }
            groups.append(WaypointGroup(id: categoryId, name: WaypointCatalog.categories[categoryId]?.name ?? categoryId, waypointIds: ids))
        }
        if !customWaypoints.isEmpty {
            groups.append(WaypointGroup(id: customGroupId, name: customGroupName, waypointIds: customWaypoints.map(\.id)))
        }
        return groups
    }

    /// One-time migration from the legacy `hiddenWaypoints` + `waypointOrder`
    /// shape: hidden ids are skipped, the stored order is honoured within
    /// each built-in category bucket, and buckets follow `categoryOrder`
    /// with the custom group and any unknown category after them.
    public static func migrateToGroups(customWaypoints: [CustomWaypoint] = [], hiddenWaypoints: [String] = [], waypointOrder: [String] = []) -> [WaypointGroup] {
        let hidden = Set(hiddenWaypoints)
        let customIds = Set(customWaypoints.map(\.id))
        func effectiveCategory(_ id: String) -> String {
            if customIds.contains(id) { return customGroupId }
            return WaypointCatalog.all[id]?.category ?? customGroupId
        }

        var seen = Set<String>()
        var fullOrder: [String] = []
        for id in waypointOrder + WaypointCatalog.order + customWaypoints.map(\.id) where seen.insert(id).inserted {
            fullOrder.append(id)
        }

        var buckets: [String: [String]] = [:]
        var bucketOrder: [String] = []
        for id in fullOrder where !hidden.contains(id) {
            let category = effectiveCategory(id)
            if buckets[category] == nil {
                buckets[category] = []
                bucketOrder.append(category)
            }
            buckets[category]?.append(id)
        }

        var headerOrder = WaypointCatalog.categoryOrder.filter { buckets[$0] != nil }
        if buckets[customGroupId] != nil, !headerOrder.contains(customGroupId) {
            headerOrder.append(customGroupId)
        }
        for category in bucketOrder where !headerOrder.contains(category) {
            headerOrder.append(category)
        }

        return headerOrder.map { categoryId in
            let name = categoryId == customGroupId
                ? customGroupName
                : WaypointCatalog.categories[categoryId]?.name ?? prettyGroupName(categoryId)
            return WaypointGroup(id: categoryId, name: name, waypointIds: buckets[categoryId] ?? [])
        }
    }

    /// "blueskyClients" -> "Bluesky Clients", for a category the catalog no
    /// longer names.
    static func prettyGroupName(_ id: String) -> String {
        var out = ""
        for character in id {
            if character.isUppercase { out.append(" ") }
            out.append(character)
        }
        guard let first = out.first else { return out }
        return (String(first).uppercased() + out.dropFirst()).trimmingCharacters(in: .whitespaces)
    }

    /// Built-in ids that shipped since the user was last notified, in
    /// catalog order. Custom ids never appear.
    public var newBuiltinWaypointIds: [String] {
        let known = Set(knownWaypointIds)
        return WaypointCatalog.order.filter { !known.contains($0) && WaypointCatalog.all[$0] != nil }
    }

    /// Mark built-in ids as seen so the "new waypoint" banner stops surfacing
    /// them. Custom ids are ignored. Returns whether anything changed.
    @discardableResult
    public mutating func markWaypointsKnown(_ ids: [String]) -> Bool {
        var known = Set(knownWaypointIds)
        var changed = false
        for id in ids where !id.hasPrefix("custom:") && known.insert(id).inserted {
            knownWaypointIds.append(id)
            changed = true
        }
        return changed
    }

    /// Quick-add new built-ins into their default category group, creating
    /// that group (appended) if the user removed it, and mark them known.
    /// Backs the "Add" action on the new-waypoint banner.
    public mutating func addWaypointsToDefaultGroups(_ ids: [String]) {
        for id in ids {
            guard let data = WaypointCatalog.all[id] else { continue }
            let categoryId = data.category
            if let index = waypointGroups.firstIndex(where: { $0.id == categoryId }) {
                if !waypointGroups[index].waypointIds.contains(id) {
                    waypointGroups[index].waypointIds.append(id)
                }
            } else {
                let name = WaypointCatalog.categories[categoryId]?.name ?? Preferences.prettyGroupName(categoryId)
                waypointGroups.append(WaypointGroup(id: categoryId, name: name, waypointIds: [id]))
            }
        }
        markWaypointsKnown(ids)
    }

    /// `g_<ms base36><4 random base36>`.
    static func newGroupId(now: Date = Date()) -> String {
        "g_\(base36Timestamp(now))\(randomBase36(length: 4))"
    }

    public mutating func setWaypointGroups(_ groups: [WaypointGroup]) {
        waypointGroups = groups
    }

    /// Append an empty group and return its id. A blank name becomes "New group".
    @discardableResult
    public mutating func addGroup(named name: String) -> String {
        let id = Preferences.newGroupId()
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        waypointGroups.append(WaypointGroup(id: id, name: trimmed.isEmpty ? "New group" : trimmed, waypointIds: []))
        return id
    }

    public mutating func removeGroup(id groupId: String) {
        waypointGroups.removeAll { $0.id == groupId }
    }

    /// Rename a group; a blank name is a no-op.
    public mutating func renameGroup(id groupId: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        for index in waypointGroups.indices where waypointGroups[index].id == groupId {
            waypointGroups[index].name = trimmed
        }
    }

    public mutating func setGroupCollapsed(id groupId: String, collapsed: Bool) {
        for index in waypointGroups.indices where waypointGroups[index].id == groupId {
            waypointGroups[index].collapsed = collapsed
        }
    }

    /// Append a waypoint to a group unless it is already there.
    public mutating func addWaypoint(_ waypointId: String, toGroup groupId: String) {
        for index in waypointGroups.indices
        where waypointGroups[index].id == groupId && !waypointGroups[index].waypointIds.contains(waypointId) {
            waypointGroups[index].waypointIds.append(waypointId)
        }
    }

    public mutating func removeWaypoint(_ waypointId: String, fromGroup groupId: String) {
        for index in waypointGroups.indices where waypointGroups[index].id == groupId {
            waypointGroups[index].waypointIds.removeAll { $0 == waypointId }
        }
    }

    public mutating func setGroupWaypointOrder(groupId: String, ids: [String]) {
        for index in waypointGroups.indices where waypointGroups[index].id == groupId {
            waypointGroups[index].waypointIds = ids
        }
    }

    // MARK: Explore page sections

    public func sections(for page: ExplorePage) -> [SectionConfig] {
        page == .record ? recordSections : repoSections
    }

    /// Replace the ordered section list for a page (after a drag-reorder).
    public mutating func setSections(page: ExplorePage, sections: [SectionConfig]) {
        if page == .record { recordSections = sections } else { repoSections = sections }
    }

    /// Show or hide one section. Hiding is a no-op when it would hide the
    /// last visible guaranteed data view; the page must always show one.
    public mutating func setSectionHidden(page: ExplorePage, id: String, hidden: Bool) {
        let current = sections(for: page)
        if hidden, ExploreSections.isGuaranteedDataView(page, id: id) {
            let currentlyVisible = current.contains { $0.id == id && !$0.hidden }
            if currentlyVisible, ExploreSections.countVisibleGuaranteed(current, page: page) <= 1 { return }
        }
        setSections(page: page, sections: current.map { $0.id == id ? SectionConfig(id: $0.id, hidden: hidden) : $0 })
    }

    /// Toggle one of the two record-page data views (`structuredJson` /
    /// `rawJson`), showing the other when this one is being hidden so at
    /// least one stays visible.
    public mutating func toggleRecordDataView(_ id: String) {
        let partner = id == "structuredJson" ? "rawJson" : "structuredJson"
        let currentlyHidden = ExploreSections.sectionHidden(recordSections, id: id)
        recordSections = recordSections.map { section in
            if section.id == id { return SectionConfig(id: section.id, hidden: !currentlyHidden) }
            if section.id == partner, !currentlyHidden { return SectionConfig(id: section.id, hidden: false) }
            return section
        }
    }

    /// Restore a page's section list to its defaults.
    public mutating func resetSections(page: ExplorePage) {
        setSections(page: page, sections: ExploreSections.defaults(for: page))
    }

    // MARK: Id helpers

    static func base36Timestamp(_ date: Date) -> String {
        String(UInt64(max(0, date.timeIntervalSince1970 * 1000)), radix: 36)
    }

    static func randomBase36(length: Int) -> String {
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return String((0..<length).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }
}

extension Preferences: Codable {
    /// Decodes leniently through `mergeWithDefaults`, so a stored blob from
    /// any client version loads.
    public init(from decoder: Decoder) throws {
        self = Preferences.mergeWithDefaults(try JSONValue(from: decoder))
    }

    public func encode(to encoder: Encoder) throws {
        try jsonValue().encode(to: encoder)
    }
}
