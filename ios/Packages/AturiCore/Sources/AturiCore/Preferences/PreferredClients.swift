import Foundation

// Port of src/utils/preferredClients.ts: an account's public declaration of
// which app it wants each kind of atproto link opened in, stored as
// `at://<did>/to.aturi.actor.preferredClients/self`. The schema is
// lexicons/to/aturi/actor/preferredClients.json at the repo root.
//
// Each declared client carries its own URL templates, so any reader can act
// on it; the catalog id rides along as a hint, and `declaredClient(fromWaypoint:)`
// writes the templates out of the catalog's URL builders. Also here: the
// form model behind the Clients settings screen, which is the logic of
// ClientsTab.tsx kept out of SwiftUI so it can be tested.

public enum PreferredClients {
    public static let collection = "to.aturi.actor.preferredClients"
    public static let recordKey = "self"

    /// The categories Aturi writes and documents. The lexicon leaves
    /// `category` open, so a record may carry others; the ids are compat
    /// family ids, so a declared preference and a favourite for the same
    /// family mean the same thing.
    public static let categories: [RedirectCompatFamily] = [.blueskySocial, .atprotoExplorer]

    // Limits from the lexicon. A record over them is read trimmed to fit
    // rather than refused, as on the web.
    static let maxPreferences = 32
    static let maxCategoryLength = 64
    static let maxUrlLength = 512
    static let maxNameLength = 640
    static let maxWaypointLength = 128
    static let maxTemplateLength = 1024
}

/// The device split a preference can declare. The app itself always reads
/// the `mobile` half: tablets count as mobile, as the lexicon says.
public enum ClientPlatform: String, CaseIterable, Sendable, Hashable {
    case mobile
    case desktop
}

/// The link shapes a declared client has templates for.
public enum ClientLinkTemplateKind: String, CaseIterable, Sendable, Hashable {
    case profile
    case post
    case list
    case record
}

/// Whether a string is an absolute http(s) URL with a host. Everything a
/// declaration produces passes this before it is used: the record is
/// writable by anything holding a token for the account's PDS.
func isHttpUrl(_ value: String) -> Bool {
    isSafeRedirectUrl(value)
}

private func boundedString(_ value: JSONValue?, max: Int) -> String? {
    guard let string = value?.stringValue, !string.isEmpty, string.utf16.count <= max else { return nil }
    return string
}

// MARK: - Record

public struct DeclaredClient: Hashable, Sendable {
    /// The client's web address, e.g. `https://blacksky.community`.
    public var url: String
    public var name: String?
    /// Id in Aturi's waypoint catalog, when the client is a catalog entry.
    public var waypoint: String?
    public var templates: [ClientLinkTemplateKind: String]

    public init(url: String, name: String? = nil, waypoint: String? = nil, templates: [ClientLinkTemplateKind: String] = [:]) {
        self.url = url
        self.name = name
        self.waypoint = waypoint
        self.templates = templates
    }

    /// Lenient read: nil unless `url` is an http(s) URL; malformed optional
    /// fields are dropped one by one.
    public init?(json: JSONValue?) {
        guard let json, json.objectValue != nil else { return nil }
        guard let url = boundedString(json["url"], max: PreferredClients.maxUrlLength), isHttpUrl(url) else { return nil }
        var templates: [ClientLinkTemplateKind: String] = [:]
        for kind in ClientLinkTemplateKind.allCases {
            if let template = boundedString(json["templates"]?[kind.rawValue], max: PreferredClients.maxTemplateLength) {
                templates[kind] = template
            }
        }
        self.init(
            url: url,
            name: boundedString(json["name"], max: PreferredClients.maxNameLength),
            waypoint: boundedString(json["waypoint"], max: PreferredClients.maxWaypointLength),
            templates: templates
        )
    }

    public var jsonValue: JSONValue {
        var object: [String: JSONValue] = ["url": .string(url)]
        if let name { object["name"] = .string(name) }
        if let waypoint { object["waypoint"] = .string(waypoint) }
        if !templates.isEmpty {
            var out: [String: JSONValue] = [:]
            for (kind, template) in templates { out[kind.rawValue] = .string(template) }
            object["templates"] = .object(out)
        }
        return .object(object)
    }

