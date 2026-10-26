import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Page types

/// A post and, when it is a reply, the post it answers. Port of
/// recordFetcher's `PostThread`, flattened: the web wrapped the anchor in a
/// one-element `thread` array for a legacy renderer.
public struct PostThread: Hashable, Sendable {
    public var post: BskyPost
    public var parent: BskyPost?
    /// The whole getPostThread response, for the replies and the parent
    /// chain beyond what is typed here.
    public var raw: JSONValue

    public init(post: BskyPost, parent: BskyPost? = nil, raw: JSONValue = .object([:])) {
        self.post = post
        self.parent = parent
        self.raw = raw
    }

    /// Nil unless `thread.post` decodes; a `#notFoundPost` or
    /// `#blockedPost` anchor has no `post` and yields nil, as on the web.
    public init?(json: JSONValue?) {
        guard let json = json, let post = BskyPost(json: json["thread"]?["post"]) else { return nil }
        self.init(post: post, parent: BskyPost(json: json["thread"]?["parent"]?["post"]), raw: json)
    }
}

/// Lightweight actor record from searchActorsTypeahead. Port of
/// `ActorTypeaheadResult`.
public struct ActorTypeaheadResult: Hashable, Sendable {
    public var did: String
    public var handle: String
    public var displayName: String?
    public var avatar: String?
    public var description: String?

    public init(did: String, handle: String, displayName: String? = nil, avatar: String? = nil, description: String? = nil) {
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
        self.description = description
    }

    public init?(json: JSONValue?) {
        guard let did = json?["did"]?.stringValue, !did.isEmpty else { return nil }
        self.init(
            did: did,
            handle: json?["handle"]?.stringValue ?? "",
            displayName: json?["displayName"]?.stringValue,
            avatar: json?["avatar"]?.stringValue,
            description: json?["description"]?.stringValue
        )
    }
}

/// Why a post is in a feed when it is not the author's own: a repost (`by`
/// is the reposter) or a pin.
public struct BskyFeedReason: Hashable, Sendable {
    public static let repostType = "app.bsky.feed.defs#reasonRepost"
    public static let pinType = "app.bsky.feed.defs#reasonPin"

    public var type: String
    public var by: BskyPostAuthor?

    public init(type: String, by: BskyPostAuthor? = nil) {
        self.type = type
        self.by = by
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(type: json["$type"]?.stringValue ?? "", by: BskyPostAuthor(json: json["by"]))
    }

    public var isRepost: Bool { type == BskyFeedReason.repostType }
    public var isPin: Bool { type == BskyFeedReason.pinType }
}

/// One `feedViewPost`: a post, optionally reposted or a reply. Port of
/// `AuthorFeedItem`; getFeed and getListFeed return the same shape.
public struct BskyFeedItem: Hashable, Sendable {
    public var post: BskyPost
    public var reason: BskyFeedReason?
    /// The `reply` block was present (root and parent context).
    public var isReply: Bool
    public var feedContext: String?
    public var raw: JSONValue

    public init(post: BskyPost, reason: BskyFeedReason? = nil, isReply: Bool = false, feedContext: String? = nil, raw: JSONValue = .object([:])) {
        self.post = post
        self.reason = reason
        self.isReply = isReply
        self.feedContext = feedContext
        self.raw = raw
    }

    public init?(json: JSONValue?) {
        guard let json = json, let post = BskyPost(json: json["post"]) else { return nil }
        self.init(
            post: post,
            reason: BskyFeedReason(json: json["reason"]),
            isReply: json["reply"]?.objectValue != nil,
            feedContext: json["feedContext"]?.stringValue,
            raw: json
        )
    }
}

/// One page of a feed. Port of `AuthorFeedPage` and `FeedSkeletonPage`.
public struct BskyFeedPage: Hashable, Sendable {
    public var items: [BskyFeedItem]
    public var cursor: String?

