import Foundation

/// AT Tags, port of `src/utils/atproto/atTags.ts`: the community proposal
/// for mapping a web page to the atproto records and identities it
/// references, via `<meta>` tags in the `at:` namespace
/// (https://tangled.org/chrisshank.com/at-tags/).
///
/// A page declares its relationships with a handful of standard properties:
///
///     <meta name="at:canonical" content="at://did:plc:abc/site.standard.document/rkey" />
///     <meta name="at:alternate" content="at://did:plc:xyz/app.bsky.feed.post/rkey" />
///     <meta name="at:author"    content="at://did:plc:author" />
///     <meta name="at:me"        content="at://did:plc:my-did" />
///
/// Non-standard properties are carried under a namespace:
///
///     <meta name="at:standard.site:comments" content="at://did:plc:abc/..." />
///
/// Two rules from the proposal shape the parser: repeating a property name
/// accumulates values, and any `at:` property that is neither a standard
/// property nor namespaced (`at:{namespace}:{property}`) is ignored.
///
/// Only the parsing half is here, for the page checker; building tags is
/// the web server's job.
public enum PageCheckerAtTags {
    /// The four properties defined by the proposal itself.
    public enum Relation: String, Hashable, Sendable, CaseIterable {
        case canonical
        case alternate
        case author
        case me
    }

    /// The parsed shape of a meta tag's `name` attribute.
    public enum TagName: Hashable, Sendable {
        case standard(Relation)
        case namespaced(namespace: String, property: String)
    }

    /// One recognized `at:` meta tag with its validated AT URI.
    public struct Tag: Hashable, Sendable {
        public var kind: TagName
        /// The normalized `name` attribute, e.g. `at:canonical`.
        public var name: String
        public var uri: String
    }

    /// One namespaced property and its URIs, in the order the page gave them.
    public struct Property: Hashable, Sendable {
        public var name: String
        public var uris: [String]
    }

    public struct Namespace: Hashable, Sendable {
        public var name: String
        public var properties: [Property]
    }

    /// The full result of parsing a page's AT Tags. Standard properties get
    /// their own arrays; everything namespaced is grouped namespace ->
    /// property -> uris, in source order (the web keeps that order in an
    /// object's keys). `tags` is a flat, source-ordered list.
    public struct Result: Hashable, Sendable {
        public var canonical: [String] = []
        public var alternate: [String] = []
        public var author: [String] = []
        public var me: [String] = []
        public var namespaces: [Namespace] = []
        public var tags: [Tag] = []

        public init() {}

        public func uris(_ relation: Relation) -> [String] {
            switch relation {
            case .canonical: return canonical
            case .alternate: return alternate
            case .author: return author
            case .me: return me
            }
        }

        /// The namespaces as the web's nested object.
        public var namespaceMap: [String: [String: [String]]] {
            var out: [String: [String: [String]]] = [:]
            for namespace in namespaces {
                var properties: [String: [String]] = [:]
                for property in namespace.properties {
                    properties[property.name] = property.uris
                }
                out[namespace.name] = properties
            }
            return out
        }

        public var isEmpty: Bool {
            tags.isEmpty
        }

        /// Append `uri` to a standard relation if absent; whether it was added.
        mutating func add(_ uri: String, to relation: Relation) -> Bool {
            switch relation {
            case .canonical: return Self.pushUnique(&canonical, uri)
            case .alternate: return Self.pushUnique(&alternate, uri)
            case .author: return Self.pushUnique(&author, uri)
            case .me: return Self.pushUnique(&me, uri)
            }
        }

        mutating func add(_ uri: String, namespace: String, property: String) -> Bool {
            var nsIndex = namespaces.firstIndex { $0.name == namespace }
            if nsIndex == nil {
                namespaces.append(Namespace(name: namespace, properties: []))
                nsIndex = namespaces.count - 1
            }
            guard let ns = nsIndex else { return false }
            var propertyIndex = namespaces[ns].properties.firstIndex { $0.name == property }
            if propertyIndex == nil {
                namespaces[ns].properties.append(Property(name: property, uris: []))
                propertyIndex = namespaces[ns].properties.count - 1
            }
            guard let index = propertyIndex else { return false }
            return Self.pushUnique(&namespaces[ns].properties[index].uris, uri)
        }