    /// The client's display name, or its host.
    public var displayName: String {
        name ?? WaypointCatalog.hostComponent(of: url) ?? url
    }
}

public struct ClientPreference: Hashable, Sendable {
    public var category: String
    /// Any device, unless `mobile` or `desktop` applies.
    public var client: DeclaredClient?
    public var mobile: DeclaredClient?
    public var desktop: DeclaredClient?

    public init(category: String, client: DeclaredClient? = nil, mobile: DeclaredClient? = nil, desktop: DeclaredClient? = nil) {
        self.category = category
        self.client = client
        self.mobile = mobile
        self.desktop = desktop
    }

    public init?(json: JSONValue?) {
        guard let json, json.objectValue != nil,
              let category = boundedString(json["category"], max: PreferredClients.maxCategoryLength)
        else { return nil }
        self.init(
            category: category,
            client: DeclaredClient(json: json["client"]),
            mobile: DeclaredClient(json: json["mobile"]),
            desktop: DeclaredClient(json: json["desktop"])
        )
        guard hasAnyClient else { return nil }
    }

    public var hasAnyClient: Bool {
        client != nil || mobile != nil || desktop != nil
    }

    public func client(for platform: ClientPlatform) -> DeclaredClient? {
        switch platform {
        case .mobile: return mobile
        case .desktop: return desktop
        }
    }

    public var jsonValue: JSONValue {
        var object: [String: JSONValue] = ["category": .string(category)]
        if let client { object["client"] = client.jsonValue }
        if let mobile { object["mobile"] = mobile.jsonValue }
        if let desktop { object["desktop"] = desktop.jsonValue }
        return .object(object)
    }
}

public struct PreferredClientsRecord: Hashable, Sendable {
    public var preferences: [ClientPreference]
    public var updatedAt: String?

    public init(preferences: [ClientPreference], updatedAt: String? = nil) {
        self.preferences = preferences
        self.updatedAt = updatedAt
    }

    /// `parsePreferredClients`: nil when the value isn't a declaration at all
    /// (not an object, another `$type`, no `preferences` array); malformed
    /// entries inside one are dropped one by one.
    public init?(recordValue: JSONValue?) {
        guard let value = recordValue, value.objectValue != nil else { return nil }
        if let type = value["$type"], type.stringValue != PreferredClients.collection { return nil }
        guard let list = value["preferences"]?.arrayValue else { return nil }
        self.init(
            preferences: list.prefix(PreferredClients.maxPreferences).compactMap(ClientPreference.init(json:)),
            updatedAt: value["updatedAt"]?.stringValue
        )
    }

    /// `buildPreferredClientsRecord`: the first entry per category, entries
    /// with no client dropped, and a fresh `updatedAt`.
    public static func build(_ preferences: [ClientPreference], now: Date = Date()) -> PreferredClientsRecord {
        var seen = Set<String>()
        var kept: [ClientPreference] = []
        for preference in preferences where preference.hasAnyClient && seen.insert(preference.category).inserted {
            kept.append(preference)
            if kept.count == PreferredClients.maxPreferences { break }
        }
        return PreferredClientsRecord(preferences: kept, updatedAt: Formatting.isoTimestamp(now))
    }

    public func toRecordValue() -> JSONValue {
        var object: [String: JSONValue] = [
            "$type": .string(PreferredClients.collection),
            "preferences": .array(preferences.map(\.jsonValue)),
        ]
        if let updatedAt { object["updatedAt"] = .string(updatedAt) }
        return .object(object)
    }

    /// `getPreferredClient`: the first entry for the category; the platform's
    /// client when one is declared, else the general one. Without a
    /// platform only the general client counts.
    public func client(for category: String, platform: ClientPlatform? = nil) -> DeclaredClient? {
        guard let entry = preferences.first(where: { $0.category == category }) else { return nil }
        if let platform, let specific = entry.client(for: platform) { return specific }
        return entry.client
    }
}

