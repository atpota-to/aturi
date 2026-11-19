import Foundation

// Port of src/utils/atproto/backlinkRelations.ts: sorts a target's backlink
// sources into the relationships a reader recognises (followers, mentions,
// lists…) and the apps they come from. Pure, no network IO, so the
// backlinks panel and its tests share one copy.
//
// Constellation reports links as `collection` + record `path` pairs, and
// one relationship is usually spread over many of them: @bsky.app is
// followed through eight follow lexicons and mentioned through four
// `app.bsky.feed.post` paths alone. There are two sets of rules: one for a
// DID target (who follows, mentions or lists an account) and one for a
// record target (what likes, answers or quotes a record).
//
// The web writes the rules as regular expressions. They are spelled out
// with string tests here wherever the pattern is a plain prefix, suffix or
// word list, so each rule reads the same in both places; the one pattern
// that is not (a facet path ending in `.did`) stays a regex.

/// What one source expresses about an account. Declaration order is the
/// display order of the relationship tiles; `other` always comes last.
public enum BacklinkRelation: String, CaseIterable, Hashable, Sendable {
    case follow
    case mention
    case list
    case block
    case verify
    case endorse
    case embed
    case other
}

/// What one source expresses about a record. What was written in answer
/// comes first, since those links have something to read; the tallies
/// follow, then how the record is filed and found. `other` always comes
/// last.
public enum RecordBacklinkRelation: String, CaseIterable, Hashable, Sendable {
    case reply
    case thread
    case quote
    case repost
    case like
    case mention
    case item
    case subscribe
    case via
    case other
}

/// The app a collection belongs to, by the reversed-domain convention.
public struct BacklinkApp: Hashable, Sendable {
    /// Grouping key: the app's domain (`bsky.app`), or its namespace when
    /// the namespace is not a domain.
    public var key: String
    /// What the chip says: a known app's name, otherwise the domain.
    public var name: String
    /// The waypoint id whose mark the app wears, when it has one.
    public var waypoint: String?

    public init(key: String, name: String, waypoint: String? = nil) {
        self.key = key
        self.name = name
        self.waypoint = waypoint
    }
}

/// One app behind a relationship and how many of its links it holds.
public struct BacklinkAppCount: Hashable, Sendable {
    public var app: BacklinkApp
    public var count: Int

    public init(app: BacklinkApp, count: Int) {
        self.app = app
        self.count = count
    }
}

/// The sources of one relationship, summed. `RelationBucket` on the web.
public struct BacklinkBucket<Relation: Hashable & Sendable>: Hashable, Sendable {
    public var relation: Relation
    /// Links across every source in the bucket.
    public var count: Int
    /// Distinct linking accounts, summed per source. An account that links
    /// through two sources (follows on two apps) counts twice; Constellation
    /// does not report distinct accounts across sources.
    public var accounts: Int
    /// Most links first, the order Constellation's counts give.
    public var sources: [BacklinkSource]
    /// Apps behind the bucket, most links first.
    public var apps: [BacklinkAppCount]

    public init(relation: Relation, count: Int = 0, accounts: Int = 0, sources: [BacklinkSource] = [], apps: [BacklinkAppCount] = []) {
        self.relation = relation
        self.count = count
        self.accounts = accounts
        self.sources = sources
        self.apps = apps
    }
}

public enum BacklinkRelations {
    // MARK: Account rules

    /// Richtext facets point at a DID only to mention it. Most lexicons name
    /// the feature (`#mention`, `#didMention`); some records omit the type
    /// and leave `.facets[].features[].did`, which is still a mention. The
    /// web's `MENTION_PATH` is this regex or the word "mention" anywhere.
    private static let untypedFacetDidPattern = #/facets\[[^\]]*\]\.features\[[^\]]*\]\.did$/#.ignoresCase()

    /// Array fields that make a record a roster of accounts (`ROSTER_PATH`).
    private static let rosterSuffixes = [".users[]", ".members[]", ".streamers[]"]

    /// `ENDORSE_WORDS`, matched case-insensitively anywhere in
    /// collection + path.
    private static let endorseWords = ["endorse", "vouch", "trust", "friends", "top8", "shoutout", "contact", "partners", "vote"]

    /// `MENTION_PATH`: the word anywhere, or an untyped facet DID.
    private static func isMentionPath(_ path: String) -> Bool {
        path.lowercased().contains("mention") || path.firstMatch(of: untypedFacetDidPattern) != nil
    }

