import Foundation

// Port of src/lib/tools/recordLinks.ts: the tools that have something to
// say about a given record or account, for the explorer to offer where
// that record or account is already open. Kept beside the catalog so the
// query key each tool reads is written down in one place.

/// A link into a tool with its input filled in.
public struct ToolLink: Hashable, Sendable, Identifiable {
    /// The tool's slug, for its icon and title from the catalog.
    public let slug: String
    /// What the link says.
    public let label: String
    /// A sentence for the accessibility hint.
    public let title: String
    /// The tool's input, under the key its page reads.
    public let query: [String: String]

    public var id: String { slug }

    public init(slug: String, label: String, title: String, query: [String: String]) {
        self.slug = slug
        self.label = label
        self.title = title
        self.query = query
    }
}

public enum ToolLinks {
    /// Tools worth opening for one record, by its collection. Empty for most.
    public static func forRecord(collection: String, atUri: String, rkey: String) -> [ToolLink] {
        switch collection {
        case "app.bsky.feed.post":
            return [ToolLink(slug: "post", label: "Inspect post", title: "Facets by byte range, reply rules, labels and timestamps", query: ["post": atUri])]
        case "app.bsky.feed.generator":
            return [ToolLink(slug: "feed", label: "Inspect feed", title: "Who runs this feed, whether its generator answers, and what it returns", query: ["feed": atUri])]
        case "com.atproto.lexicon.schema":
            // A schema record's key is the NSID it defines.
            return [ToolLink(slug: "lexicon", label: "Check publishing", title: "Follow this lexicon from its DNS record to this schema record", query: ["nsid": rkey])]
        default:
            return []
        }
    }

    /// Tools that read a whole account, for the Tools list on its page. The
    /// label and visibility checks are not among them: they run on the
    /// account card and have tabs of their own.
    public static func forAccount(did: String) -> [ToolLink] {
        [
            ToolLink(slug: "memberships", label: "Lists and verifications", title: "Lists this account is on, and who has verified it", query: ["account": did]),
            ToolLink(slug: "activity", label: "Activity calendar", title: "A year of this account\u{2019}s writes across every app", query: ["actor": did]),
            ToolLink(slug: "mutuals", label: "Mutuals\u{2019} blocks", title: "The accounts this account\u{2019}s mutuals block most", query: ["account": did]),
            ToolLink(slug: "car", label: "Repo archive", title: "Browse this account\u{2019}s repository export", query: ["actor": did]),
        ]
    }
}
