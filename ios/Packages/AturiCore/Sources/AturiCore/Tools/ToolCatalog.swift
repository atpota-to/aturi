import Foundation

// Port of src/lib/tools/catalog.ts: every tool under /tools, in the order
// the hub lists them, and the groups they sit in. The single source for
// each place the app names a tool: the Tools tab's rows, each tool page's
// title and lead, and the `/tools/{slug}` links the app opens. Icons are
// the app's to choose, so they are not here. The copy is the web's, less
// "in the browser" where the app does the work on the device;
// `ToolCatalogTests` checks the slugs against the web file.

/// A group on the Tools tab (`ToolGroupId`).
public enum ToolGroupID: String, CaseIterable, Hashable, Sendable {
    case network
    case identity
    case accounts
    case records
    case services
}

public struct ToolGroup: Hashable, Sendable, Identifiable {
    public let id: ToolGroupID
    public let title: String
    /// What the group is for, one short sentence.
    public let blurb: String
}

public struct ToolEntry: Hashable, Sendable, Identifiable {
    /// The path segment under /tools.
    public let slug: String
    public let title: String
    /// One sentence for the hub row.
    public let desc: String
    /// The line under the tool's own heading.
    public let lead: String
    public let group: ToolGroupID
    public let keywords: [String]

    public var id: String { slug }

    /// `/tools/{slug}`.
    public var path: String { "/tools/\(slug)" }
}

public enum ToolCatalog {
    public static let groups: [ToolGroup] = [
        ToolGroup(id: .network, title: "Network", blurb: "What the network is doing, and how to ask it."),
        ToolGroup(id: .identity, title: "Identity", blurb: "Handles, DIDs and the identifiers records are built from."),
        ToolGroup(id: .accounts, title: "Accounts", blurb: "What an account has written, and what others say about it."),
        ToolGroup(id: .records, title: "Records and lexicons", blurb: "Check a record against its schema, and a schema against the network."),
        ToolGroup(id: .services, title: "Services and the web", blurb: "Feed generators, OAuth clients, and pages that point at records."),
    ]

