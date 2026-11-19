import Foundation

// The XRPC console's list of methods. The web lists every query in
// src/lib/mcp/apiManifest.ts, a 200 KB index of every lexicon in
// bluesky-social/atproto that scripts/build-docs-manifest.mjs generates;
// the app carries the queries from it that a console with no session can
// have answered by a public host (profiles, feeds, the graph, labelers,
// identity, repos, sync), copied with their descriptions and parameter
// names. The chat, Ozone, admin and signed-in-only methods are left out.
// Any other method can still be opened by typing its full NSID: its
// parameters are read from the lexicon at run time either way.
// `XrpcConsoleTests` checks every entry against the web's manifest.

public enum XrpcMethodIndex {
    public static let methods: [XrpcMethod] = [
        XrpcMethod(
            nsid: "app.bsky.actor.getProfile",
            description: "Get detailed profile view of an actor. Does not require auth, but contains relevant metadata with auth.",
            params: ["actor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.actor.getProfiles",
            description: "Get detailed profile views of multiple actors.",
            params: ["actors"]
        ),
        XrpcMethod(
            nsid: "app.bsky.actor.searchActors",
            description: "Find actors (profiles) matching search criteria. Does not require auth.",
            params: ["term", "q", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.actor.searchActorsTypeahead",
            description: "Find actor suggestions for a prefix search term. Expected use is for auto-completion during text field entry. Does not require auth.",
            params: ["term", "q", "limit"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.describeFeedGenerator",
            description: "Get information about a feed generator, including policies and offered feed URIs. Does not require auth; implemented by Feed Generator services (not App View).",
            params: []
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getActorFeeds",
            description: "Get a list of feeds (feed generator records) created by the actor (in the actor's repo).",
            params: ["actor", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getAuthorFeed",
            description: "Get a view of an actor's 'author feed' (post and reposts by the author). Does not require auth.",
            params: ["actor", "limit", "cursor", "filter", "includePins"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getFeed",
            description: "Get a hydrated feed from an actor's selected feed generator. Implemented by App View.",
            params: ["feed", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getFeedGenerator",
            description: "Get information about a feed generator. Implemented by AppView.",
            params: ["feed"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getFeedGenerators",
            description: "Get information about a list of feed generators.",
            params: ["feeds"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getFeedSkeleton",
            description: "Get a skeleton of a feed provided by a feed generator. Auth is optional, depending on provider requirements, and provides the DID of the requester. Implemented by Feed Generator Service.",
            params: ["feed", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getLikes",
            description: "Get like records which reference a subject (by AT-URI and CID).",
            params: ["uri", "cid", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getListFeed",
            description: "Get a feed of recent posts from a list (posts and reposts from any actors on the list). Does not require auth.",
            params: ["list", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getPosts",
            description: "Gets post views for a specified list of posts (by AT-URI). This is sometimes referred to as 'hydrating' a 'feed skeleton'.",
            params: ["uris"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getPostThread",
            description: "Get posts in a thread. Does not require auth, but additional metadata and filtering will be applied for authed requests.",
            params: ["uri", "depth", "parentHeight"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getQuotes",
            description: "Get a list of quotes for a given post.",
            params: ["uri", "cid", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.getRepostedBy",
            description: "Get a list of reposts for a given post.",
            params: ["uri", "cid", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.feed.searchPosts",
            description: "Find posts matching search criteria, returning views of those posts. Note that this API endpoint may require authentication (eg, not public) for some service providers and implementations.",
            params: ["q", "sort", "since", "until", "mentions", "author", "lang", "domain", "url", "tag", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getActorStarterPacks",
            description: "Get a list of starter packs created by the actor.",
            params: ["actor", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getFollowers",
            description: "Enumerates accounts which follow a specified account (actor).",
            params: ["actor", "limit", "cursor", "sort"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getFollows",
            description: "Enumerates accounts which a specified account (actor) follows.",
            params: ["actor", "limit", "cursor", "sort"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getList",
            description: "Gets a 'view' (with additional context) of a specified list.",
            params: ["list", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getLists",
            description: "Enumerates the lists created by a specified account (actor).",
            params: ["actor", "limit", "cursor", "purposes"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getRelationships",
            description: "Enumerates public relationships between one account, and a list of other accounts. Does not require auth.",
            params: ["actor", "others"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getStarterPack",
            description: "Gets a view of a starter pack.",
            params: ["starterPack"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getStarterPacks",
            description: "Get views for a list of starter packs.",
            params: ["uris"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.getSuggestedFollowsByActor",
            description: "Enumerates follows similar to a given account (actor). Expected use is to recommend additional accounts immediately after following one account.",
            params: ["actor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.graph.searchStarterPacks",
            description: "Find starter packs matching search criteria. Does not require auth.",
            params: ["q", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "app.bsky.labeler.getServices",
            description: "Get information about a list of labeler services.",
            params: ["dids", "detailed"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getConfig",
            description: "Get miscellaneous runtime configuration.",
            params: []
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getPopularFeedGenerators",
            description: "An unspecced view of globally popular feed generators.",
            params: ["limit", "cursor", "query"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getPostThreadV2",
            description: "(NOTE: this endpoint is under development and WILL change without notice. Don't use it until it is moved out of `unspecced` or your application WILL break) Get posts in a thread. It is based in an anchor post at any depth of the tree, and returns posts above it (recursively resolving the parent, wi\u{2026}",
            params: ["anchor", "above", "below", "branchingFactor", "sort"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getSuggestedFeeds",
            description: "Get a list of suggested feeds",
            params: ["limit"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getSuggestedStarterPacks",
            description: "Get a list of suggested starterpacks",
            params: ["limit"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getSuggestedUsers",
            description: "Get a list of suggested users",
            params: ["category", "limit"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getTaggedSuggestions",
            description: "Get a list of suggestions (feeds and users) tagged with categories",
            params: []
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getTrendingTopics",
            description: "Get a list of trending topics",
            params: ["viewer", "limit"]
        ),
        XrpcMethod(
            nsid: "app.bsky.unspecced.getTrends",
            description: "Get the current trends on the network",
            params: ["limit"]
        ),
        XrpcMethod(
            nsid: "com.atproto.identity.resolveDid",
            description: "Resolves DID to DID document. Does not bi-directionally verify handle.",
            params: ["did"]
        ),
        XrpcMethod(
            nsid: "com.atproto.identity.resolveHandle",
            description: "Resolves an atproto handle (hostname) to a DID. Does not necessarily bi-directionally verify against the the DID document.",
            params: ["handle"]
        ),
        XrpcMethod(
            nsid: "com.atproto.identity.resolveIdentity",
            description: "Resolves an identity (DID or Handle) to a full identity (DID document and verified handle).",
            params: ["identifier"]
        ),
        XrpcMethod(
            nsid: "com.atproto.label.queryLabels",
            description: "Find labels relevant to the provided AT-URI patterns. Public endpoint for moderation services, though may return different or additional results with auth.",
            params: ["uriPatterns", "sources", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "com.atproto.lexicon.resolveLexicon",
            description: "Resolves an atproto lexicon (NSID) to a schema.",
            params: ["nsid"]
        ),
        XrpcMethod(
            nsid: "com.atproto.repo.describeRepo",
            description: "Get information about an account and repository, including the list of collections. Does not require auth.",
            params: ["repo"]
        ),
        XrpcMethod(
            nsid: "com.atproto.repo.getRecord",
            description: "Get a single record from a repository. Does not require auth.",
            params: ["repo", "collection", "rkey", "cid"]
        ),
        XrpcMethod(
            nsid: "com.atproto.repo.listRecords",
            description: "List a range of records in a repository, matching a specific collection. Does not require auth.",
            params: ["repo", "collection", "limit", "cursor", "reverse"]
        ),
        XrpcMethod(
            nsid: "com.atproto.server.describeServer",
            description: "Describes the server's account creation requirements and capabilities. Implemented by PDS.",
            params: []
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getBlob",
            description: "Get a blob associated with a given account. Returns the full blob as originally uploaded. Does not require auth; implemented by PDS.",
            params: ["did", "cid"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getBlocks",
            description: "Get data blocks from a given repo, by CID. For example, intermediate MST nodes, or records. Does not require auth; implemented by PDS.",
            params: ["did", "cids"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getHostStatus",
            description: "Returns information about a specified upstream host, as consumed by the server. Implemented by relays.",
            params: ["hostname"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getLatestCommit",
            description: "Get the current commit CID & revision of the specified repo. Does not require auth.",
            params: ["did"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getRecord",
            description: "Get data blocks needed to prove the existence or non-existence of record in the current version of repo. Does not require auth.",
            params: ["did", "collection", "rkey"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getRepo",
            description: "Download a repository export as CAR file. Optionally only a 'diff' since a previous revision. Does not require auth; implemented by PDS.",
            params: ["did", "since"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.getRepoStatus",
            description: "Get the hosting status for a repository, on this server. Expected to be implemented by PDS and Relay.",
            params: ["did"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.listBlobs",
            description: "List blob CIDs for an account, since some repo revision. Does not require auth; implemented by PDS.",
            params: ["did", "since", "limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.listHosts",
            description: "Enumerates upstream hosts (eg, PDS or relay instances) that this service consumes from. Implemented by relays.",
            params: ["limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.listRepos",
            description: "Enumerates all the DID, rev, and commit CID for all repos hosted by this service. Does not require auth; implemented by PDS and Relay.",
            params: ["limit", "cursor"]
        ),
        XrpcMethod(
            nsid: "com.atproto.sync.listReposByCollection",
            description: "Enumerates all the DIDs which have records with the given collection NSID.",
            params: ["collection", "limit", "cursor"]
        ),
    ]
}