    /// `EMBED_PATH`: paths that hold a denormalised copy of someone's
    /// details rather than a deliberate link: a starter pack embedding a
    /// feed view (`.feeds[].creator`), a reply carrying its parent's author,
    /// label and verification views. They are checked before the follow /
    /// block / verification rules, so a starter pack quoting a verification
    /// is a copy, not a verification.
    private static func isEmbedPath(_ path: String) -> Bool {
        path.contains(".creator.")
            || path.contains(".author.")
            || path.contains("labels[]")
            || path.contains("verifications[]")
            || path.hasPrefix(".reply.")
            || path.hasPrefix(".embed.")
    }

    /// The last segment of an NSID, as `split('.').pop() ?? ''` reads it.
    static func lastSegment(_ nsid: String) -> String {
        nsid.components(separatedBy: ".").last ?? ""
    }

    /// The relationship one source expresses towards an account. First
    /// matching rule wins; anything unrecognised is `other`, so a new
    /// lexicon is always listed somewhere.
    public static func relationOf(_ collection: String, _ path: String) -> BacklinkRelation {
        let name = lastSegment(collection).lowercased()
        let both = (collection + path).lowercased()
        if isMentionPath(path) { return .mention }
        if isEmbedPath(path) { return .embed }
        if name.hasSuffix("follow"), [".subject", ".did", ".subjectDid"].contains(path) { return .follow }
        if name.hasSuffix("block") { return .block }
        if both.contains("verif") || both.contains("certif") { return .verify }
        if lastSegment(collection) == "listitem" || rosterSuffixes.contains(where: { path.hasSuffix($0) }) { return .list }
        if endorseWords.contains(where: { both.contains($0) }) { return .endorse }
        return .other
    }

    // MARK: Record rules

    /// Lexicons that are a tally on a subject, by the collection's last
    /// segment, lowercased (`LIKE_NAME`, `REPOST_NAME`, `COMMENT_NAME`).
    private static let likeNames: Set<String> = ["like", "favorite", "favourite", "star", "vote", "upvote", "reaction", "recommend"]
    private static let repostNames: Set<String> = ["repost", "reshare", "boost"]
    private static let commentNames: Set<String> = ["comment", "reply"]

    /// Fields that file a record under another without being named for its
    /// type: a `site.standard.document` belongs to its publication through
    /// `.site`. Keyed by the target collection's last segment.
    private static let ownerFieldAliases: [String: [String]] = [
        "publication": ["site"],
    ]

    /// `path` is `prefix` exactly or `prefix` followed by a dot: the web's
    /// `(\.|$)` after a field name.
    private static func isField(_ path: String, _ prefix: String) -> Bool {
        path == prefix || path.hasPrefix(prefix + ".")
    }

    /// `VIA_PATH`, `(^|\.)(via|joinedVia[A-Za-z]*)(\.|$)`: some dotted
    /// segment is `via`, or `joinedVia` and letters (`.via.uri` on a
    /// follow, `.joinedViaStarterPack.uri` on a profile).
    private static func isViaPath(_ path: String) -> Bool {
        for segment in path.components(separatedBy: ".") {
            if segment == "via" { return true }
            if segment.hasPrefix("joinedVia"), segment.dropFirst("joinedVia".count).allSatisfy(isAsciiLetter) {
                return true
            }
        }
        return false
    }

    /// A record files itself under another through one top-level field
    /// named for what it belongs to: a list item's `.list`, a document's
    /// `.publication`, an issue's `.repo`. So the field (`^\.([A-Za-z]+)
    /// (\.uri)?$`) is compared with the target's own type.
    private static func isOwnerField(_ path: String, targetCollection: String?) -> Bool {
        guard path.hasPrefix(".") else { return false }
        var body = String(path.dropFirst())
        if body.hasSuffix(".uri") {
            body = String(body.dropLast(".uri".count))
        }
        guard !body.isEmpty, body.allSatisfy(isAsciiLetter) else { return false }
        let field = body.lowercased()
        guard let targetCollection else { return false }
        let type = lastSegment(targetCollection).lowercased()
        guard !type.isEmpty else { return false }
        return field == type || (ownerFieldAliases[type] ?? []).contains(field)
    }