/// The declaration as the session layer last read it.
public enum DeclarationState: Hashable, Sendable {
    /// Signed out.
    case idle
    case loading
    /// Nothing declared.
    case missing
    case loaded(PreferredClientsRecord)
    /// A record exists but is not a declaration this build can read.
    case invalid
    case failed(String)

    public var record: PreferredClientsRecord? {
        if case .loaded(let record) = self { return record }
        return nil
    }

    /// Whether the PDS has answered, so an editor can trust `record`.
    public var isSettled: Bool {
        switch self {
        case .missing, .loaded, .invalid: return true
        case .idle, .loading, .failed: return false
        }
    }
}

// MARK: - Links

/// Percent-encode a substituted value, keeping `:` literal.
private func encodeTemplateValue(_ value: String) -> String {
    URIEncoding.encodeComponent(value).replacingOccurrences(of: "%3A", with: ":")
}

private let placeholderNames: Set<String> = ["handle", "did", "actor", "collection", "rkey"]

/// Fill a link template: nil when a placeholder has no value. `{handle}`
/// falls back to the DID, `{actor}` is the DID else the handle, `{did}` has
/// no fallback. A single pass, so a value containing `{rkey}` is never
/// expanded twice.
func expandLinkTemplate(_ template: String, target: CustomWaypointContext) -> String? {
    let handle = Preferences.presence(target.handle) ?? Preferences.presence(target.did)
    let values: [String: String?] = [
        "handle": handle,
        "did": Preferences.presence(target.did),
        "actor": Preferences.presence(target.did) ?? Preferences.presence(target.handle),
        "collection": Preferences.presence(target.collection),
        "rkey": Preferences.presence(target.rkey),
    ]
    var out = ""
    var rest = template[...]
    while let open = rest.firstIndex(of: "{") {
        out += rest[rest.startIndex..<open]
        let afterOpen = rest.index(after: open)
        guard let close = rest[afterOpen...].firstIndex(of: "}") else {
            out += rest[open...]
            return out
        }
        let name = String(rest[afterOpen..<close])
        if placeholderNames.contains(name) {
            guard let value = values[name] ?? nil else { return nil }
            out += encodeTemplateValue(value)
        } else {
            out += rest[open...close]
        }
        rest = rest[rest.index(after: close)...]
    }
    out += rest
    return out
}

/// Which templates can open a target, best first. No fall back to the
/// profile for a record: a "view post" link that lands on a profile is
/// wrong in a way the reader can't see.
private func templateKinds(for target: CustomWaypointContext) -> [ClientLinkTemplateKind] {
    if Preferences.presence(target.collection) != nil, Preferences.presence(target.rkey) != nil {
        if target.collection == "app.bsky.feed.post" { return [.post, .record] }
        if target.collection == "app.bsky.graph.list" { return [.list, .record] }
        return [.record]
    }
    return [.profile]
}

/// `getPreferredClientUrl`: the URL that opens a target in a declared
/// client, or nil when it can't. The record's own templates first; a kind
/// it leaves out comes from the catalog waypoint it names. Only http(s)
/// results are returned.
public func preferredClientUrl(_ client: DeclaredClient, target: CustomWaypointContext) -> String? {
    let catalog = client.waypoint.flatMap(waypointLinkTemplates)
    for kind in templateKinds(for: target) {
        for template in [client.templates[kind], catalog?[kind]] {
            guard let template, let url = expandLinkTemplate(template, target: target) else { continue }
            if isHttpUrl(url) { return url }
        }
    }
    return nil
}

/// The same, from an AT URI string. Permissioned space addresses and
/// anything that isn't an AT URI are nil.
public func preferredClientUrl(_ client: DeclaredClient, atUri: String) -> String? {
    guard let parsed = reverseParseAtUri(atUri)?.parsed else { return nil }
    return preferredClientUrl(client, target: CustomWaypointContext(handle: parsed.handle, did: parsed.did, collection: parsed.collection, rkey: parsed.rkey))
}

// MARK: - Templates from the catalog

/// Probe values for reading templates back out of a waypoint's URL builder:
/// distinct, none containing another, so every occurrence maps back to one
/// placeholder. Anything still saying "probe" afterwards is discarded.
private enum Probe {
    static let handle = "handle-probe.invalid"
    static let did = "did:plc:didprobe"
    static let collection = "invalid.collection.probe"
    static let rkey = "rkeyprobe"
}