    public init(items: [BskyFeedItem], cursor: String? = nil) {
        self.items = items
        self.cursor = cursor
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            items: json["feed"]?.arrayValue?.compactMap { BskyFeedItem(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// One page of searchPosts. Port of `SearchPostsPage`.
public struct SearchPostsPage: Hashable, Sendable {
    public var posts: [BskyPost]
    public var cursor: String?
    public var hitsTotal: Int?

    public init(posts: [BskyPost], cursor: String? = nil, hitsTotal: Int? = nil) {
        self.posts = posts
        self.cursor = cursor
        self.hitsTotal = hitsTotal
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            posts: json["posts"]?.arrayValue?.compactMap { BskyPost(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue,
            hitsTotal: json["hitsTotal"]?.intValue
        )
    }
}

/// One page of searchActors. Port of `SearchActorsPage`.
public struct SearchActorsPage: Hashable, Sendable {
    public var actors: [BskyProfile]
    public var cursor: String?

    public init(actors: [BskyProfile], cursor: String? = nil) {
        self.actors = actors
        self.cursor = cursor
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            actors: json["actors"]?.arrayValue?.compactMap { BskyProfile(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// A trending topic. `link` is an app-relative feed path. Port of `TrendView`.
public struct TrendView: Hashable, Sendable {
    public var topic: String
    public var displayName: String?
    public var description: String?
    public var link: String?
    public var startedAt: String?
    public var postCount: Int?
    public var status: String?
    public var category: String?
    public var actors: [BskyProfile]

    public init(
        topic: String,
        displayName: String? = nil,
        description: String? = nil,
        link: String? = nil,
        startedAt: String? = nil,
        postCount: Int? = nil,
        status: String? = nil,
        category: String? = nil,
        actors: [BskyProfile] = []
    ) {
        self.topic = topic
        self.displayName = displayName
        self.description = description
        self.link = link
        self.startedAt = startedAt
        self.postCount = postCount
        self.status = status
        self.category = category
        self.actors = actors
    }

    public init?(json: JSONValue?) {
        guard let json = json, let topic = json["topic"]?.stringValue else { return nil }
        self.init(
            topic: topic,
            displayName: json["displayName"]?.stringValue,
            description: json["description"]?.stringValue,
            link: json["link"]?.stringValue,
            startedAt: json["startedAt"]?.stringValue,
            postCount: json["postCount"]?.intValue,
            status: json["status"]?.stringValue,
            category: json["category"]?.stringValue,
            actors: json["actors"]?.arrayValue?.compactMap { BskyProfile(json: $0) } ?? []
        )
    }
}

public enum SocialGraphDirection: String, Hashable, Sendable, CaseIterable {
    case follows
    case followers
}

/// One page of getFollows / getFollowers. Port of `GraphPage`; the web
/// keys the array by direction, here `actors` is that array and
/// `direction` says which one it was.
public struct SocialGraphPage: Hashable, Sendable {
    public var direction: SocialGraphDirection
    public var subject: BskyProfile?
    public var actors: [BskyProfile]
    public var cursor: String?

    public init(direction: SocialGraphDirection, subject: BskyProfile? = nil, actors: [BskyProfile], cursor: String? = nil) {
        self.direction = direction
        self.subject = subject
        self.actors = actors
        self.cursor = cursor
    }

    public init?(json: JSONValue?, direction: SocialGraphDirection) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            direction: direction,
            subject: BskyProfile(json: json["subject"]),
            actors: json[direction.rawValue]?.arrayValue?.compactMap { BskyProfile(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

public enum PostEngagementKind: String, Hashable, Sendable, CaseIterable {
    case likes
    case reposts
    case quotes

    /// The `app.bsky.feed.*` method behind each kind.
    public var method: String {
        switch self {
        case .likes: return "getLikes"
        case .reposts: return "getRepostedBy"
        case .quotes: return "getQuotes"
        }
    }
}

/// One like as getLikes lists it.
public struct PostLikeEntry: Hashable, Sendable {
    public var actor: BskyProfile
    public var createdAt: String?
    public var indexedAt: String?

    public init(actor: BskyProfile, createdAt: String? = nil, indexedAt: String? = nil) {
        self.actor = actor
        self.createdAt = createdAt
        self.indexedAt = indexedAt
    }

    public init?(json: JSONValue?) {
        guard let actor = BskyProfile(json: json?["actor"]) else { return nil }
        self.init(actor: actor, createdAt: json?["createdAt"]?.stringValue, indexedAt: json?["indexedAt"]?.stringValue)
    }
}

/// One page of getLikes / getRepostedBy / getQuotes. Port of
/// `PostEngagementPage`; `kind` says which of the three arrays is populated.
public struct PostEngagementPage: Hashable, Sendable {
    public var kind: PostEngagementKind
    public var uri: String?
    public var likes: [PostLikeEntry]
    public var repostedBy: [BskyProfile]
    public var posts: [BskyPost]
    public var cursor: String?

    public init(
        kind: PostEngagementKind,
        uri: String? = nil,
        likes: [PostLikeEntry] = [],
        repostedBy: [BskyProfile] = [],
        posts: [BskyPost] = [],
        cursor: String? = nil
    ) {
        self.kind = kind
        self.uri = uri
        self.likes = likes
        self.repostedBy = repostedBy
        self.posts = posts
        self.cursor = cursor
    }

    public init?(json: JSONValue?, kind: PostEngagementKind) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            kind: kind,
            uri: json["uri"]?.stringValue,
            likes: json["likes"]?.arrayValue?.compactMap { PostLikeEntry(json: $0) } ?? [],
            repostedBy: json["repostedBy"]?.arrayValue?.compactMap { BskyProfile(json: $0) } ?? [],
            posts: json["posts"]?.arrayValue?.compactMap { BskyPost(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// A custom feed generator's public view. Port of `FeedGeneratorView`.
public struct FeedGeneratorView: Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var did: String
    public var creator: BskyProfile?
    public var displayName: String?
    public var description: String?
    public var avatar: String?
    public var likeCount: Int?
    public var indexedAt: String?
    public var raw: JSONValue

    public init(
        uri: String,
        cid: String,
        did: String,
        creator: BskyProfile? = nil,
        displayName: String? = nil,
        description: String? = nil,
        avatar: String? = nil,
        likeCount: Int? = nil,
        indexedAt: String? = nil,
        raw: JSONValue = .object([:])
    ) {
        self.uri = uri
        self.cid = cid
        self.did = did
        self.creator = creator
        self.displayName = displayName
        self.description = description
        self.avatar = avatar
        self.likeCount = likeCount
        self.indexedAt = indexedAt
        self.raw = raw
    }

    public init?(json: JSONValue?) {
        guard let json = json, let uri = json["uri"]?.stringValue, !uri.isEmpty else { return nil }
        self.init(
            uri: uri,
            cid: json["cid"]?.stringValue ?? "",
            did: json["did"]?.stringValue ?? "",
            creator: BskyProfile(json: json["creator"]),
            displayName: json["displayName"]?.stringValue,
            description: json["description"]?.stringValue,
            avatar: json["avatar"]?.stringValue,
            likeCount: json["likeCount"]?.intValue,
            indexedAt: json["indexedAt"]?.stringValue,
            raw: json
        )
    }
}

/// One page of feed generators. Port of `FeedGeneratorsPage`.
public struct FeedGeneratorsPage: Hashable, Sendable {
    public var feeds: [FeedGeneratorView]
    public var cursor: String?

    public init(feeds: [FeedGeneratorView], cursor: String? = nil) {
        self.feeds = feeds
        self.cursor = cursor
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            feeds: json["feeds"]?.arrayValue?.compactMap { FeedGeneratorView(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// Which listing `listFeedGenerators` asks for: an actor's own feeds, the
/// network's most popular (optionally filtered by `query`), or Bluesky's
/// editorial suggestions.
public enum FeedGeneratorSource: Hashable, Sendable {
    case actor(String)
    case popular(query: String? = nil)
    case suggested
}

/// A curation or moderation list. `purpose` is the lexicon's list purpose.
/// Port of `ListView`.
public struct BskyListView: Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var name: String?
    public var purpose: String?
    public var description: String?
    public var avatar: String?
    public var listItemCount: Int?
    public var indexedAt: String?
    public var creator: BskyProfile?
    public var raw: JSONValue

    public init(
        uri: String,
        cid: String,
        name: String? = nil,
        purpose: String? = nil,
        description: String? = nil,
        avatar: String? = nil,
        listItemCount: Int? = nil,
        indexedAt: String? = nil,
        creator: BskyProfile? = nil,
        raw: JSONValue = .object([:])
    ) {
        self.uri = uri
        self.cid = cid
        self.name = name
        self.purpose = purpose
        self.description = description
        self.avatar = avatar
        self.listItemCount = listItemCount
        self.indexedAt = indexedAt
        self.creator = creator
        self.raw = raw
    }

    public init?(json: JSONValue?) {
        guard let json = json, let uri = json["uri"]?.stringValue, !uri.isEmpty else { return nil }
        self.init(
            uri: uri,
            cid: json["cid"]?.stringValue ?? "",
            name: json["name"]?.stringValue,
            purpose: json["purpose"]?.stringValue,
            description: json["description"]?.stringValue,
            avatar: json["avatar"]?.stringValue,
            listItemCount: json["listItemCount"]?.intValue,
            indexedAt: json["indexedAt"]?.stringValue,
            creator: BskyProfile(json: json["creator"]),
            raw: json
        )
    }
}

/// One member of a list: the listitem record's URI and the account.
public struct BskyListItem: Hashable, Sendable {
    public var uri: String
    public var subject: BskyProfile

    public init(uri: String, subject: BskyProfile) {
        self.uri = uri
        self.subject = subject
    }

    public init?(json: JSONValue?) {
        guard let uri = json?["uri"]?.stringValue, let subject = BskyProfile(json: json?["subject"]) else { return nil }
        self.init(uri: uri, subject: subject)
    }
}

/// One list's metadata plus a page of its members. Port of `ListPage`.
public struct BskyListPage: Hashable, Sendable {
    public var list: BskyListView?
    public var items: [BskyListItem]
    public var cursor: String?

    public init(list: BskyListView? = nil, items: [BskyListItem], cursor: String? = nil) {
        self.list = list
        self.items = items
        self.cursor = cursor
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            list: BskyListView(json: json["list"]),
            items: json["items"]?.arrayValue?.compactMap { BskyListItem(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// A page of the lists an actor created. Port of `ListsPage`.
public struct BskyListsPage: Hashable, Sendable {
    public var lists: [BskyListView]
    public var cursor: String?

    public init(lists: [BskyListView], cursor: String? = nil) {
        self.lists = lists
        self.cursor = cursor
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            lists: json["lists"]?.arrayValue?.compactMap { BskyListView(json: $0) } ?? [],
            cursor: json["cursor"]?.stringValue
        )
    }
}

/// getAuthorFeed's `filter` values.
public enum AuthorFeedFilter: String, Hashable, Sendable, CaseIterable {
    case postsWithReplies = "posts_with_replies"
    case postsNoReplies = "posts_no_replies"
    case postsWithMedia = "posts_with_media"
    case postsAndAuthorThreads = "posts_and_author_threads"
}

public enum SearchPostsSort: String, Hashable, Sendable, CaseIterable {
    case top
    case latest
}

// MARK: - Client

/// Bluesky AppView (`public.api.bsky.app`) client. Port of
/// `src/utils/atproto/appview.ts` plus `fetchPostThread` from
/// `recordFetcher.ts` and `fetchProfile` from `profileFetcher.ts`.
///
/// Every call is public and unauthenticated, and every call swallows
/// failure the way the web's `fetchJsonOrNull` does: a network error, a
/// non-2xx status and a malformed body all come back as nil (or an empty
/// list) so screens can render "nothing here" without a try/catch. Callers
/// that need to tell "unknown to the AppView" from "the AppView did not
/// answer" use `getProfilesResult`.
public struct AppViewClient: Sendable {
    /// Minimum query length before the sign-in box asks the AppView
    /// anything. Deliberately longer than the explorer's search box: the
    /// sign-in field is pre-authentication, and each request tells a third
    /// party which account is about to authenticate.
    public static let handleTypeaheadMinLength = 3

    /// `getProfiles` sends at most this many actors per request.
    public static let profilesChunkSize = 25

    public let client: HTTPClient
    public let baseURL: URL

    public init(client: HTTPClient = .shared, baseURL: URL = Endpoints.appView) {
        self.client = client
        self.baseURL = baseURL
    }

    // MARK: Actors

    /// `app.bsky.actor.getProfile`.
    public func getProfile(_ actor: String) async -> BskyProfile? {
        guard !actor.isEmpty else { return nil }
        let data = await appViewJSON("app.bsky.actor.getProfile", query: [("actor", actor)])
        return BskyProfile(json: data)
    }

    /// `app.bsky.actor.getProfiles`, keyed by DID. Actors the AppView has
    /// never indexed are simply absent; callers fall back to identity
    /// resolution rather than treat a miss as an error.
    public func getProfiles(_ actors: [String]) async -> [String: BskyProfile] {
        await getProfilesResult(actors).profiles
    }

    /// Failure-aware `getProfiles`: `failed` is true when any chunk did not
    /// answer, which an empty map alone cannot express.
    public func getProfilesResult(_ actors: [String]) async -> (profiles: [String: BskyProfile], failed: Bool) {
        var seen = Set<String>()
        var unique: [String] = []
        for actor in actors where !actor.isEmpty && seen.insert(actor).inserted {
            unique.append(actor)
        }
        let size = AppViewClient.profilesChunkSize
        let chunks = stride(from: 0, to: unique.count, by: size).map { Array(unique[$0..<min($0 + size, unique.count)]) }

        var profiles: [String: BskyProfile] = [:]
        var failed = false
        await withTaskGroup(of: (profiles: [BskyProfile], answered: Bool).self) { group in
            for chunk in chunks {
                group.addTask {
                    let data = await appViewJSON("app.bsky.actor.getProfiles", query: chunk.map { ("actors", $0) })
                    guard let data = data else { return ([], false) }
                    return (data["profiles"]?.arrayValue?.compactMap { BskyProfile(json: $0) } ?? [], true)
                }
            }
            for await outcome in group {
                if !outcome.answered { failed = true }
                for profile in outcome.profiles { profiles[profile.did] = profile }
            }
        }
        return (profiles, failed)
    }

    /// `app.bsky.actor.searchActorsTypeahead`: prefix suggestions for a
    /// handle or display name. Empty for an empty query, no matches, or any
    /// failure.
    public func searchActorsTypeahead(_ q: String, limit: Int = 8) async -> [ActorTypeaheadResult] {
        guard !q.isEmpty else { return [] }
        let data = await appViewJSON("app.bsky.actor.searchActorsTypeahead", query: [("q", q), ("limit", String(limit))])
        return data?["actors"]?.arrayValue?.compactMap { ActorTypeaheadResult(json: $0) } ?? []
    }

    /// Whether a sign-in input's current value is worth a typeahead lookup.
    ///
    /// The typeahead is handle and display-name oriented, so DIDs and
    /// `at://` URIs are skipped outright rather than sent and discarded, as
    /// is anything carrying a path separator or a space. Returning false
    /// only means "do not ask the AppView": every value stays submittable,
    /// because handles on a PDS the AppView does not index never appear in
    /// these results at all.
    public static func shouldQueryHandleTypeahead(_ input: String) -> Bool {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.utf16.count < handleTypeaheadMinLength { return false }
        if trimmed.hasPrefix("did:") || trimmed.hasPrefix("at://") { return false }
        if trimmed.contains("/") || trimmed.contains(" ") { return false }
        return true
    }

    /// `app.bsky.actor.searchActors`: full actor search with complete
    /// profiles. Nil on failure, an empty page on a real "no matches".
    public func searchActors(_ q: String, limit: Int = 10, cursor: String? = nil) async -> SearchActorsPage? {
        guard !q.isEmpty else { return nil }
        var query = [("q", q), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return SearchActorsPage(json: await appViewJSON("app.bsky.actor.searchActors", query: query))
    }

    // MARK: Posts

    /// `app.bsky.feed.getPostThread`. The defaults match the universal
    /// link page (`fetchPostThread`): the anchor and one parent, no replies.
    /// Nil when the call fails or the anchor is not a live post.
    public func getPostThread(_ uri: String, depth: Int = 0, parentHeight: Int = 1) async -> PostThread? {
        guard !uri.isEmpty else { return nil }
        let data = await appViewJSON("app.bsky.feed.getPostThread", query: [
            ("uri", uri),
            ("depth", String(depth)),
            ("parentHeight", String(parentHeight)),
        ])
        return PostThread(json: data)
    }

    /// `app.bsky.feed.getPosts`: hydrate up to 25 post URIs into full views
    /// with engagement counts. Nil for an empty list or a failed call.
    public func getPosts(_ uris: [String]) async -> [BskyPost]? {
        guard !uris.isEmpty else { return nil }
        guard let data = await appViewJSON("app.bsky.feed.getPosts", query: uris.map { ("uris", $0) }) else { return nil }
        return data["posts"]?.arrayValue?.compactMap { BskyPost(json: $0) } ?? []
    }

    /// `app.bsky.feed.getAuthorFeed`: an account's posts, newest first,
    /// each with the AppView's engagement counts.
    public func getAuthorFeed(
        actor: String,
        filter: AuthorFeedFilter? = nil,
        limit: Int = 30,
        cursor: String? = nil
    ) async -> BskyFeedPage? {
        guard !actor.isEmpty else { return nil }
        var query = [("actor", actor), ("limit", String(limit))]
        if let filter = filter { query.append(("filter", filter.rawValue)) }
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return BskyFeedPage(json: await appViewJSON("app.bsky.feed.getAuthorFeed", query: query))
    }

    /// `app.bsky.feed.getFeed`: what a custom feed generator is serving
    /// now. A feed whose generator is offline or gated answers non-2xx,
    /// which surfaces as nil.
    public func getFeed(feed: String, limit: Int = 25, cursor: String? = nil) async -> BskyFeedPage? {
        guard !feed.isEmpty else { return nil }
        var query = [("feed", feed), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return BskyFeedPage(json: await appViewJSON("app.bsky.feed.getFeed", query: query))
    }

    /// `app.bsky.feed.getListFeed`: posts from every member of a list.
    public func getListFeed(list: String, limit: Int = 25, cursor: String? = nil) async -> BskyFeedPage? {
        guard !list.isEmpty else { return nil }
        var query = [("list", list), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return BskyFeedPage(json: await appViewJSON("app.bsky.feed.getListFeed", query: query))
    }

    /// `app.bsky.feed.searchPosts`: full-text search, the most rate-limit
    /// sensitive endpoint here; keep limits modest. Nil on failure so
    /// "no results" and "search down" stay distinguishable.
    public func searchPosts(
        q: String,
        sort: SearchPostsSort? = nil,
        since: String? = nil,
        until: String? = nil,
        author: String? = nil,
        lang: String? = nil,
        limit: Int = 25,
        cursor: String? = nil
    ) async -> SearchPostsPage? {
        guard !q.isEmpty else { return nil }
        var query = [("q", q), ("limit", String(limit))]
        if let sort = sort { query.append(("sort", sort.rawValue)) }
        if let since = since, !since.isEmpty { query.append(("since", since)) }
        if let until = until, !until.isEmpty { query.append(("until", until)) }
        if let author = author, !author.isEmpty { query.append(("author", author)) }
        if let lang = lang, !lang.isEmpty { query.append(("lang", lang)) }
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return SearchPostsPage(json: await appViewJSON("app.bsky.feed.searchPosts", query: query))
    }

    /// `app.bsky.feed.getLikes` / `getRepostedBy` / `getQuotes`: who
    /// engaged with a post. `kind` picks the endpoint and which array of
    /// the page is populated.
    public func getPostEngagement(
        uri: String,
        kind: PostEngagementKind,
        limit: Int = 25,
        cursor: String? = nil
    ) async -> PostEngagementPage? {
        guard !uri.isEmpty else { return nil }
        var query = [("uri", uri), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return PostEngagementPage(json: await appViewJSON("app.bsky.feed.\(kind.method)", query: query), kind: kind)
    }

    // MARK: Trends and feeds

    /// `app.bsky.unspecced.getTrends`: trending topics with post volume.
    /// "unspecced" means Bluesky may change or remove it without notice;
    /// nil means "trends unavailable".
    public func getTrends(limit: Int = 10) async -> [TrendView]? {
        guard let data = await appViewJSON("app.bsky.unspecced.getTrends", query: [("limit", String(limit))]) else {
            return nil
        }
        return data["trends"]?.arrayValue?.compactMap { TrendView(json: $0) } ?? []
    }

    /// The three ways to list feed generators: an actor's own
    /// (`app.bsky.feed.getActorFeeds`), the network's most popular
    /// (`app.bsky.unspecced.getPopularFeedGenerators`) and Bluesky's
    /// suggestions (`app.bsky.unspecced.getSuggestedFeeds`).
    public func listFeedGenerators(
        source: FeedGeneratorSource,
        limit: Int = 25,
        cursor: String? = nil
    ) async -> FeedGeneratorsPage? {
        var query = [("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        let method: String
        switch source {
        case .actor(let actor):
            guard !actor.isEmpty else { return nil }
            query.append(("actor", actor))
            method = "app.bsky.feed.getActorFeeds"
        case .popular(let searchQuery):
            if let searchQuery = searchQuery, !searchQuery.isEmpty { query.append(("query", searchQuery)) }
            method = "app.bsky.unspecced.getPopularFeedGenerators"
        case .suggested:
            // getSuggestedFeeds caps limit at 25 where its siblings allow 50
            // and answers 400 above it. Clamp rather than fail: the caller
            // asked for "as many as you have", not for an error.
            query[0] = ("limit", String(min(limit, 25)))
            method = "app.bsky.unspecced.getSuggestedFeeds"
        }
        return FeedGeneratorsPage(json: await appViewJSON(method, query: query))
    }

    /// `app.bsky.feed.getFeedGenerators`: hydrate specific generator URIs.
    public func getFeedGenerators(_ uris: [String]) async -> FeedGeneratorsPage? {
        guard !uris.isEmpty else { return nil }
        return FeedGeneratorsPage(json: await appViewJSON("app.bsky.feed.getFeedGenerators", query: uris.map { ("feeds", $0) }))
    }

    // MARK: Graph

    /// `app.bsky.graph.getFollows` / `getFollowers`: one page of the
    /// accounts an actor follows, or that follow the actor.
    public func getSocialGraph(
        actor: String,
        direction: SocialGraphDirection,
        limit: Int = 50,
        cursor: String? = nil
    ) async -> SocialGraphPage? {
        guard !actor.isEmpty else { return nil }
        let method = direction == .follows ? "getFollows" : "getFollowers"
        var query = [("actor", actor), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return SocialGraphPage(json: await appViewJSON("app.bsky.graph.\(method)", query: query), direction: direction)
    }

    /// `app.bsky.graph.getList`: one list's metadata plus a page of members.
    public func getList(list: String, limit: Int = 50, cursor: String? = nil) async -> BskyListPage? {
        guard !list.isEmpty else { return nil }
        var query = [("list", list), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return BskyListPage(json: await appViewJSON("app.bsky.graph.getList", query: query))
    }

    /// `app.bsky.graph.getLists`: the lists an actor created.
    public func getLists(actor: String, limit: Int = 25, cursor: String? = nil) async -> BskyListsPage? {
        guard !actor.isEmpty else { return nil }
        var query = [("actor", actor), ("limit", String(limit))]
        if let cursor = cursor, !cursor.isEmpty { query.append(("cursor", cursor)) }
        return BskyListsPage(json: await appViewJSON("app.bsky.graph.getLists", query: query))
    }

    // MARK: Transport

    /// The URL an XRPC method resolves to on this client's AppView.
    public func xrpcURL(_ method: String, query: [(String, String)] = []) -> URL {
        makeURL(baseURL, path: "/xrpc/\(method)", query: query)
    }

    /// `fetchJsonOrNull`: GET and parse, nil on any failure.
    private func appViewJSON(_ method: String, query: [(String, String)]) async -> JSONValue? {
        try? await client.getJSONValue(from: xrpcURL(method, query: query))
    }
}