        private static func pushUnique(_ list: inout [String], _ value: String) -> Bool {
            if list.contains(value) { return false }
            list.append(value)
            return true
        }
    }

    /// Validate an AT URI for use as an AT Tags `content` value. Lenient
    /// about the record path (the proposal buckets by declared relation, not
    /// by URI shape) but strict enough to reject junk: the authority must
    /// look like a DID or a dotted handle.
    public static func isValidAtUri(_ uri: String?) -> Bool {
        guard let uri else { return false }
        let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("at://") else { return false }
        // `parseAtUri`'s authority: everything up to the first `/`, `?` or `#`.
        let repo = String(trimmed.dropFirst("at://".count).prefix { $0 != "/" && $0 != "?" && $0 != "#" })
        if repo.isEmpty { return false }
        return repo.wholeMatch(of: atTagsDidPattern) != nil || repo.wholeMatch(of: atTagsHandlePattern) != nil
    }

    /// Interpret a meta tag's `name` attribute. Nil for anything that is not
    /// a recognized AT Tag (no `at:` prefix, or an `at:` property that is
    /// neither standard nor namespaced, which the proposal says to ignore).
    ///
    /// The `at:` prefix and the standard relation keywords are matched in
    /// any case, but the namespace and property keep their own: a property
    /// name may be case-sensitive (`syndicatedBy`).
    public static func parseTagName(_ rawName: String?) -> TagName? {
        guard let rawName else { return nil }
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.lowercased().hasPrefix("at:") else { return nil }
        let rest = String(name.dropFirst(3))
        if rest.isEmpty { return nil }
        if let relation = Relation(rawValue: rest.lowercased()) {
            return .standard(relation)
        }
        // Namespaced: `at:{namespace}:{property}`. The namespace (an NSID-like
        // `standard.site`) has no colon; the property is everything after the
        // first colon. Both must be non-empty.
        guard let colon = rest.firstIndex(of: ":") else { return nil }
        let namespace = String(rest[rest.startIndex..<colon])
        let property = String(rest[rest.index(after: colon)...])
        if namespace.isEmpty || property.isEmpty { return nil }
        return .namespaced(namespace: namespace, property: property)
    }

    /// Parse `{ name, content }` pairs into structured AT Tags. Invalid AT
    /// URIs and unrecognized properties are dropped.
    public static func parse(_ entries: [(name: String?, content: String?)]) -> Result {
        var result = Result()
        for entry in entries {
            guard let parsedName = parseTagName(entry.name) else { continue }
            let raw = (entry.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard isValidAtUri(raw) else { continue }
            switch parsedName {
            case .standard(let relation):
                if result.add(raw, to: relation) {
                    result.tags.append(Tag(kind: parsedName, name: "at:\(relation.rawValue)", uri: raw))
                }
            case .namespaced(let namespace, let property):
                if result.add(raw, namespace: namespace, property: property) {
                    result.tags.append(Tag(kind: parsedName, name: "at:\(namespace):\(property)", uri: raw))
                }
            }
        }
        return result
    }

    /// The single record a result is "about", if it declares one:
    /// `at:canonical` first, then `at:alternate`. `at:author` and `at:me`
    /// name a bare DID, so routing to them would land on a profile when the
    /// question was about a page.
    public static func primaryRecord(_ result: Result) -> String? {
        result.canonical.first ?? result.alternate.first
    }

    /// Parse AT Tags out of raw HTML, without a DOM: the `name` and
    /// `content` of every `<meta>` tag, in any attribute order and quoting.
    /// The tag scan is bounded (see `PageCheckerHTML`), so a page of
    /// unclosed tags costs linear time.
    public static func parse(html: String) -> Result {
        if html.isEmpty { return Result() }
        let bytes = Array(html.utf8)
        var entries: [(name: String?, content: String?)] = []
        for tag in PageCheckerHTML.tags(named: "meta", in: bytes) {
            guard let name = PageCheckerHTML.attribute("name", in: tag) else { continue }
            let content = PageCheckerHTML.attribute("content", in: tag)
            let decodedName: String? = PageCheckerHTML.decodeEntities(name)
            let decodedContent: String? = content.map { PageCheckerHTML.decodeEntities($0) }
            entries.append((name: decodedName, content: decodedContent))
        }
        return parse(entries)
    }
}

/// `^did:[a-z]+:[A-Za-z0-9._:%-]+$`.
private let atTagsDidPattern = #/did:[a-z]+:[A-Za-z0-9._:%-]+/#
/// `^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$`.
private let atTagsHandlePattern = #/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+/#

// MARK: - Scanning HTML

/// The web's tag patterns, written as scanners over the page's bytes.
///
/// `atTags.ts` and `page.ts` find tags with `/<meta\b[^>]{0,2000}?>/gi` and
/// read attributes with
/// `\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\`=<>]+))`. The bound on the
/// tag body is what keeps the web's scan linear on a page of unclosed tags
/// (`'<meta '` repeated: 230 seconds unbounded, 1.4 bounded). These do the
/// same matching by hand and remember where the next `>` is, so each byte is
/// looked at a bounded number of times. Lengths are counted in bytes where
/// the web counts UTF-16 units; the two agree for the ASCII a tag is made of.
enum PageCheckerHTML {
    static func lower(_ byte: UInt8) -> UInt8 {
        byte >= 0x41 && byte <= 0x5A ? byte + 0x20 : byte
    }