/// An ordinary-looking target a derived template is checked against.
private enum Check {
    static let handle = "alice.example.com"
    static let did = "did:plc:abc234def567"
    static let collection = "com.example.note"
    static let rkey = "3kcheckrkey2"
}

private func fixedCollection(_ kind: ClientLinkTemplateKind) -> String? {
    switch kind {
    case .post: return "app.bsky.feed.post"
    case .list: return "app.bsky.graph.list"
    case .profile, .record: return nil
    }
}

private func callUrl(_ waypoint: Waypoint, _ kind: ClientLinkTemplateKind, handle: String, did: String?, collection: String, rkey: String) -> String? {
    if kind == .profile { return waypoint.url(handle: handle, did: did) }
    return waypoint.url(handle: handle, collection: fixedCollection(kind) ?? collection, rkey: rkey, did: did)
}

private func tokenizeProbe(_ url: String) -> String? {
    var out = url
    out = out.replacingOccurrences(of: Probe.did, with: "{did}")
    out = out.replacingOccurrences(of: URIEncoding.encodeComponent(Probe.did), with: "{did}")
    out = out.replacingOccurrences(of: Probe.handle, with: "{handle}")
    out = out.replacingOccurrences(of: Probe.collection, with: "{collection}")
    out = out.replacingOccurrences(of: Probe.rkey, with: "{rkey}")
    return out.lowercased().contains("probe") ? nil : out
}

/// One template kind read back out of a waypoint's URL builder, or nil when
/// the builder doesn't produce a faithful one: a template must address what
/// its kind says and reproduce the builder on an input it wasn't derived
/// from. A builder that uses the DID when given one and the handle
/// otherwise is written as `{actor}`.
private func deriveTemplate(_ waypoint: Waypoint, _ kind: ClientLinkTemplateKind) -> String? {
    guard let withDid = callUrl(waypoint, kind, handle: Probe.handle, did: Probe.did, collection: Probe.collection, rkey: Probe.rkey),
          var template = tokenizeProbe(withDid)
    else { return nil }

    if template.contains("{did}") {
        let withoutDid = callUrl(waypoint, kind, handle: Probe.handle, did: nil, collection: Probe.collection, rkey: Probe.rkey)
        if withoutDid.flatMap(tokenizeProbe) == template.replacingOccurrences(of: "{did}", with: "{handle}") {
            template = template.replacingOccurrences(of: "{did}", with: "{actor}")
        }
    }

    let required: [String]
    switch kind {
    case .profile: required = []
    case .record: required = ["{collection}", "{rkey}"]
    case .post, .list: required = ["{rkey}"]
    }
    guard required.allSatisfy(template.contains) else { return nil }
    guard ["{handle}", "{did}", "{actor}"].contains(where: template.contains) else { return nil }

    let dids: [String?] = template.contains("{actor}") ? [Check.did, nil] : [Check.did]
    for did in dids {
        let expected = callUrl(waypoint, kind, handle: Check.handle, did: did, collection: Check.collection, rkey: Check.rkey)
        let actual = expandLinkTemplate(template, target: CustomWaypointContext(
            handle: Check.handle,
            did: did,
            collection: fixedCollection(kind) ?? Check.collection,
            rkey: Check.rkey
        ))
        guard let expected, let actual, actual == expected, isHttpUrl(actual) else { return nil }
    }
    return template
}

/// Every catalog waypoint's derivable templates, worked out once.
private let catalogTemplates: [String: [ClientLinkTemplateKind: String]] = {
    var out: [String: [ClientLinkTemplateKind: String]] = [:]
    for (id, waypoint) in WaypointCatalog.all {
        var derived: [ClientLinkTemplateKind: String] = [:]
        for kind in ClientLinkTemplateKind.allCases {
            guard let type = WaypointType(rawValue: kind.rawValue), waypoint.supportedTypes.contains(type) else { continue }
            if let template = deriveTemplate(waypoint, kind) { derived[kind] = template }
        }
        if !derived.isEmpty { out[id] = derived }
    }
    return out
}()

