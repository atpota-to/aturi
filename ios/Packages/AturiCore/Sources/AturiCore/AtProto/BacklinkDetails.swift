import Foundation

// Port of src/utils/atproto/backlinkDetails.ts: what a backlink row says
// about its linking record, namely who wrote it and a line of context (a
// post's text, the list an account was added to, a starter pack's or
// document's title). Constellation returns coordinates only, so each comes
// from a second source:
//
//   profiles  app.bsky.actor.getProfiles, 25 accounts per request
//   posts     app.bsky.feed.getPosts, 25 posts per request
//   others    Slingshot, one cached request per record (concurrency-limited),
//             and a second hop for a list item's list
//
// The pure parts and the fetches live here; `BacklinkDetailsStore` keeps
// the results for the panel, as the web's module-level caches do.

/// The slice of an AppView profile a row shows.
public struct LinkerProfile: Hashable, Sendable {
    public var did: String
    public var handle: String
    public var displayName: String?
    public var avatar: String?

    public init(did: String, handle: String, displayName: String? = nil, avatar: String? = nil) {
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
    }
}

/// The account a list item adds and the list it adds them to.
public struct ListMember: Hashable, Sendable {
    public var did: String
    public var list: String

    public init(did: String, list: String) {
        self.did = did
        self.list = list
    }
}

/// A row's line of context. `kind` is a short label for the record type;
/// `text` the record's words. `member` is set on a list item: seen from
/// that list, the account it adds is what the row is about.
public struct RecordContext: Hashable, Sendable {
    public var kind: String?
    public var text: String
    public var member: ListMember?

    public init(kind: String? = nil, text: String, member: ListMember? = nil) {
        self.kind = kind
        self.text = text
        self.member = member
    }
}

public enum BacklinkDetails {
    /// Record types named in a row's context, by the collection's last segment.
    static let kindByName: [String: String] = [
        "starterpack": "Starter pack",
        "document": "Document",
        "list": "List",
        "verification": "Verification",
        "generator": "Feed",
        "event": "Event",
        "profile": "Profile",
    ]

    /// Fields that read as a record's title or body, in the order tried.
    static let textFields = ["title", "name", "displayName", "text", "description"]

    /// The longest context line, in characters, ellipsis included.
    public static let maxContext = 300

    public static let postCollection = "app.bsky.feed.post"
    public static let listItemCollection = "app.bsky.graph.listitem"

    /// Whitespace runs collapsed to one space and the ends trimmed, cut to
    /// `maxContext` with an ellipsis. Counted in characters rather than the
    /// web's UTF-16 units, so a cut never splits an emoji.
    static func clean(_ text: String) -> String {
        let flat = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard flat.count > maxContext else { return flat }
        return String(flat.prefix(maxContext - 1)) + "\u{2026}"
    }

    /// A row's context for a record value, or nil when the record has
    /// nothing a reader would recognise. Follows, blocks, likes and reposts
    /// never get here (their records are a subject and a date).
    public static func describeLinkingRecord(_ collection: String, value: JSONValue?) -> RecordContext? {
        guard let object = value?.objectValue else { return nil }
        for field in textFields {
            guard let text = object[field]?.stringValue,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { continue }
            let name = BacklinkRelations.lastSegment(collection)
            return RecordContext(kind: kindByName[name], text: clean(text))
        }
        return nil
    }

    /// How a list item's list is named in a row. Bluesky makes reference
    /// lists only to back starter packs, so that purpose reads as one.
    public static func listKind(_ purpose: String?) -> String {
        let value = purpose?.components(separatedBy: "#").last ?? ""
        if value == "modlist" { return "Moderation list" }
        if value == "referencelist" { return "Starter pack list" }
        return "List"
    }

    /// The account a list item adds and the list it adds them to, or nil
    /// for a record that is not a well-formed list item.
    public static func listItemMember(_ value: JSONValue?) -> ListMember? {
        guard let subject = value?["subject"]?.stringValue, subject.hasPrefix("did:"),
              let list = value?["list"]?.stringValue, list.hasPrefix("at://")
        else { return nil }
        return ListMember(did: subject, list: list)
    }

    /// Collections whose records carry no words worth fetching: each is a
    /// subject and a date. Likes and reposts are here with follows and
    /// blocks because a record's backlinks are mostly those, a page of them
    /// at a time.
    public static func hasNoContext(_ collection: String) -> Bool {
        let name = BacklinkRelations.lastSegment(collection).lowercased()
        return ["follow", "block", "like", "repost"].contains { name.hasSuffix($0) }
    }