    /// The relationship one source expresses towards a record.
    /// `targetCollection` is the record's own collection, which the "item"
    /// rule needs. First matching rule wins, and anything unrecognised is
    /// `other`.
    ///
    /// A reply links its parent and the thread's root. On a root post those
    /// are the same record, so the two paths are kept apart rather than
    /// merged: "reply" is what answers the record directly, "thread"
    /// everything under it.
    public static func recordRelationOf(_ collection: String, _ path: String, targetCollection: String? = nil) -> RecordBacklinkRelation {
        let name = lastSegment(collection).lowercased()
        // `FACET_PATH`: any richtext facet names a record only to link it.
        if path.lowercased().contains("facets[") || isMentionPath(path) { return .mention }
        if isField(path, ".reply.root") { return .thread }
        if isField(path, ".reply.parent") || commentNames.contains(name) { return .reply }
        if likeNames.contains(name) { return .like }
        if repostNames.contains(name) { return .repost }
        if path.hasPrefix(".embed.") { return .quote }
        if isViaPath(path) { return .via }
        if name.contains("subscri") { return .subscribe }
        if lastSegment(collection) == "listitem" || isOwnerField(path, targetCollection: targetCollection) { return .item }
        return .other
    }

    // MARK: Apps

    /// Namespaces whose app has a mark in the waypoint catalogue, keyed by
    /// the NSID's first two segments. Only namespaces that app owns are
    /// listed: `site.standard` documents are written by several publishing
    /// apps, so they fall through to their domain.
    private static let namespaceWaypoints: [String: (name: String, waypoint: String)] = [
        "app.bsky": ("Bluesky", "bluesky"),
        "sh.tangled": ("Tangled", "tangled"),
        "place.stream": ("Streamplace", "streamplace"),
        "pub.leaflet": ("Leaflet", "leaflet"),
        "app.blento": ("Blento", "blento"),
        "id.sifa": ("Sifa", "sifa"),
        "blog.pckt": ("pckt", "pckt"),
        "app.offprint": ("Offprint", "offprint"),
        "app.witchsky": ("Witchsky", "witchsky"),
        "at.margin": ("Margin", "margin"),
        "social.grain": ("Grain", "grain"),
        "social.popfeed": ("Popfeed", "popfeed"),
    ]

    /// The app a collection belongs to, by the reversed-domain convention.
    public static func appForCollection(_ collection: String) -> BacklinkApp {
        let namespace = NSID.namespaceKey(collection)
        let known = namespaceWaypoints[namespace]
        let key = NSID.appDomainFor(NSID.groupPrefix(collection)) ?? namespace
        return BacklinkApp(key: key, name: known?.name ?? key, waypoint: known?.waypoint)
    }

    // MARK: Path labels

    /// A record path with the NSIDs inside its type qualifiers shortened:
    /// `[app.bsky.richtext.facet#mention]` -> `[#mention]`,
    /// `[pub.leaflet.pages.linearDocument]` -> `[linearDocument]`. With
    /// `keepAuthority` the namespace stays (`[com.atproto…#mention]`), for
    /// telling apart two paths that would otherwise read the same.
    ///
    /// The web replaces `\[([A-Za-z0-9.-]+)(#[A-Za-z0-9]+)?\]`; the scan
    /// below accepts exactly that: a run of NSID characters, an optional
    /// `#fragment` of letters and digits, then the closing bracket. Any
    /// other bracket is copied as it stands.
    public static func shortBacklinkPath(_ path: String, keepAuthority: Bool = false) -> String {
        if path == "." { return "(record root)" }
        let chars = Array(path)
        var out = ""
        var index = 0
        while index < chars.count {
            if chars[index] == "[", let qualifier = typeQualifier(in: chars, from: index + 1) {
                let last = qualifier.fragment ?? (qualifier.nsid.components(separatedBy: ".").last ?? qualifier.nsid)
                if keepAuthority {
                    out += "[\(NSID.namespaceKey(qualifier.nsid))\u{2026}\(last)]"
                } else {
                    out += "[\(last)]"
                }
                index = qualifier.end + 1
            } else {
                out.append(chars[index])
                index += 1
            }
        }
        return out
    }

    private struct TypeQualifier {
        var nsid: String
        /// `#fragment`, hash included, as the web's capture holds it.
        var fragment: String?
        /// Index of the closing bracket.
        var end: Int
    }