    public static let tools: [ToolEntry] = [
        ToolEntry(
            slug: "stream",
            title: "Stream monitor",
            desc: "Watch Jetstream and the PLC directory live, filtered by event type, account, collection or text.",
            lead: "Records being written across the Atmosphere and every did:plc operation, as they happen.",
            group: .network,
            keywords: ["jetstream", "firehose", "plc", "stream", "monitor", "live"]
        ),
        ToolEntry(
            slug: "xrpc",
            title: "XRPC console",
            desc: "Call any atproto query: pick a method, fill in its parameters from the lexicon, and read the response.",
            lead: "Pick a query from the atproto and Bluesky lexicons, fill in its parameters, and send it to the public AppView or any PDS.",
            group: .network,
            keywords: ["xrpc", "api", "console", "playground", "query", "endpoint", "request"]
        ),
        ToolEntry(
            slug: "relay",
            title: "Relay crawl check",
            desc: "Ask the relays whether they are crawling a PDS, how many accounts they see on it, and how far they have read.",
            lead: "A PDS only reaches the network through a relay. This asks each one what it knows about a host.",
            group: .network,
            keywords: ["relay", "crawl", "pds", "host", "firehose", "self-host", "requestcrawl"]
        ),
        ToolEntry(
            slug: "handle",
            title: "Handle debugger",
            desc: "Check a handle step by step: the DNS record, the well-known file, the DID document and the PDS behind it.",
            lead: "A handle is only valid when it points at a DID and that DID points back. This checks both directions and says which step fails.",
            group: .identity,
            keywords: ["handle", "dns", "well-known", "did", "verify", "domain", "invalid", "debug"]
        ),
        ToolEntry(
            slug: "resolve",
            title: "Bulk identity resolver",
            desc: "Paste a list of handles and DIDs and get each one’s DID, handle and PDS as a table to copy or download.",
            lead: "Paste handles and DIDs, one per line or separated by commas. Each is resolved to its DID, current handle and PDS.",
            group: .identity,
            keywords: ["resolve", "bulk", "batch", "did", "handle", "csv", "lookup"]
        ),
        ToolEntry(
            slug: "decode",
            title: "Identifier decoder",
            desc: "Take apart a TID, CID, at:// URI, DID, NSID or JWT and see what each part means. Nothing leaves the device.",
            lead: "Paste a record key, CID, at:// URI, DID, NSID or a token. It is decoded here on the device and never sent anywhere.",
            group: .identity,
            keywords: ["tid", "cid", "rkey", "at-uri", "did:key", "jwt", "decode", "timestamp", "nsid"]
        ),
        ToolEntry(
            slug: "activity",
            title: "Activity calendar",
            desc: "A year of one account’s writes across every app, drawn from the timestamps inside its record keys.",
            lead: "Every record key carries the moment it was made. This reads an account’s keys across every collection and draws the year.",
            group: .accounts,
            keywords: ["activity", "calendar", "heatmap", "history", "contributions", "timeline"]
        ),
        ToolEntry(
            slug: "memberships",
            title: "Lists and verifications",
            desc: "Find the lists an account has been added to and the accounts that have verified it, from records across the network.",
            lead: "Lists and verifications are records in other people’s repositories. This finds the ones that point at an account.",
            group: .accounts,
            keywords: ["lists", "listitem", "verification", "verified", "memberships", "starter pack", "moderation list"]
        ),
        ToolEntry(
            slug: "labels",
            title: "Label checker",
            desc: "See the labels on an account or post, which labeler applied each one, and what that labeler says it means.",
            lead: "Labels come from independent labelers, and an app only shows the ones it subscribes to. This asks for all of them.",
            group: .accounts,
            keywords: ["labels", "labeler", "moderation", "ozone", "takedown", "warning"]
        ),
        ToolEntry(
            slug: "shadowban",
            title: "Shadowban checker",
            desc: "Compare an account’s posts on its PDS with what an AppView returns, and find posts, replies or search results that are missing.",
            lead: "An AppView can hide an account without labeling it. Its replies disappear from threads, or it stops showing up in search. This reads the account’s posts from its PDS and compares them with what the AppView returns.",
            group: .accounts,
            keywords: ["shadowban", "shadow ban", "hidden", "needs review", "visibility", "appview", "search", "suppressed"]
        ),
        ToolEntry(
            slug: "mutuals",
            title: "Mutuals’ blocks",
            desc: "See which accounts your mutuals block most, map how their blocks overlap, and save the ones you pick as a moderation list.",
            lead: "Blocks are public records. This finds the accounts that follow each other with yours, reads each one’s blocks from its own PDS, and shows which accounts many of them block, and how far they agree.",
            group: .accounts,
            keywords: ["mutuals", "moots", "blocks", "blocked", "block list", "moderation list", "modlist", "six degrees"]
        ),
        ToolEntry(
            slug: "car",
            title: "Repo archive inspector",
            desc: "Open a repository export (a CAR file) on the device: its commit, its collections and every record in it.",
            lead: "A repository export is one file holding every record an account has written. Open one here, or fetch an account’s, and browse it without uploading it anywhere.",
            group: .accounts,
            keywords: ["car", "archive", "backup", "export", "repo", "getRepo", "cbor", "mst"]
        ),
        ToolEntry(
            slug: "validate",
            title: "Record validator",
            desc: "Check a record against the lexicon its author published, and list every field that does not match.",
            lead: "Paste a record, or point at one by at:// URI. It is checked against the schema published for its type.",
            group: .records,
            keywords: ["validate", "lexicon", "schema", "record", "json", "lint"]
        ),
        ToolEntry(
            slug: "post",
            title: "Post inspector",
            desc: "Open a Bluesky post’s record: facets by byte range, embeds, reply and quote rules, labels and timestamps.",
            lead: "Everything a post record says and an app does not show: where each link and mention starts and ends, who may reply, and when it was really written.",
            group: .records,
            keywords: ["post", "facets", "richtext", "bytes", "threadgate", "postgate", "embed", "inspect"]
        ),
        ToolEntry(
            slug: "lexicon",
            title: "Lexicon publishing checker",
            desc: "Follow an NSID from its DNS record to the schema record behind it, and see where the chain breaks.",
            lead: "A lexicon is published by a DNS record that names a DID, and a schema record in that DID’s repository. This walks the chain.",
            group: .records,
            keywords: ["lexicon", "nsid", "publish", "_lexicon", "dns", "schema", "authority"]
        ),
        ToolEntry(
            slug: "feed",
            title: "Feed inspector",
            desc: "Look inside a custom feed: who runs it, whether its generator answers, and the raw skeleton it returns.",
            lead: "A feed is a record that names a service. This reads the record, asks the service what it serves, and shows what comes back.",
            group: .services,
            keywords: ["feed", "generator", "skeleton", "algorithm", "custom feed", "feedgen"]
        ),
        ToolEntry(
            slug: "oauth",
            title: "OAuth client checker",
            desc: "Validate an OAuth client metadata document against the atproto profile, and build or read a scope string.",
            lead: "Fetch a client metadata document and check it against what atproto authorization servers require, or put together the scopes an app should ask for.",
            group: .services,
            keywords: ["oauth", "client metadata", "client_id", "scope", "dpop", "permission", "granular"]
        ),
        ToolEntry(
            slug: "share",
            title: "Share button builder",
            desc: "Make “share to the Atmosphere” links and buttons that open the composer in each client that supports it.",
            lead: "Write the text once and get a link for every client with a compose route, plus markup to put on a page.",
            group: .services,
            keywords: ["share", "intent", "compose", "button", "link", "embed"]
        ),
        ToolEntry(
            slug: "page",
            title: "Page checker",
            desc: "See how a web page presents itself to the Atmosphere: its link card and the at:// records it declares.",
            lead: "Fetch a page the way a client would, and read the link card it offers and the at:// tags that tie it to a record.",
            group: .services,
            keywords: ["page", "link card", "open graph", "og", "at tags", "preview", "meta"]
        ),
    ]

    private static let bySlug: [String: ToolEntry] = Dictionary(uniqueKeysWithValues: tools.map { ($0.slug, $0) })

    /// The catalog entry for a slug; nil for a slug that is not listed.
    public static func tool(_ slug: String) -> ToolEntry? {
        bySlug[slug]
    }

    /// Tools by group, in catalog order, skipping any group left empty
    /// (`toolsByGroup`).
    public static func byGroup() -> [(group: ToolGroup, tools: [ToolEntry])] {
        groups.compactMap { group in
            let members = tools.filter { $0.group == group.id }
            return members.isEmpty ? nil : (group: group, tools: members)
        }
    }
}
