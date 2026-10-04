import Foundation

/// One run of a post's text after its facets have been applied.
public enum FacetSegment: Hashable, Sendable {
    case text(String)
    /// `app.bsky.richtext.facet#link` with an absolute http(s) URL.
    case link(String, url: String)
    /// `app.bsky.richtext.facet#mention` with a well-formed DID.
    case mention(String, did: String)
    /// `app.bsky.richtext.facet#tag`; `tag` is the sanitised hashtag without `#`.
    case tag(String, tag: String)

    /// The characters this segment covers.
    public var text: String {
        switch self {
        case .text(let s), .link(let s, _), .mention(let s, _), .tag(let s, _):
            return s
        }
    }

    public var isText: Bool {
        if case .text = self { return true }
        return false
    }
}

/// Port of the facet handling in `src/components/PostPreview.tsx`
/// (`utf8ByteToUtf16Index` + `renderText`) and the sanitisers it applies
/// from `src/utils/sanitize.ts`.
///
/// Facet offsets are UTF-8 byte positions into the post text. The web walks
/// code points and snaps an offset that lands inside a multi-byte character
/// forward to the next boundary; this does the same over unicode scalars.
/// Facets are applied in byteStart order. A facet is ignored (its text stays
/// plain) when it is empty or inverted, ends past the text, or starts inside
/// a facet already emitted, so a malformed record can never duplicate or
/// drop characters.
public enum Facets {
    /// Split `text` into plain and faceted runs. Adjacent plain runs are
    /// merged, so a text without usable facets is one `.text` segment; an
    /// empty text is no segments at all.
    public static func segments(text: String, facets: [BskyFacet]) -> [FacetSegment] {
        if text.isEmpty { return [] }
        if facets.isEmpty { return [.text(text)] }

        let boundaries = scalarBoundaries(of: text)
        let totalBytes = text.utf8.count

        // Stable ordering by byteStart: equal starts keep the record's order,
        // and only the first of them survives the overlap rule.
        let ordered = facets.enumerated().sorted { lhs, rhs in
            if lhs.element.byteStart != rhs.element.byteStart {
                return lhs.element.byteStart < rhs.element.byteStart
            }
            return lhs.offset < rhs.offset
        }.map(\.element)

        var out: [FacetSegment] = []
        var cursor = text.startIndex
        var consumedBytes = 0

        for facet in ordered {
            guard facet.byteStart >= 0,
                  facet.byteEnd > facet.byteStart,
                  facet.byteEnd <= totalBytes,
                  facet.byteStart >= consumedBytes else { continue }

            let start = index(forByteOffset: facet.byteStart, in: boundaries, text: text)
            let end = index(forByteOffset: facet.byteEnd, in: boundaries, text: text)
            guard start >= cursor, end > start else { continue }

            if start > cursor {
                append(.text(String(text[cursor..<start])), to: &out)
            }
            let covered = String(text[start..<end])
            append(segment(for: covered, feature: facet.features.first), to: &out)
            cursor = end
            consumedBytes = facet.byteEnd
        }

        if cursor < text.endIndex {
            append(.text(String(text[cursor...])), to: &out)
        }
        return out
    }

    /// Same, reading the facets straight out of a raw record's `facets` array.
    public static func segments(text: String, facets json: JSONValue?) -> [FacetSegment] {
        let facets = json?.arrayValue?.compactMap { BskyFacet(json: $0) } ?? []
        return segments(text: text, facets: facets)
    }

    public static func segments(of record: BskyPostRecord) -> [FacetSegment] {
        segments(text: record.text, facets: record.facets)
    }

    /// Where the web sends a tag click.
    public static func hashtagURL(_ tag: String) -> String {
        "https://bsky.app/hashtag/\(tag)"
    }

    /// Where the web sends a mention click: the profile page for the DID.
    public static func mentionPath(_ did: String) -> String {
        "/\(did)"
    }

    // MARK: Byte offsets

    /// The UTF-8 offset of every scalar boundary, including the end.
    private static func scalarBoundaries(of text: String) -> [(byte: Int, index: String.Index)] {
        var boundaries: [(byte: Int, index: String.Index)] = []
        boundaries.reserveCapacity(text.unicodeScalars.count + 1)
        var byte = 0
        var index = text.unicodeScalars.startIndex
        let scalars = text.unicodeScalars
        while index < scalars.endIndex {
            boundaries.append((byte, index))
            byte += scalars[index].utf8.count
            index = scalars.index(after: index)
        }
        boundaries.append((byte, text.endIndex))
        return boundaries
    }