    /// The `nsid#fragment]` that follows an opening bracket at `start`, or
    /// nil when the bracket does not hold one.
    private static func typeQualifier(in chars: [Character], from start: Int) -> TypeQualifier? {
        var index = start
        while index < chars.count, isAsciiAlphanumeric(chars[index]) || chars[index] == "." || chars[index] == "-" {
            index += 1
        }
        guard index > start, index < chars.count else { return nil }
        let nsid = String(chars[start..<index])
        if chars[index] == "]" {
            return TypeQualifier(nsid: nsid, fragment: nil, end: index)
        }
        guard chars[index] == "#" else { return nil }
        let hash = index
        index += 1
        while index < chars.count, isAsciiAlphanumeric(chars[index]) {
            index += 1
        }
        guard index > hash + 1, index < chars.count, chars[index] == "]" else { return nil }
        return TypeQualifier(nsid: nsid, fragment: String(chars[hash..<index]), end: index)
    }

    /// Short labels for every path of one collection, falling back to the
    /// namespaced form where two would collide: `app.bsky.feed.post`
    /// mentions by `app.bsky.richtext.facet#mention` and by
    /// `com.atproto.richtext.facet#mention` both shorten to `[#mention]`.
    public static func backlinkPathLabels(_ paths: [String]) -> [String: String] {
        var seen: [String: Int] = [:]
        for path in paths {
            seen[shortBacklinkPath(path), default: 0] += 1
        }
        var labels: [String: String] = [:]
        for path in paths {
            let short = shortBacklinkPath(path)
            labels[path] = (seen[short] ?? 0) > 1 ? shortBacklinkPath(path, keepAuthority: true) : short
        }
        return labels
    }

    // MARK: Buckets

    /// An account's sources by relationship, in `BacklinkRelation` order.
    public static func bucketSources(_ sources: [BacklinkSource]) -> [BacklinkBucket<BacklinkRelation>] {
        bucket(sources, order: BacklinkRelation.allCases) { source in
            relationOf(source.collection, source.path)
        }
    }

    /// A record's sources by relationship, in `RecordBacklinkRelation`
    /// order. `targetCollection` is the collection of the record they point
    /// at.
    public static func bucketRecordSources(_ sources: [BacklinkSource], targetCollection: String) -> [BacklinkBucket<RecordBacklinkRelation>] {
        bucket(sources, order: RecordBacklinkRelation.allCases) { source in
            recordRelationOf(source.collection, source.path, targetCollection: targetCollection)
        }
    }

    /// Group sources by the relationship `classify` gives each, in `order`,
    /// dropping empty buckets. Sources keep their relative order, and apps
    /// with the same count keep the order they were first seen in, as the
    /// web's stable sort over a `Map` leaves them.
    private static func bucket<Relation: Hashable & Sendable>(
        _ sources: [BacklinkSource],
        order: [Relation],
        classify: (BacklinkSource) -> Relation
    ) -> [BacklinkBucket<Relation>] {
        var buckets: [Relation: BacklinkBucket<Relation>] = [:]
        var appCounts: [Relation: [String: BacklinkAppCount]] = [:]
        var appKeys: [Relation: [String]] = [:]
        for source in sources {
            let relation = classify(source)
            var bucket = buckets[relation] ?? BacklinkBucket(relation: relation)
            bucket.count += source.count
            bucket.accounts += source.distinctDids ?? 0
            bucket.sources.append(source)
            buckets[relation] = bucket

            let app = appForCollection(source.collection)
            var counts = appCounts[relation] ?? [:]
            if var entry = counts[app.key] {
                entry.count += source.count
                counts[app.key] = entry
            } else {
                counts[app.key] = BacklinkAppCount(app: app, count: source.count)
                appKeys[relation, default: []].append(app.key)
            }
            appCounts[relation] = counts
        }

        var out: [BacklinkBucket<Relation>] = []
        for relation in order {
            guard var bucket = buckets[relation] else { continue }
            let counts = appCounts[relation] ?? [:]
            let seen = (appKeys[relation] ?? []).compactMap { counts[$0] }
            let ranked = seen.enumerated().sorted { lhs, rhs in
                if lhs.element.count != rhs.element.count { return lhs.element.count > rhs.element.count }
                return lhs.offset < rhs.offset
            }
            bucket.apps = ranked.map { $0.element }
            out.append(bucket)
        }
        return out
    }

    // MARK: Character classes

    private static func isAsciiLetter(_ character: Character) -> Bool {
        guard let value = character.asciiValue else { return false }
        return (value >= 65 && value <= 90) || (value >= 97 && value <= 122)
    }

    private static func isAsciiAlphanumeric(_ character: Character) -> Bool {
        guard let value = character.asciiValue else { return false }
        return (value >= 48 && value <= 57) || isAsciiLetter(character)
    }
}