/// `getWaypointLinkTemplates`: a catalog waypoint's URL templates in the form
/// a declaration stores them, derived from its URL builder so the two can't
/// drift. Nil for an unknown id or one with no derivable template.
public func waypointLinkTemplates(_ waypointId: String) -> [ClientLinkTemplateKind: String]? {
    catalogTemplates[waypointId]
}

/// `clientFromWaypoint`: a catalog waypoint as a declared client, its origin
/// as `url`. Nil when its links can't be written as templates.
public func declaredClient(fromWaypoint waypointId: String) -> DeclaredClient? {
    guard let waypoint = WaypointCatalog.all[waypointId], let templates = waypointLinkTemplates(waypointId) else { return nil }
    let check = CustomWaypointContext(handle: Check.handle, did: Check.did, collection: Check.collection, rkey: Check.rkey)
    guard let sample = ClientLinkTemplateKind.allCases.lazy.compactMap({ templates[$0] }).compactMap({ expandLinkTemplate($0, target: check) }).first,
          let host = WaypointCatalog.hostComponent(of: sample),
          let scheme = sample.range(of: "://").map({ sample[sample.startIndex..<$0.lowerBound] })
    else { return nil }
    return DeclaredClient(url: "\(scheme)://\(host)", name: waypoint.name, waypoint: waypoint.id, templates: templates)
}

