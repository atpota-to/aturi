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
}

public struct ToolEntry: Hashable, Sendable, Identifiable {
    /// The path segment under /tools.
    public let slug: String
    public let title: String
    /// One short line for the hub row (the web's `tile`).
    public let desc: String
    /// A line under the tool's own heading, only where the user needs to
    /// know something before using it; nil for most tools.
    public let lead: String?
    public let group: ToolGroupID
    public let keywords: [String]

    public var id: String { slug }

    /// `/tools/{slug}`.
    public var path: String { "/tools/\(slug)" }
}

public enum ToolCatalog {
    public static let groups: [ToolGroup] = [
        ToolGroup(id: .network, title: "Network"),
        ToolGroup(id: .identity, title: "Identity"),
        ToolGroup(id: .accounts, title: "Accounts"),
        ToolGroup(id: .records, title: "Records and lexicons"),
        ToolGroup(id: .services, title: "Services and the web"),
    ]

    public static let tools: [ToolEntry] = [
        ToolEntry(
            slug: "stream",
            title: "Stream monitor",
            desc: "Live Jetstream and PLC events, filtered.",
            lead: nil,
            group: .network,
            keywords: ["jetstream", "firehose", "plc", "stream", "monitor", "live"]
        ),
        ToolEntry(
            slug: "xrpc",
            title: "XRPC console",
            desc: "Call any atproto query and read the response.",
            lead: nil,
            group: .network,
            keywords: ["xrpc", "api", "console", "playground", "query", "endpoint", "request"]
        ),
        ToolEntry(
            slug: "relay",
            title: "Relay crawl check",
            desc: "Check whether relays are crawling a PDS.",
            lead: nil,
            group: .network,
            keywords: ["relay", "crawl", "pds", "host", "firehose", "self-host", "requestcrawl"]
        ),
        ToolEntry(
            slug: "pds",
            title: "PDS version check",
            desc: "Check whether a PDS runs the latest release.",
            lead: "Compared with releases of the reference PDS. Other PDS software can’t be compared.",
            group: .network,
            keywords: ["pds", "version", "update", "up to date", "outdated", "release", "self-host", "pdsadmin", "health"]
        ),
        ToolEntry(
            slug: "handle",
            title: "Handle debugger",
            desc: "Find the step where a handle stops resolving.",
            lead: nil,
            group: .identity,
            keywords: ["handle", "dns", "well-known", "did", "verify", "domain", "invalid", "debug"]
        ),
        ToolEntry(
            slug: "resolve",
            title: "Bulk identity resolver",
            desc: "Resolve a list of handles and DIDs to a table.",
            lead: nil,
            group: .identity,
            keywords: ["resolve", "bulk", "batch", "did", "handle", "csv", "lookup"]
        ),
        ToolEntry(
            slug: "decode",
            title: "Identifier decoder",
            desc: "Take apart a TID, CID, at:// URI, DID, NSID or JWT.",
            lead: "Decoded on the device. Nothing is sent.",
            group: .identity,
            keywords: ["tid", "cid", "rkey", "at-uri", "did:key", "jwt", "decode", "timestamp", "nsid"]
        ),
        ToolEntry(
            slug: "activity",
            title: "Activity calendar",
            desc: "A year of an account’s writes, across every app.",
            lead: nil,
            group: .accounts,
            keywords: ["activity", "calendar", "heatmap", "history", "contributions", "timeline"]
        ),
        ToolEntry(
            slug: "memberships",
            title: "Lists and verifications",
            desc: "Lists an account is on, and who verified it.",
            lead: nil,
            group: .accounts,
            keywords: ["lists", "listitem", "verification", "verified", "memberships", "starter pack", "moderation list"]
        ),
        ToolEntry(
            slug: "labels",
            title: "Label checker",
            desc: "Every label on an account or post, and who applied it.",
            lead: "From every labeler, not only the ones your app subscribes to.",
            group: .accounts,
            keywords: ["labels", "labeler", "moderation", "ozone", "takedown", "warning"]
        ),
        ToolEntry(
            slug: "shadowban",
            title: "Shadowban checker",
            desc: "Find posts, replies or search results an AppView hides.",
            lead: "Compares an account’s posts on its PDS with what the AppView returns.",
            group: .accounts,
            keywords: ["shadowban", "shadow ban", "hidden", "needs review", "visibility", "appview", "search", "suppressed"]
        ),
        ToolEntry(
            slug: "mutuals",
            title: "Mutuals’ blocks",
            desc: "Which accounts your mutuals block, and how much they agree.",
            lead: nil,
            group: .accounts,
            keywords: ["mutuals", "moots", "blocks", "blocked", "block list", "moderation list", "modlist", "six degrees"]
        ),
        ToolEntry(
            slug: "car",
            title: "Repo archive inspector",
            desc: "Browse a repository export (CAR file).",
            lead: "Opened on the device. Nothing is uploaded.",
            group: .accounts,
            keywords: ["car", "archive", "backup", "export", "repo", "getRepo", "cbor", "mst"]
        ),
        ToolEntry(
            slug: "validate",
            title: "Record validator",
            desc: "Check a record against its published lexicon.",
            lead: nil,
            group: .records,
            keywords: ["validate", "lexicon", "schema", "record", "json", "lint"]
        ),
        ToolEntry(
            slug: "post",
            title: "Post inspector",
            desc: "A post record’s facets, embeds, gates and timestamps.",
            lead: nil,
            group: .records,
            keywords: ["post", "facets", "richtext", "bytes", "threadgate", "postgate", "embed", "inspect"]
        ),
        ToolEntry(
            slug: "lexicon",
            title: "Lexicon publishing checker",
            desc: "Trace an NSID from DNS to its schema record.",
            lead: nil,
            group: .records,
            keywords: ["lexicon", "nsid", "publish", "_lexicon", "dns", "schema", "authority"]
        ),
        ToolEntry(
            slug: "feed",
            title: "Feed inspector",
            desc: "Check a custom feed and what its generator returns.",
            lead: nil,
            group: .services,
            keywords: ["feed", "generator", "skeleton", "algorithm", "custom feed", "feedgen"]
        ),
        ToolEntry(
            slug: "oauth",
            title: "OAuth client checker",
            desc: "Validate OAuth client metadata and build scopes.",
            lead: nil,
            group: .services,
            keywords: ["oauth", "client metadata", "client_id", "scope", "dpop", "permission", "granular"]
        ),
        ToolEntry(
            slug: "share",
            title: "Share button builder",
            desc: "Make share links and buttons for every client.",
            lead: nil,
            group: .services,
            keywords: ["share", "intent", "compose", "button", "link", "embed"]
        ),
        ToolEntry(
            slug: "page",
            title: "Page checker",
            desc: "A web page’s link card and at:// tags.",
            lead: nil,
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