    /// The first boundary at or after `byteOffset`; the end when none is.
    /// Mirrors `utf8ByteToUtf16Index`, which returns as soon as its running
    /// byte count reaches or passes the target.
    private static func index(
        forByteOffset byteOffset: Int,
        in boundaries: [(byte: Int, index: String.Index)],
        text: String
    ) -> String.Index {
        var low = 0
        var high = boundaries.count
        while low < high {
            let mid = (low + high) / 2
            if boundaries[mid].byte < byteOffset {
                low = mid + 1
            } else {
                high = mid
            }
        }
        return low < boundaries.count ? boundaries[low].index : text.endIndex
    }

    // MARK: Features

    /// The web reads only the first feature; an unknown type or one whose
    /// payload fails sanitisation renders as plain text.
    private static func segment(for text: String, feature: BskyFacetFeature?) -> FacetSegment {
        guard let feature = feature else { return .text(text) }
        switch feature.type {
        case BskyFacetFeature.linkType:
            if let url = sanitizedFacetLink(feature.uri) { return .link(text, url: url) }
        case BskyFacetFeature.mentionType:
            if let did = sanitizedFacetDid(feature.did) { return .mention(text, did: did) }
        case BskyFacetFeature.tagType:
            if let tag = sanitizedFacetHashtag(feature.tag) { return .tag(text, tag: tag) }
        default:
            break
        }
        return .text(text)
    }

    private static func append(_ segment: FacetSegment, to out: inout [FacetSegment]) {
        if case .text(let s) = segment, case .text(let previous)? = out.last {
            out[out.count - 1] = .text(previous + s)
        } else {
            out.append(segment)
        }
    }
}

// MARK: - Sanitisers (from src/utils/sanitize.ts)

/// The schemes `sanitizeUrl` refuses outright, checked before any parsing.
private let blockedFacetSchemes = ["javascript:", "data:", "vbscript:", "file:", "about:", "blob:"]

/// `sanitizeFacetLink`: an absolute http(s) URL or nothing. Relative paths
/// pass `sanitizeUrl` on the web but fail the absolute-URL check that
/// follows, so they are rejected here in one step.
private func sanitizedFacetLink(_ uri: String?) -> String? {
    guard let uri = uri else { return nil }
    let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return nil }
    let lowered = trimmed.lowercased()
    for scheme in blockedFacetSchemes where lowered.hasPrefix(scheme) {
        return nil
    }
    guard lowered.hasPrefix("http://") || lowered.hasPrefix("https://") else { return nil }
    guard let url = URL(string: trimmed) ?? URL(string: percentEncodedFacetLink(trimmed)),
          let host = url.host, !host.isEmpty else { return nil }
    return trimmed
}

/// JavaScript's `new URL` accepts raw unicode and spaces in a path and
/// encodes them; Foundation's `URL(string:)` may not, so a link that fails
/// the strict parse is retried with the characters a URL cannot carry
/// escaped. The original spelling is what gets returned either way.
private func percentEncodedFacetLink(_ value: String) -> String {
    var allowed = CharacterSet.urlQueryAllowed
    allowed.insert(charactersIn: "#")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

/// `^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$` and no `..` or `//`.
private let facetDidPattern = #/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/#

/// `sanitizeDid`.
private func sanitizedFacetDid(_ did: String?) -> String? {
    guard let did = did else { return nil }
    let trimmed = did.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.wholeMatch(of: facetDidPattern) != nil else { return nil }
    if trimmed.contains("..") || trimmed.contains("//") { return nil }
    return trimmed
}

/// `sanitizeHashtag`: drop a leading `#`, keep only `[a-zA-Z0-9_-]`.
/// Unlike the DID and link checks this never rejects, it strips; only a
/// tag with nothing left is unusable.
private func sanitizedFacetHashtag(_ tag: String?) -> String? {
    guard let tag = tag else { return nil }
    var trimmed = Substring(tag.trimmingCharacters(in: .whitespacesAndNewlines))
    if trimmed.hasPrefix("#") { trimmed = trimmed.dropFirst() }
    let kept = trimmed.unicodeScalars.filter { scalar in
        switch scalar {
        case "a"..."z", "A"..."Z", "0"..."9", "_", "-": return true
        default: return false
        }
    }
    if kept.isEmpty { return nil }
    return String(String.UnicodeScalarView(kept))
}