/// A custom waypoint as a declared client: same placeholders, same template
/// kinds. `url` is the origin of the first template that parses as an
/// http(s) URL once its placeholders are filled.
public func declaredClient(fromCustom custom: CustomWaypoint) -> DeclaredClient? {
    var templates: [ClientLinkTemplateKind: String] = [:]
    for kind in ClientLinkTemplateKind.allCases {
        guard let type = WaypointType(rawValue: kind.rawValue), custom.supportedTypes.contains(type),
              let template = Preferences.presence(custom.templates[type])
        else { continue }
        templates[kind] = template
    }
    for kind in ClientLinkTemplateKind.allCases {
        guard let template = templates[kind] else { continue }
        let filled = template.replacingOccurrences(of: #"\{[a-z]+\}"#, with: "x", options: .regularExpression)
        guard isHttpUrl(filled), let host = WaypointCatalog.hostComponent(of: filled),
              let scheme = filled.range(of: "://").map({ filled[filled.startIndex..<$0.lowerBound].lowercased() })
        else { continue }
        return DeclaredClient(url: "\(scheme)://\(host)", name: custom.name, templates: templates)
    }
    return nil
}

// MARK: - The Clients settings form

/// One choice in a category's menu.
public struct DeclaredClientOption: Hashable, Sendable, Identifiable {
    public enum Source: Hashable, Sendable {
        case catalog
        case custom
        /// A client the published record names that is neither of the above.
        case record
    }

    public var id: String
    public var label: String
    public var client: DeclaredClient
    public var source: Source
}

/// What one category's rows hold: option ids, empty for none.
public struct DeclaredClientSlots: Hashable, Sendable {
    public var client: String
    public var mobile: String
    public var desktop: String
    public var split: Bool

    public init(client: String = "", mobile: String = "", desktop: String = "", split: Bool = false) {
        self.client = client
        self.mobile = mobile
        self.desktop = desktop
        self.split = split
    }
}

/// The Clients screen's draft: ClientsTab.tsx's `buildOptions`, `seedDraft`,
/// `draftToPreferences` and `samePreferences`.
public struct PreferredClientsDraft: Hashable, Sendable {
    public var slots: [RedirectCompatFamily: DeclaredClientSlots]

    public init(slots: [RedirectCompatFamily: DeclaredClientSlots] = [:]) {
        self.slots = slots
    }

    /// Every catalog client in the family, the user's custom waypoints that
    /// opted into it, and any client the published record names that is
    /// neither, so publishing never silently swaps out what another app
    /// wrote. Record options are keyed by content, not slot.
    public static func options(customWaypoints: [CustomWaypoint], published: PreferredClientsRecord?) -> [RedirectCompatFamily: [DeclaredClientOption]] {
        var out: [RedirectCompatFamily: [DeclaredClientOption]] = [:]
        for category in PreferredClients.categories {
            var options: [DeclaredClientOption] = []
            for id in WaypointCatalog.order {
                guard WaypointCatalog.all[id]?.redirectCompat.contains(category) == true,
                      let client = declaredClient(fromWaypoint: id)
                else { continue }
                options.append(DeclaredClientOption(id: "waypoint:\(id)", label: client.name ?? id, client: client, source: .catalog))
            }
            for custom in customWaypoints where custom.redirectCompat?.contains(category) == true {
                guard let client = declaredClient(fromCustom: custom) else { continue }
                options.append(DeclaredClientOption(id: "custom:\(custom.id)", label: custom.name, client: client, source: .custom))
            }
            let entry = published?.preferences.first { $0.category == category.rawValue }
            for client in [entry?.client, entry?.mobile, entry?.desktop].compactMap({ $0 }) where match(client, in: options) == nil {
                options.append(DeclaredClientOption(id: "record:\(client.jsonValue.compactString())", label: client.displayName, client: client, source: .record))
            }
            out[category] = options
        }
        return out
    }

    /// The draft a screen opens with: the published record, or with none,
    /// the Redirects favourites where a declaration can name them.
    public init(published: PreferredClientsRecord?, options: [RedirectCompatFamily: [DeclaredClientOption]], favorites: [RedirectCompatFamily: String]) {
        var slots: [RedirectCompatFamily: DeclaredClientSlots] = [:]
        for category in PreferredClients.categories {
            let choices = options[category] ?? []
            if let published {
                let entry = published.preferences.first { $0.category == category.rawValue }
                let key = { (client: DeclaredClient?) in client.flatMap { PreferredClientsDraft.match($0, in: choices)?.id } ?? "" }
                slots[category] = DeclaredClientSlots(
                    client: key(entry?.client),
                    mobile: key(entry?.mobile),
                    desktop: key(entry?.desktop),
                    split: entry?.mobile != nil || entry?.desktop != nil
                )
            } else if let favorite = favorites[category],
                      let seeded = choices.first(where: { $0.id == "waypoint:\(favorite)" || $0.id == "custom:\(favorite)" }) {
                slots[category] = DeclaredClientSlots(client: seeded.id)
            } else {
                slots[category] = DeclaredClientSlots()
            }
        }
        self.init(slots: slots)
    }

    /// The preferences to publish. Categories the screen doesn't offer are
    /// carried through from the published record untouched.
    public func preferences(options: [RedirectCompatFamily: [DeclaredClientOption]], published: PreferredClientsRecord?) -> [ClientPreference] {
        var out: [ClientPreference] = []
        for category in PreferredClients.categories {
            let row = slots[category] ?? DeclaredClientSlots()
            let pick = { (key: String) in options[category]?.first { $0.id == key }?.client }
            var entry = ClientPreference(category: category.rawValue, client: pick(row.client))
            if row.split {
                entry.mobile = pick(row.mobile)
                entry.desktop = pick(row.desktop)
            }
            if entry.hasAnyClient { out.append(entry) }
        }
        let shown = Set(PreferredClients.categories.map(\.rawValue))
        out.append(contentsOf: (published?.preferences ?? []).filter { !shown.contains($0.category) })
        return out
    }

    static func match(_ client: DeclaredClient, in options: [DeclaredClientOption]) -> DeclaredClientOption? {
        if let waypoint = client.waypoint,
           let byId = options.first(where: { $0.source == .catalog && $0.client.waypoint == waypoint }) {
            return byId
        }
        return options.first { $0.client == client }
    }

    /// Whether two preference lists declare the same thing, compared by
    /// category with the first entry winning, as readers do.
    public static func samePreferences(_ a: [ClientPreference], _ b: [ClientPreference]) -> Bool {
        func byCategory(_ list: [ClientPreference]) -> [String: ClientPreference] {
            var map: [String: ClientPreference] = [:]
            for entry in list where map[entry.category] == nil { map[entry.category] = entry }
            return map
        }
        return byCategory(a) == byCategory(b)
    }
}