    /// `\w` without the unicode flag: `[A-Za-z0-9_]`.
    static func isWord(_ byte: UInt8) -> Bool {
        (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || byte == 0x5F
    }

    /// `\s` for the bytes a tag is made of.
    static func isSpace(_ byte: UInt8) -> Bool {
        byte == 0x20 || (byte >= 0x09 && byte <= 0x0D)
    }

    private static func matches(_ bytes: [UInt8], at index: Int, _ needle: [UInt8]) -> Bool {
        guard index + needle.count <= bytes.count else { return false }
        for offset in 0..<needle.count where lower(bytes[index + offset]) != needle[offset] {
            return false
        }
        return true
    }

    /// Every `<name\b[^>]{0,maxBody}?>` in `bytes`, in order, as raw bytes.
    static func tags(named name: String, in bytes: [UInt8], maxBody: Int = 2000) -> [[UInt8]] {
        let needle = Array(("<" + name).utf8).map(lower)
        let count = bytes.count
        var out: [[UInt8]] = []
        var nextClose = -1
        var index = 0
        while index + needle.count <= count {
            guard bytes[index] == 0x3C, matches(bytes, at: index, needle) else {
                index += 1
                continue
            }
            let after = index + needle.count
            if after < count && isWord(bytes[after]) {
                index += 1
                continue
            }
            if nextClose < after {
                var probe = after
                while probe < count && bytes[probe] != 0x3E { probe += 1 }
                nextClose = probe
            }
            if nextClose < count && nextClose - after <= maxBody {
                out.append(Array(bytes[index...nextClose]))
                index = nextClose + 1
            } else {
                index += 1
            }
        }
        return out
    }

    /// The first `<title\b[^>]{0,200}>([^<]{0,1000})<\/title\s*>`: the text
    /// of the title element, undecoded.
    static func title(in bytes: [UInt8]) -> String? {
        let open = Array("<title".utf8)
        let close = Array("</title".utf8)
        let count = bytes.count
        var nextGreater = -1
        var nextLess = -1
        var index = 0
        while index + open.count <= count {
            guard bytes[index] == 0x3C, matches(bytes, at: index, open) else {
                index += 1
                continue
            }
            let after = index + open.count
            if after < count && isWord(bytes[after]) {
                index += 1
                continue
            }
            if nextGreater < after {
                var probe = after
                while probe < count && bytes[probe] != 0x3E { probe += 1 }
                nextGreater = probe
            }
            guard nextGreater < count, nextGreater - after <= 200 else {
                index += 1
                continue
            }
            let textStart = nextGreater + 1
            if nextLess < textStart {
                var probe = textStart
                while probe < count && bytes[probe] != 0x3C { probe += 1 }
                nextLess = probe
            }
            guard nextLess < count, nextLess - textStart <= 1000, matches(bytes, at: nextLess, close) else {
                index += 1
                continue
            }
            var end = nextLess + close.count
            while end < count && isSpace(bytes[end]) { end += 1 }
            guard end < count, bytes[end] == 0x3E else {
                index += 1
                continue
            }
            return String(decoding: bytes[textStart..<nextLess], as: UTF8.self)
        }
        return nil
    }

    /// The value of `name` in a tag: double-quoted, single-quoted or bare.
    static func attribute(_ name: String, in tag: [UInt8]) -> String? {
        let needle = Array(name.utf8).map(lower)
        let count = tag.count
        var index = 0
        while index + needle.count <= count {
            defer { index += 1 }
            if index > 0 && isWord(tag[index - 1]) { continue }
            guard matches(tag, at: index, needle) else { continue }
            var cursor = index + needle.count
            while cursor < count && isSpace(tag[cursor]) { cursor += 1 }
            guard cursor < count, tag[cursor] == 0x3D else { continue }
            cursor += 1
            while cursor < count && isSpace(tag[cursor]) { cursor += 1 }
            guard cursor < count else { continue }
            let first = tag[cursor]
            if first == 0x22 || first == 0x27 {
                var end = cursor + 1
                while end < count && tag[end] != first { end += 1 }
                guard end < count else { continue }
                return String(decoding: tag[(cursor + 1)..<end], as: UTF8.self)
            }
            var end = cursor
            while end < count && !isUnquotedStop(tag[end]) { end += 1 }
            guard end > cursor else { continue }
            return String(decoding: tag[cursor..<end], as: UTF8.self)
        }
        return nil
    }

    /// The bytes that end an unquoted value: `[\s"'\`=<>]`.
    private static func isUnquotedStop(_ byte: UInt8) -> Bool {
        isSpace(byte) || byte == 0x22 || byte == 0x27 || byte == 0x60 || byte == 0x3D || byte == 0x3C || byte == 0x3E
    }

    static func attribute(_ name: String, in tag: String) -> String? {
        attribute(name, in: Array(tag.utf8))
    }

    /// Decode the entities that realistically appear in an attribute.
    /// `&amp;` goes last, so `&amp;quot;` survives as the text `&quot;`.
    /// `nbsp` is the page checker's addition; the AT Tags parser leaves it.
    static func decodeEntities(_ input: String, nbsp: Bool = false) -> String {
        guard input.contains("&") else { return input }
        var out = replaceNumeric(input, hex: false)
        out = replaceNumeric(out, hex: true)
        var named: [(String, String)] = [("&quot;", "\""), ("&apos;", "'")]
        if nbsp { named.append(("&nbsp;", " ")) }
        named += [("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")]
        for (entity, text) in named {
            out = out.replacingOccurrences(of: entity, with: text, options: .caseInsensitive)
        }
        return out
    }

    /// `&#(\d+);` or, with `hex`, `&#x([0-9a-f]+);` (any case), replaced by
    /// the code point, or by nothing when it is not one.
    private static func replaceNumeric(_ input: String, hex: Bool) -> String {
        guard input.contains("&#") else { return input }
        let scalars = Array(input.unicodeScalars)
        var out = String.UnicodeScalarView()
        var index = 0
        while index < scalars.count {
            if scalars[index] == "&", index + 1 < scalars.count, scalars[index + 1] == "#" {
                var cursor = index + 2
                var marked = true
                if hex {
                    marked = cursor < scalars.count && (scalars[cursor] == "x" || scalars[cursor] == "X")
                    cursor += 1
                }
                let start = cursor
                if marked {
                    while cursor < scalars.count && isDigit(scalars[cursor], hex: hex) { cursor += 1 }
                }
                if marked, cursor > start, cursor < scalars.count, scalars[cursor] == ";" {
                    var digits = String.UnicodeScalarView()
                    digits.append(contentsOf: scalars[start..<cursor])
                    if let value = UInt32(String(digits), radix: hex ? 16 : 10), value <= 0x10FFFF, let scalar = Unicode.Scalar(value) {
                        out.append(scalar)
                    }
                    index = cursor + 1
                    continue
                }
            }
            out.append(scalars[index])
            index += 1
        }
        return String(out)
    }

    private static func isDigit(_ scalar: Unicode.Scalar, hex: Bool) -> Bool {
        switch scalar.value {
        case 0x30...0x39: return true
        case 0x41...0x46, 0x61...0x66: return hex
        default: return false
        }
    }
}
