import Foundation

/// The `at.margin.*` record types the web has a custom preview for.
public enum MarginLexiconType: String, CaseIterable, Hashable, Sendable {
    case annotation = "at.margin.annotation"
    case bookmark = "at.margin.bookmark"
    case highlight = "at.margin.highlight"
    case collection = "at.margin.collection"
    case collectionItem = "at.margin.collectionItem"
    case reply = "at.margin.reply"
    case like = "at.margin.like"

    public var displayName: String {
        switch self {
        case .annotation: return "Annotation"
        case .bookmark: return "Bookmark"
        case .highlight: return "Highlight"
        case .collection: return "Collection"
        case .collectionItem: return "Collection Item"
        case .reply: return "Reply"
        case .like: return "Like"
        }
    }

    public var summary: String {
        switch self {
        case .annotation: return "Annotate and comment on web content"
        case .bookmark: return "Bookmarked webpage"
        case .highlight: return "Highlighted text from a webpage"
        case .collection: return "Collection of annotations and bookmarks"
        case .collectionItem: return "Item in a collection"
        case .reply: return "Reply to an annotation"
        case .like: return "Like on an annotation or reply"
        }
    }
}

/// Helpers for detecting and naming Margin records. Port of
/// `src/utils/marginLexicons.ts`.
public enum MarginLexicons {
    public static let namespacePrefix = "at.margin."

    /// Any collection under the `at.margin.` namespace.
    public static func isMarginLexicon(_ collection: String) -> Bool {
        collection.hasPrefix(namespacePrefix)
    }

    /// The specific type, nil for a collection outside the namespace or one
    /// the web has no preview for.
    public static func type(of collection: String) -> MarginLexiconType? {
        guard isMarginLexicon(collection) else { return nil }
        return MarginLexiconType(rawValue: collection)
    }

    /// Whether the record gets a custom card rather than the JSON tree.
    public static func hasCustomPreview(_ collection: String) -> Bool {
        type(of: collection) != nil
    }

    /// "Annotation", "Collection Item", ...; for an unlisted `at.margin.*`
    /// collection the NSID with the namespace stripped, and any other
    /// collection unchanged.
    public static func displayName(of collection: String) -> String {
        if let type = type(of: collection) { return type.displayName }
        return collection.replacingOccurrences(of: namespacePrefix, with: "")
    }

    /// A one-line description; "Margin record" for anything unlisted.
    public static func description(of collection: String) -> String {
        type(of: collection)?.summary ?? "Margin record"
    }
}