    // MARK: Fetches

    /// What one round of profile lookups learned.
    struct ProfileLookup: Sendable {
        var found: [String: LinkerProfile] = [:]
        /// DIDs the AppView answered for and does not know.
        var missing: Set<String> = []
    }

    /// What one round of context lookups learned.
    struct ContextLookup: Sendable {
        var found: [String: RecordContext] = [:]
        /// URIs settled either way: with a context in `found`, or with none.
        /// A URI in neither is left unknown so a later round tries again.
        var settled: Set<String> = []
        /// Accounts list items add, whose profiles the rows then want.
        var memberDids: [String] = []
    }

    /// Profiles for `dids`, `getProfiles` 25 at a time. An account the
    /// AppView answered for but does not know is `missing`; when any chunk
    /// failed, nothing is marked missing, so a later call tries again.
    static func fetchProfiles(_ dids: [String], appView: AppViewClient) async -> ProfileLookup {
        guard !dids.isEmpty else { return ProfileLookup() }
        let result = await appView.getProfilesResult(dids)
        var lookup = ProfileLookup()
        for did in dids {
            if let profile = result.profiles[did] {
                lookup.found[did] = LinkerProfile(did: did, handle: profile.handle, displayName: profile.displayName, avatar: profile.avatar)
            } else if !result.failed {
                lookup.missing.insert(did)
            }
        }
        return lookup
    }

    /// Post texts, `getPosts` 25 at a time. A chunk that failed is left
    /// unknown; a post the AppView answered without (deleted, or empty
    /// text) settles with no context.
    static func fetchPostContexts(_ uris: [String], appView: AppViewClient) async -> ContextLookup {
        guard !uris.isEmpty else { return ContextLookup() }
        let size = AppViewClient.profilesChunkSize
        let chunks = stride(from: 0, to: uris.count, by: size).map { Array(uris[$0..<min($0 + size, uris.count)]) }
        var lookup = ContextLookup()
        await withTaskGroup(of: (chunk: [String], posts: [BskyPost]?).self) { group in
            for chunk in chunks {
                group.addTask {
                    let posts = await appView.getPosts(chunk)
                    return (chunk, posts)
                }
            }
            for await outcome in group {
                guard let posts = outcome.posts else { continue }
                var textByUri: [String: String] = [:]
                for post in posts {
                    textByUri[post.uri] = post.record.text
                }
                for uri in outcome.chunk {
                    lookup.settled.insert(uri)
                    if let text = textByUri[uri], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        lookup.found[uri] = RecordContext(text: clean(text))
                    }
                }
            }
        }
        return lookup
    }

    /// Contexts for records that are not posts, through Slingshot. A list
    /// item names an account and a list; the list's name is the context,
    /// and the account is kept beside it for a row seen from the list
    /// itself. Records Slingshot could not find settle without context
    /// rather than being retried.
    static func fetchRecordContexts(_ records: [BacklinkRecord], slingshot: SlingshotClient) async -> ContextLookup {
        guard !records.isEmpty else { return ContextLookup() }
        let fetched = await slingshot.getRecordsByUris(records.map(\.atUri))
        var lookup = ContextLookup()
        var listUris: [String: String] = [:]
        var members: [String: ListMember] = [:]
        for record in records {
            let uri = record.atUri
            guard let value = fetched[uri]?.value else { continue }
            if record.collection == listItemCollection, let list = value["list"]?.stringValue {
                listUris[uri] = list
                if let member = listItemMember(value) {
                    members[uri] = member
                }
            } else if let context = describeLinkingRecord(record.collection, value: value) {
                lookup.found[uri] = context
            }
        }
        if !listUris.isEmpty {
            let lists = await slingshot.getRecordsByUris(Array(Set(listUris.values)).sorted())
            for (uri, listUri) in listUris {
                let list = lists[listUri]?.value
                let name = list?["name"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard !name.isEmpty else { continue }
                lookup.found[uri] = RecordContext(kind: listKind(list?["purpose"]?.stringValue), text: clean(name), member: members[uri])
            }
            lookup.memberDids = members.values.map(\.did).sorted()
        }
        for record in records {
            lookup.settled.insert(record.atUri)
        }
        return lookup
    }
}
