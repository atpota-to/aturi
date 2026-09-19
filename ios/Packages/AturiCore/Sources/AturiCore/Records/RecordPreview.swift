import Foundation

/// Heuristics for a one-line preview and a short title of an arbitrary
/// record value. Port of `src/utils/atproto/previewExtractors.ts`; used by
/// the collection listing (rkey + preview) and record cards.
///
/// The field order matters: lexicons with a canonical title field are
/// caught before the generic text and description fallbacks.
public enum RecordPreview {
    /// Fields tried in order by `previewFor`.
    public static let previewFields = ["title", "name", "displayName", "status", "text", "description", "summary"]

    /// Fields tried in order by `titleFor`.
    public static let titleFields = ["title", "name", "displayName"]

    public static let previewLength = 140
    public static let titleLength = 100

    /// The first non-blank string among `previewFields`, else the URI,
    /// handle or DID of a `subject` (follows, likes and blocks point at
    /// another record), else `createdAt`, else "".
    public static func previewFor(_ value: JSONValue?) -> String {
        guard let value = value, let object = value.objectValue else { return "" }

        for key in previewFields {
            if let candidate = trimmedNonBlank(object[key]) {
                return truncate(candidate, previewLength)
            }
        }

        if let subject = object["subject"] {
            if subject.objectValue != nil {
                if let uri = subject["uri"]?.stringValue { return truncate(uri, previewLength) }
                if let handle = subject["handle"]?.stringValue { return truncate(handle, previewLength) }
                if let did = subject["did"]?.stringValue { return truncate(did, previewLength) }
            }
            if let text = subject.stringValue { return truncate(text, previewLength) }
        }

        if let createdAt = object["createdAt"]?.stringValue { return createdAt }
        return ""
    }

    /// Cut to `n` characters, ending in a single ellipsis when anything was
    /// dropped. Counts extended grapheme clusters where the web counts
    /// UTF-16 units, so an emoji never gets split in half.
    public static func truncate(_ s: String, _ n: Int) -> String {
        if s.count <= n { return s }
        let head = String(s.prefix(max(n - 1, 0)))
        return trimmedEnd(head) + "\u{2026}"
    }

    /// A short title: the first non-blank of `titleFields`, else the last
    /// segment of the collection NSID, else the rkey, else "record".
    public static func titleFor(_ value: JSONValue?, collection: String? = nil, rkey: String? = nil) -> String {
        if let object = value?.objectValue {
            for key in titleFields {
                if let candidate = trimmedNonBlank(object[key]) {
                    return truncate(candidate, titleLength)
                }
            }
        }
        if let collection = collection, !collection.isEmpty {
            let tail = collection.split(separator: ".", omittingEmptySubsequences: false).last ?? ""
            if !tail.isEmpty { return String(tail) }
        }
        if let rkey = rkey, !rkey.isEmpty { return rkey }
        return "record"
    }

    // MARK: Helpers

    /// A string field, trimmed, or nil when absent, not a string or blank.
    private static func trimmedNonBlank(_ value: JSONValue?) -> String? {
        guard let s = value?.stringValue else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// JavaScript's `trimEnd`.
    private static func trimmedEnd(_ s: String) -> String {
        var scalars = Substring(s)
        while let last = scalars.last, last.isWhitespace || last.isNewline {
            scalars = scalars.dropLast()
        }
        return String(scalars)
    }
}
