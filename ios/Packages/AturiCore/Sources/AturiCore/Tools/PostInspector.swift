import Foundation

// Port of src/lib/tools/post.ts: the post inspector's logic, reading an
// `app.bsky.feed.post` record for the things an app does not show.
//
// Most of it is about facets. A facet marks a stretch of the text as a link,
// a mention or a tag, and says where the stretch is with two numbers,
// `byteStart` and `byteEnd`. Those count bytes of the text encoded as UTF-8.
// A client that takes its offsets from its own string type gets them right
// for plain ASCII and wrong after the first emoji or accented letter: every
// such character before the facet shifts it. That is the commonest bug in
// posts written by new clients, and the reason this file does its own byte
// arithmetic on `Array(text.utf8)` rather than slicing strings. A Swift
// `String.Index` is not a byte offset, and a `Character` is a grapheme, so
// nothing here indexes a `String` by the record's numbers.
//
// The web keeps a second set of offsets beside the bytes, UTF-16 indices,
// because that is how a JavaScript string is cut. They are kept here too
// (`FacetReading.utf16`): they are what the web's tests pin, they name the
// "counted in UTF-16 code units" mistake, and `utf16Slice` cuts a Swift
// string by them exactly.
//
// Everything here is pure. `PostInspectorModel` fetches the record, the
// AppView's view of it and the two gate records that can sit beside it,
// and hands them over.
//
// The limits come from the published lexicons (app.bsky.feed.post,
// app.bsky.richtext.facet), read when the web tool was written: 300
// graphemes and 3000 bytes of text, 3 languages, 8 tags of 64 graphemes
// each.

public enum PostInspector {
    public static let postCollection = "app.bsky.feed.post"
    public static let threadgateCollection = "app.bsky.feed.threadgate"
    public static let postgateCollection = "app.bsky.feed.postgate"

    public enum Limits {
        public static let graphemes = 300
        public static let bytes = 3000
        public static let langs = 3
        public static let tags = 8
        public static let tagGraphemes = 64
    }

    // MARK: - Input

    /// Where a post is, or why what was typed does not say.
    public enum Target: Hashable, Sendable {
        case post(authority: String, rkey: String)
        case problem(String)

        public var reason: String? {
            if case .problem(let reason) = self { return reason }
            return nil
        }
    }

    static func target(_ authority: String?, _ rkey: String?) -> Target {
        var clean = authority ?? ""
        if clean.hasPrefix("@") { clean.removeFirst() }
        guard !clean.isEmpty, let rkey, !rkey.isEmpty else {
            return .problem("A post\u{2019}s address needs an account and a record key.")
        }
        if rkey.wholeMatch(of: postRkeyPattern) == nil {
            return .problem("\"\(rkey)\" is not a valid record key.")
        }
        if clean.wholeMatch(of: postDidPattern) == nil && clean.wholeMatch(of: postHandlePattern) == nil {
            return .problem("\"\(clean)\" is not a handle or a DID.")
        }
        return .post(authority: clean.hasPrefix("did:") ? clean : clean.lowercased(), rkey: rkey)
    }

    /// Read what was pasted as a post's address: an at:// URI, or a link to
    /// the post in any client this app knows how to read (bsky.app and the
    /// apps that share its paths, the other explorers, aturi.to itself).
    public static func parseInput(_ raw: String) -> Target {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .problem("Enter a post link or at:// URI.") }

        if value.lowercased().hasPrefix("at://") {
            guard let parsed = reverseParseAtUri(value)?.parsed,
                let collection = parsed.collection, !collection.isEmpty,
                let rkey = parsed.rkey, !rkey.isEmpty
            else {
                return .problem("A post\u{2019}s URI has three parts: at://<account>/\(postCollection)/<key>.")
            }
            if collection != postCollection {
                return .problem("That is a \(collection) record. This tool reads \(postCollection) records.")
            }
            return target(parsed.handle, rkey)
        }

        let lowered = value.lowercased()
        let absolute = lowered.hasPrefix("http://") || lowered.hasPrefix("https://") ? value : "https://\(value)"
        guard let url = URL(string: absolute), let host = url.host, !host.isEmpty else {
            return .problem("That could not be read as a link or an at:// URI.")
        }
        let match = matchSupportedUrl(url)?.parsed
        if let match, match.collection == postCollection, let rkey = match.rkey, !rkey.isEmpty {
            return target(match.handle, rkey)
        }

        // Bluesky's path shape on a host this app has no entry for.
        let pathname = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
        let parts = pathname.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if parts.count >= 4, parts[0] == "profile", parts[2] == "post" {
            let account = parts[1]
                .replacingOccurrences(of: "%3A", with: ":")
                .replacingOccurrences(of: "%3a", with: ":")
            return target(account, parts[3])
        }
        if parts.count >= 3, parts[0] == "profile", parts[2] == "feed" {
            return .problem("That is a feed, not a post. The feed inspector reads feeds.")
        }
        if let collection = match?.collection, !collection.isEmpty {
            return .problem("That is a \(collection) record. This tool reads \(postCollection) records.")
        }
        return .problem("That link does not point at a post. A post link looks like bsky.app/profile/<account>/post/<key>.")
    }

    // MARK: - Text, three ways of counting it

    public static func utf8Length(_ text: String) -> Int {
        text.utf8.count
    }

    /// The text as the user-perceived characters the grapheme limit counts.
    public static func graphemes(_ text: String) -> [String] {
        text.map { String($0) }
    }

    public struct TextMeasure: Hashable, Sendable {
        public let bytes: Int
        public let utf16: Int
        public let graphemes: Int

        public init(bytes: Int, utf16: Int, graphemes: Int) {
            self.bytes = bytes
            self.utf16 = utf16
            self.graphemes = graphemes
        }
    }

    public static func measureText(_ text: String) -> TextMeasure {
        TextMeasure(bytes: text.utf8.count, utf16: text.utf16.count, graphemes: text.count)
    }

    /// Where each character starts, in both encodings: for every UTF-8 byte
    /// offset that begins a character (and the offset just past the end),
    /// the UTF-16 index of the same place; -1 for an offset inside a
    /// character.
    ///
    /// This is the table the rest needs. A facet's offsets are valid exactly
    /// when both land on entries that are not -1, and those entries are
    /// where to cut the text's UTF-16 units to get what the facet covers.
    public static func byteIndex(_ text: String) -> [Int] {
        var map = [Int](repeating: -1, count: text.utf8.count + 1)
        var byte = 0
        var unit = 0
        for scalar in text.unicodeScalars {
            map[byte] = unit
            byte += UTF8.width(scalar)
            unit += UTF16.width(scalar)
        }
        map[byte] = unit
        return map
    }

    /// The text between two UTF-16 indices. Both must lie on scalar
    /// boundaries, as every entry of `byteIndex` does.
    public static func utf16Slice(_ text: String, _ range: Range<Int>) -> String {
        let units = Array(text.utf16)
        let lower = Swift.max(0, Swift.min(range.lowerBound, units.count))
        let upper = Swift.max(lower, Swift.min(range.upperBound, units.count))
        return String(decoding: units[lower..<upper], as: UTF16.self)
    }

    /// The text between two byte offsets, or nil when either splits a
    /// character or lies outside the text.
    public static func sliceBytes(_ text: String, _ start: Int, _ end: Int, map: [Int]? = nil) -> String? {
        let map = map ?? byteIndex(text)
        if start < 0 || end < start || end >= map.count { return nil }
        let from = map[start]
        let to = map[end]
        if from < 0 || to < 0 { return nil }
        return utf16Slice(text, from..<to)
    }

    /// The bytes between two offsets decoded as they are, for showing what
    /// a broken range covers: a split character comes out as U+FFFD.
    public static func decodeBytes(_ text: String, _ start: Int, _ end: Int) -> String {
        let bytes = Array(text.utf8)
        let lower = Swift.min(Swift.max(0, start), bytes.count)
        let upper = Swift.max(0, Swift.min(end, bytes.count))
        guard lower < upper else { return "" }
        return String(decoding: bytes[lower..<upper], as: UTF8.self)
    }

    // MARK: - Facets

    public enum FacetFeature: Hashable, Sendable {
        case mention(did: String)
        case link(uri: String)
        case tag(String)
        case unknown(type: String)

        public var isUnknown: Bool {
            if case .unknown = self { return true }
            return false
        }

        /// The web's `FEATURE_WORD`.
        public var word: String {
            switch self {
            case .mention: return "Mention"
            case .link: return "Link"
            case .tag: return "Tag"
            case .unknown: return "Unknown"
            }
        }
    }

    public struct FacetProblem: Hashable, Sendable {
        public enum Level: String, Hashable, Sendable {
            /// The facet cannot be drawn as written.
            case error
            /// It can, but something is off.
            case warn
        }

        public enum Code: String, Hashable, Sendable {
            case shape, empty, range, boundary, overlap, units, feature
        }

        public let level: Level
        public let code: Code
        public let message: String

        public init(level: Level, code: Code, message: String) {
            self.level = level
            self.code = code
            self.message = message
        }
    }

    public struct FacetReading: Hashable, Sendable, Identifiable {
        /// Its place in the record's `facets` array, from 0.
        public let position: Int
        public let byteStart: Int?
        public let byteEnd: Int?
        public let features: [FacetFeature]
        /// The text the byte range covers. Nil when the range cannot be cut from the text.
        public let covered: String?
        /// The same range as UTF-16 indices, for marking up the text. Nil when it cannot be drawn.
        public let utf16: Range<Int>?
        public var problems: [FacetProblem]

        public var id: Int { position }

        public init(
            position: Int,
            byteStart: Int?,
            byteEnd: Int?,
            features: [FacetFeature],
            covered: String?,
            utf16: Range<Int>?,
            problems: [FacetProblem]
        ) {
            self.position = position
            self.byteStart = byteStart
            self.byteEnd = byteEnd
            self.features = features
            self.covered = covered
            self.utf16 = utf16
            self.problems = problems
        }

        /// A problem that stops the facet being drawn as written.
        public var isBroken: Bool {
            problems.contains { $0.level == .error }
        }
    }

    static func readFeature(_ raw: JSONValue) -> FacetFeature {
        let type = raw["$type"]?.stringValue ?? ""
        switch type {
        case "app.bsky.richtext.facet#mention": return .mention(did: plainString(raw["did"]))
        case "app.bsky.richtext.facet#link": return .link(uri: plainString(raw["uri"]))
        case "app.bsky.richtext.facet#tag": return .tag(plainString(raw["tag"]))
        default: return .unknown(type: type.isEmpty ? "no $type" : type)
        }
    }

    static func featureProblem(_ feature: FacetFeature) -> String? {
        switch feature {
        case .mention(let did):
            return did.wholeMatch(of: mentionDidPattern) != nil
                ? nil
                : "The mention has no DID. A mention points at an account by DID, not by handle."
        case .link(let uri):
            return isCompleteURL(uri)
                ? nil
                : "The link\u{2019}s uri is not a complete URL. It needs its scheme, such as https://."
        case .tag(let tag):
            if tag.isEmpty { return "The tag is empty." }
            return tag.count > Limits.tagGraphemes ? "The tag is longer than \(Limits.tagGraphemes) characters." : nil
        case .unknown:
            return nil
        }
    }

    /// What `new URL(uri)` accepts: a scheme, and a host for the web's own
    /// schemes. Foundation's `URL(string:)` takes relative references too,
    /// so the scheme is asked for by name.
    static func isCompleteURL(_ uri: String) -> Bool {
        guard let url = URL(string: uri), let scheme = url.scheme?.lowercased(), !scheme.isEmpty else { return false }
        if ["http", "https", "ws", "wss", "ftp"].contains(scheme) {
            return !(url.host ?? "").isEmpty
        }
        return true
    }

    enum Fit {
        case yes, no, unknown
    }

    /// Whether a stretch of text looks like what a feature marks: `yes`,
    /// `no`, or `unknown` when it could be either. A link can sit on any
    /// words at all, so only its obvious cases are judged; a mention and a
    /// tag carry their prefix.
    static func fits(_ covered: String, _ features: [FacetFeature]) -> Fit {
        guard let feature = features.first(where: { !$0.isUnknown }), !covered.isEmpty else {
            return covered.isEmpty ? .no : .unknown
        }
        switch feature {
        case .mention:
            return covered.wholeMatch(of: fitsMentionPattern) != nil ? .yes : .no
        case .tag:
            return covered.wholeMatch(of: fitsTagPattern) != nil ? .yes : .no
        case .link, .unknown:
            if covered != covered.trimmingCharacters(in: .whitespacesAndNewlines) { return .no }
            return covered.wholeMatch(of: fitsLinkPattern) != nil ? .yes : .unknown
        }
    }

    /// The other things a client might have counted in, most likely first.
    /// Each cuts the text at the same two numbers read in its own unit.
    private struct Unit {
        let name: String
        let cut: (Int, Int) -> String?
    }

    private static func otherUnits(_ text: String) -> [Unit] {
        let units = Array(text.utf16)
        let points = Array(text.unicodeScalars)
        let clusters = graphemes(text)
        func within(_ length: Int, _ start: Int, _ end: Int) -> Bool {
            start >= 0 && start < end && end <= length
        }
        return [
            Unit(name: "UTF-16 code units") { start, end in
                within(units.count, start, end) ? String(decoding: units[start..<end], as: UTF16.self) : nil
            },
            Unit(name: "code points") { start, end in
                guard within(points.count, start, end) else { return nil }
                var view = String.UnicodeScalarView()
                view.append(contentsOf: points[start..<end])
                return String(view)
            },
            Unit(name: "graphemes") { start, end in
                within(clusters.count, start, end) ? clusters[start..<end].joined() : nil
            },
        ]
    }

    /// A whole number, zero or more: what `byteStart` and `byteEnd` must be.
    static func wholeNumber(_ value: JSONValue?) -> Int? {
        guard case .number(let number)? = value, number.isFinite, number >= 0,
            number.rounded(.towardZero) == number
        else { return nil }
        return Int(exactly: number) ?? Int.max
    }

    /// Read a record's facets against its text: what each covers, whether
    /// it can be drawn, and what is wrong with it when it cannot.
    public static func readFacets(_ text: String, _ facets: JSONValue?) -> [FacetReading] {
        guard let list = facets?.arrayValue else { return [] }
        let map = byteIndex(text)
        let byteLength = map.count - 1
        let ascii = byteLength == text.utf16.count
        let units = ascii ? [] : otherUnits(text)

        var readings: [FacetReading] = []
        for (position, raw) in list.enumerated() {
            let features = raw["features"]?.arrayValue?.map(readFeature) ?? []
            var problems: [FacetProblem] = []

            guard let start = wholeNumber(raw["index"]?["byteStart"]), let end = wholeNumber(raw["index"]?["byteEnd"]) else {
                problems.append(FacetProblem(
                    level: .error,
                    code: .shape,
                    message: "The facet has no usable index. byteStart and byteEnd must both be whole numbers, zero or more."
                ))
                readings.append(FacetReading(
                    position: position, byteStart: nil, byteEnd: nil, features: features,
                    covered: nil, utf16: nil, problems: problems
                ))
                continue
            }

            var covered: String?
            var utf16: Range<Int>?
            if start >= end {
                problems.append(FacetProblem(
                    level: .error,
                    code: .empty,
                    message: start == end
                        ? "The range is empty: byteStart and byteEnd are the same."
                        : "The range runs backwards: byteStart is past byteEnd."
                ))
            } else if end > byteLength {
                problems.append(FacetProblem(
                    level: .error,
                    code: .range,
                    message: "The range runs past the end of the text, which is \(byteLength) bytes long."
                ))
            } else if map[start] < 0 || map[end] < 0 {
                let which = map[start] < 0 ? "byteStart" : "byteEnd"
                problems.append(FacetProblem(
                    level: .error,
                    code: .boundary,
                    message: "\(which) lands in the middle of a character, so the range cannot be cut from the text."
                ))
            } else {
                let range = map[start]..<map[end]
                covered = utf16Slice(text, range)
                utf16 = range
            }

            // Offsets counted in the wrong unit. Only worth asking when the
            // text is not plain ASCII (every unit agrees when it is) and the
            // bytes reading is broken or covers the wrong thing, and only
            // said when another unit would cover exactly what the feature
            // marks.
            var unitsSuspect = covered == nil
            if let covered, fits(covered, features) == .no { unitsSuspect = true }
            if !ascii && unitsSuspect {
                for unit in units {
                    guard let other = unit.cut(start, end), other != covered, fits(other, features) == .yes else { continue }
                    problems.append(FacetProblem(
                        level: .error,
                        code: .units,
                        message: "These offsets fit if they are counted in \(unit.name): they would cover \u{201C}\(other)\u{201D}. Facet offsets count UTF-8 bytes, so each character before the facet that is not plain ASCII moves it."
                    ))
                    break
                }
            }

            if features.isEmpty {
                problems.append(FacetProblem(
                    level: .warn,
                    code: .feature,
                    message: "The facet has no features, so it marks the text without saying what it is."
                ))
            }
            for feature in features {
                if let problem = featureProblem(feature) {
                    problems.append(FacetProblem(level: .warn, code: .feature, message: problem))
                }
            }
            readings.append(FacetReading(
                position: position, byteStart: start, byteEnd: end, features: features,
                covered: covered, utf16: utf16, problems: problems
            ))
        }

        // Overlaps, among the facets that can be drawn, in the order they
        // start (ties in the record's order, as a stable sort leaves them).
        let drawable = readings.indices
            .filter { readings[$0].utf16 != nil }
            .sorted { (readings[$0].byteStart ?? 0, $0) < (readings[$1].byteStart ?? 0, $1) }
        var last: Int?
        for index in drawable {
            if let previous = last, (readings[index].byteStart ?? 0) < (readings[previous].byteEnd ?? 0) {
                readings[index].problems.append(FacetProblem(
                    level: .warn,
                    code: .overlap,
                    message: "Overlaps facet \(readings[previous].position + 1), so the two cannot both be drawn."
                ))
                continue
            }
            last = index
        }
        return readings
    }

    public struct TextSegment: Hashable, Sendable {
        public let text: String
        /// The facet this stretch belongs to, by its place in the record's array; nil for plain text.
        public let facet: Int?

        public init(text: String, facet: Int?) {
            self.text = text
            self.facet = facet
        }
    }

    /// The text cut into plain stretches and facets, for marking it up.
    /// Overlapping and broken facets are left out.
    public static func segmentText(_ text: String, _ readings: [FacetReading]) -> [TextSegment] {
        let units = Array(text.utf16)
        func cut(_ from: Int, _ to: Int) -> String {
            String(decoding: units[from..<to], as: UTF16.self)
        }
        let drawable = readings
            .filter { reading in
                reading.utf16 != nil && !reading.problems.contains { problem in problem.code == .overlap }
            }
            .sorted { ($0.utf16?.lowerBound ?? 0, $0.position) < ($1.utf16?.lowerBound ?? 0, $1.position) }
        var segments: [TextSegment] = []
        var cursor = 0
        for reading in drawable {
            guard let range = reading.utf16, range.upperBound <= units.count else { continue }
            if range.lowerBound < cursor { continue }
            if range.lowerBound > cursor {
                segments.append(TextSegment(text: cut(cursor, range.lowerBound), facet: nil))
            }
            segments.append(TextSegment(text: cut(range.lowerBound, range.upperBound), facet: reading.position))
            cursor = range.upperBound
        }
        if cursor < units.count || segments.isEmpty {
            segments.append(TextSegment(text: cut(cursor, units.count), facet: nil))
        }
        return segments
    }

    public struct LooseToken: Hashable, Sendable {
        public enum Kind: String, Hashable, Sendable {
            case link, mention, tag
        }

        public let kind: Kind
        public let text: String

        public init(kind: Kind, text: String) {
            self.kind = kind
            self.text = text
        }
    }

    /// `[.,;:!?)\]}'"’”]+$`: what a sentence leaves on the end of a token.
    static let trailingPunctuation: Set<Character> = [".", ",", ";", ":", "!", "?", ")", "]", "}", "'", "\"", "\u{2019}", "\u{201D}"]

    /// Things in the text that read as a link, a mention or a tag and have
    /// no facet over them. An app shows these as plain text: the facet is
    /// what makes a link a link.
    public static func looseTokens(_ text: String, _ readings: [FacetReading]) -> [LooseToken] {
        let covered = readings.compactMap { $0.utf16 }
        func free(_ from: Int, _ to: Int) -> Bool {
            !covered.contains { range in from < range.upperBound && to > range.lowerBound }
        }
        var found: [LooseToken] = []
        func scan(_ kind: LooseToken.Kind, _ pattern: Regex<(Substring, Substring, Substring)>) {
            for match in text.matches(of: pattern) {
                var token = String(match.output.2)
                while let tail = token.last, trailingPunctuation.contains(tail) {
                    token.removeLast()
                }
                let from = match.output.2.startIndex.utf16Offset(in: text)
                let length = token.utf16.count
                if length > 1 && free(from, from + length) {
                    found.append(LooseToken(kind: kind, text: token))
                }
            }
        }
        scan(.link, looseLinkPattern)
        scan(.mention, looseMentionPattern)
        // A tag needs something that is not a digit after its sign: "#1" is a number.
        scan(.tag, looseTagPattern)
        return found
    }

    // MARK: - Timestamps

    /// How far apart two of a post's times can be before it is worth saying.
    static let timeTolerance: TimeInterval = 5 * 60

    /// A span in the largest unit that fits: "8 years", "2 minutes".
    public static func formatSpan(_ seconds: TimeInterval) -> String {
        let milliseconds = abs(seconds * 1000)
        let units: [(Double, String)] = [
            (365 * 86_400_000, "year"),
            (30 * 86_400_000, "month"),
            (86_400_000, "day"),
            (3_600_000, "hour"),
            (60_000, "minute"),
        ]
        for (size, name) in units where milliseconds >= size {
            let n = Int((milliseconds / size).rounded())
            return "\(n) \(name)\(n == 1 ? "" : "s")"
        }
        let whole = Swift.max(1, Int((milliseconds / 1000).rounded()))
        return "\(whole) second\(whole == 1 ? "" : "s")"
    }

    public struct TimeNote: Hashable, Sendable {
        public enum Level: String, Hashable, Sendable {
            /// Something about the record itself.
            case warn
            /// Only about when Bluesky got to it.
            case info
        }

        public let level: Level
        public let message: String

        public init(level: Level, message: String) {
            self.level = level
            self.message = message
        }
    }

    public struct PostTimes: Hashable, Sendable {
        /// What the client said, as written and as a date.
        public let createdAtRaw: String?
        public let createdAt: Date?
        /// When the record was written, from its record key. Nil when the key is not a TID.
        public let keyTime: Date?
        /// When the AppView indexed it.
        public let indexedAt: Date?
        /// What is worth saying about how they compare. Empty when they agree.
        public let notes: [TimeNote]
    }

    static func toDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return Formatting.isoDate(value)
    }

    /// Compare the three times a post has. `createdAt` is whatever the
    /// client put there and can be any date. The record key is a TID,
    /// minted when the record was written, so it is the nearest thing to
    /// when the post was really made.
    public static func readTimes(createdAt raw: JSONValue?, rkey: String, indexedAt: String? = nil) -> PostTimes {
        let createdAtText = raw?.stringValue
        let createdAt = toDate(createdAtText)
        let keyTime = TID.date(from: rkey)
        let indexed = toDate(indexedAt)
        var notes: [TimeNote] = []

        if createdAt == nil {
            if let createdAtText {
                notes.append(TimeNote(level: .warn, message: "createdAt is \u{201C}\(createdAtText)\u{201D}, which is not a date."))
            } else {
                notes.append(TimeNote(level: .warn, message: "The record has no createdAt, which the lexicon requires."))
            }
        }
        if keyTime == nil {
            notes.append(TimeNote(level: .warn, message: "The record key is not a TID, so it carries no time of its own."))
        }
        if let createdAt, let keyTime {
            let gap = createdAt.timeIntervalSince(keyTime)
            if gap < -timeTolerance {
                notes.append(TimeNote(
                    level: .warn,
                    message: "createdAt is \(formatSpan(gap)) earlier than the record key, which is set when the record is written. The post was backdated, or imported from somewhere else."
                ))
            } else if gap > timeTolerance {
                notes.append(TimeNote(
                    level: .warn,
                    message: "createdAt is \(formatSpan(gap)) later than the record key. The client\u{2019}s clock was ahead, or the date was set by hand."
                ))
            }
        }
        if let indexed, let written = keyTime ?? createdAt, indexed.timeIntervalSince(written) > timeTolerance {
            notes.append(TimeNote(
                level: .info,
                message: "Bluesky indexed the post \(formatSpan(indexed.timeIntervalSince(written))) after it was written."
            ))
        }
        return PostTimes(createdAtRaw: createdAtText, createdAt: createdAt, keyTime: keyTime, indexedAt: indexed, notes: notes)
    }

    // MARK: - Gates, embeds, labels

    static func list(_ items: [String]) -> String {
        if items.count <= 1 { return items.joined() }
        return "\(items.dropLast().joined(separator: ", ")) and \(items[items.count - 1])"
    }

    static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0).inserted }
    }

    static func typeName(_ value: JSONValue?) -> String {
        value?["$type"]?.stringValue ?? ""
    }

    /// `String(value ?? '')`: absent and null read as nothing.
    static func plainString(_ value: JSONValue?) -> String {
        guard let value, !value.isNull else { return "" }
        return RecordValidator.jsString(value)
    }

    public struct GateReading: Hashable, Sendable {
        public let summary: String
        public let detail: [String]

        public init(summary: String, detail: [String]) {
            self.summary = summary
            self.detail = detail
        }
    }

    /// A threadgate record in words: who may reply, and how many replies the author has hidden.
    public static func describeThreadgate(_ value: [String: JSONValue]) -> GateReading {
        var detail: [String] = []
        var summary: String
        if let allow = value["allow"]?.arrayValue {
            if allow.isEmpty {
                summary = "Nobody can reply."
            } else {
                var who: [String] = []
                for rule in allow {
                    let type = typeName(rule)
                    if type.hasSuffix("#mentionRule") {
                        who.append("accounts mentioned in the post")
                    } else if type.hasSuffix("#followerRule") {
                        who.append("accounts that follow the author")
                    } else if type.hasSuffix("#followingRule") {
                        who.append("accounts the author follows")
                    } else if type.hasSuffix("#listRule") {
                        detail.append("list \(plainString(rule["list"]))")
                        who.append("accounts on a list")
                    } else {
                        who.append(type.isEmpty ? "an unrecognised rule" : "an unrecognised rule (\(type))")
                    }
                }
                summary = "Replies are limited to \(list(unique(who)))."
            }
        } else {
            summary = "Anyone can reply. The record sets no rule."
        }
        let hidden = value["hiddenReplies"]?.arrayValue?.count ?? 0
        if hidden > 0 {
            summary += " The author has hidden \(hidden) \(hidden == 1 ? "reply" : "replies")."
        }
        return GateReading(summary: summary, detail: detail)
    }

    /// A postgate record in words: whether the post can be quoted, and the quotes it was detached from.
    public static func describePostgate(_ value: [String: JSONValue]) -> GateReading {
        let rules = value["embeddingRules"]?.arrayValue ?? []
        let disabled = rules.contains { typeName($0).hasSuffix("#disableRule") }
        let detached = value["detachedEmbeddingUris"]?.arrayValue ?? []
        var summary = disabled ? "Quoting is turned off for this post." : "Anyone can quote this post. The record sets no rule."
        if !detached.isEmpty {
            summary += " The author has detached it from \(detached.count) \(detached.count == 1 ? "quote" : "quotes")."
        }
        return GateReading(summary: summary, detail: detached.prefix(5).map { "detached from \(RecordValidator.jsString($0))" })
    }

    static let recordNames: [String: String] = [
        "app.bsky.feed.post": "a post",
        "app.bsky.feed.generator": "a feed",
        "app.bsky.graph.list": "a list",
        "app.bsky.graph.starterpack": "a starter pack",
        "app.bsky.labeler.service": "a labeler",
    ]

    static func quoted(_ embed: JSONValue?) -> (uri: String, what: String)? {
        guard let uri = embed?["record"]?["uri"]?.stringValue else { return nil }
        let parts = uri.components(separatedBy: "/")
        let collection = parts.count > 3 ? parts[3] : ""
        return (uri, recordNames[collection] ?? "a \(collection.isEmpty ? "record" : collection)")
    }

    static func hasText(_ value: JSONValue?) -> Bool {
        guard let text = value?.stringValue else { return false }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func describeMedia(_ embed: JSONValue?) -> GateReading? {
        let type = typeName(embed)
        if type == "app.bsky.embed.images" {
            let images = embed?["images"]?.arrayValue ?? []
            let described = images.filter { hasText($0["alt"]) }.count
            let count = "\(images.count) \(images.count == 1 ? "image" : "images")"
            let summary = described == images.count
                ? "\(count), \(images.count == 1 ? "with" : "all with") alt text."
                : "\(count), \(described) of them with alt text."
            return GateReading(summary: summary, detail: [])
        }
        if type == "app.bsky.embed.video" {
            return GateReading(summary: "A video, \(hasText(embed?["alt"]) ? "with" : "without") alt text.", detail: [])
        }
        if type == "app.bsky.embed.external" {
            let external = embed?["external"]
            var summary = "A link card"
            if let title = external?["title"]?.stringValue, !title.isEmpty {
                summary += " titled \u{201C}\(title)\u{201D}"
            }
            summary += "."
            var detail: [String] = []
            if let uri = external?["uri"]?.stringValue {
                detail = [uri]
            }
            return GateReading(summary: summary, detail: detail)
        }
        return nil
    }

    /// A post's embed in words. Nil when it has none.
    public static func describeEmbed(_ embed: JSONValue?) -> GateReading? {
        let type = typeName(embed)
        if type.isEmpty { return nil }
        if type == "app.bsky.embed.record" {
            if let quote = quoted(embed) {
                return GateReading(summary: "Quotes \(quote.what).", detail: [quote.uri])
            }
            return GateReading(summary: "A record embed that names no record.", detail: [])
        }
        if type == "app.bsky.embed.recordWithMedia" {
            let quote = quoted(embed?["record"])
            let media = describeMedia(embed?["media"])
            let mediaText = media?.summary ?? typeName(embed?["media"])
            var detail: [String] = []
            if let quote { detail.append(quote.uri) }
            detail.append(contentsOf: media?.detail ?? [])
            return GateReading(summary: "Quotes \(quote?.what ?? "a record"), with media: \(mediaText)", detail: detail)
        }
        return describeMedia(embed)
            ?? GateReading(summary: "An embed of a type this tool does not read (\(type)).", detail: [])
    }

    /// The labels the author put on the record itself.
    public static func selfLabels(_ record: [String: JSONValue]) -> [String] {
        guard let values = record["labels"]?["values"]?.arrayValue else { return [] }
        return values.map { plainString($0["val"]) }.filter { !$0.isEmpty }
    }

    // MARK: - Findings

    public enum GateProbe: Hashable, Sendable {
        case found(uri: String, value: [String: JSONValue])
        /// There is no such record: the post has no rule.
        case absent
        /// The lookup failed, which says nothing about whether the record exists.
        case error
    }

    /// A label the AppView reports on the post.
    public struct AppliedLabel: Hashable, Sendable {
        public let val: String?
        public let src: String?
        public let neg: Bool

        public init(val: String?, src: String?, neg: Bool = false) {
            self.val = val
            self.src = src
            self.neg = neg
        }
    }

    /// The part of the AppView's view of the post the findings read.
    public struct AppViewPost: Hashable, Sendable {
        public let indexedAt: String?
        public let labels: [AppliedLabel]

        public init(indexedAt: String? = nil, labels: [AppliedLabel] = []) {
            self.indexedAt = indexedAt
            self.labels = labels
        }

        /// From a `getPosts` view's JSON.
        public init(json: JSONValue) {
            let indexed = json["indexedAt"]?.stringValue
            indexedAt = (indexed?.isEmpty ?? true) ? nil : indexed
            labels = (json["labels"]?.arrayValue ?? []).map { label in
                AppliedLabel(
                    val: label["val"]?.stringValue,
                    src: label["src"]?.stringValue,
                    neg: label["neg"]?.boolValue ?? false
                )
            }
        }
    }

    public enum AppViewState: Hashable, Sendable {
        case found(AppViewPost)
        /// The AppView has no view of the post.
        case missing
    }

    public enum FindingStatus: String, Hashable, Sendable {
        case pass, warn, fail, info, pending
    }

    public enum FindingID: String, Hashable, Sendable {
        case length, facets, times, reply, threadgate, postgate, embed, langs, labels
    }

    public struct Finding: Hashable, Sendable, Identifiable {
        public let id: FindingID
        public let status: FindingStatus
        public let title: String
        public let summary: String
        public let detail: [String]?

        public init(id: FindingID, status: FindingStatus, title: String, summary: String, detail: [String]? = nil) {
            self.id = id
            self.status = status
            self.title = title
            self.summary = summary
            self.detail = detail
        }
    }

    /// What has been fetched so far. `view`, `threadgate` and `postgate`
    /// are nil while on their way.
    public struct Evidence: Hashable, Sendable {
        /// The post's address, with the account as a DID.
        public var uri: String
        public var rkey: String
        public var record: [String: JSONValue]
        public var view: AppViewState?
        public var threadgate: GateProbe?
        public var postgate: GateProbe?

        public init(
            uri: String,
            rkey: String,
            record: [String: JSONValue],
            view: AppViewState? = nil,
            threadgate: GateProbe? = nil,
            postgate: GateProbe? = nil
        ) {
            self.uri = uri
            self.rkey = rkey
            self.record = record
            self.view = view
            self.threadgate = threadgate
            self.postgate = postgate
        }

        /// The record's text, or "" when it has none.
        public var text: String {
            record["text"]?.stringValue ?? ""
        }
    }

    static func grouped(_ n: Int) -> String {
        LexiconPublishing.grouped(n)
    }

    static func count(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(grouped(n)) \(n == 1 ? one : (many ?? one + "s"))"
    }

    /// JavaScript truthiness of a field, for `record.embed` and the like.
    static func truthy(_ value: JSONValue?) -> Bool {
        guard let value else { return false }
        switch value {
        case .null: return false
        case .bool(let flag): return flag
        case .number(let number): return number != 0 && !number.isNaN
        case .string(let text): return !text.isEmpty
        case .array, .object: return true
        }
    }

    struct ReplyRef {
        let root: String?
        let parent: String?
    }

    static func replyRef(_ record: [String: JSONValue]) -> ReplyRef? {
        guard let reply = record["reply"] else { return nil }
        switch reply {
        case .object, .array:
            return ReplyRef(root: reply["root"]?["uri"]?.stringValue, parent: reply["parent"]?["uri"]?.stringValue)
        default:
            return nil
        }
    }

    /// The post a thread's reply rules hang off: the root for a reply, the post itself otherwise.
    public static func threadRoot(uri: String, record: [String: JSONValue]) -> String {
        replyRef(record)?.root ?? uri
    }

    /// The address of a gate record for a post: same repository, same record key.
    public static func gateUri(_ postUri: String, collection: String) -> String? {
        let parts = postUri.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let did = parts.first ?? ""
        let rkey = parts.count > 2 ? parts[2] : ""
        return !did.isEmpty && !rkey.isEmpty ? "at://\(did)/\(collection)/\(rkey)" : nil
    }

    static func facetsFinding(_ text: String, _ readings: [FacetReading]) -> Finding {
        let title = "Facets"
        let loose = looseTokens(text, readings)
        var looseNote = ""
        if !loose.isEmpty {
            let one = loose.count == 1
            let kinds = list(unique(loose.map { $0.kind.rawValue }))
            looseNote = " \(count(loose.count, "thing")) in the text \(one ? "reads" : "read") as a \(kinds) but \(one ? "has" : "have") no facet, so apps show \(one ? "it" : "them") as plain text."
        }
        let looseDetail = loose.prefix(6).map { "no facet over \($0.text)" }
        if readings.isEmpty {
            return Finding(
                id: .facets,
                status: loose.isEmpty ? .info : .warn,
                title: title,
                summary: "No facets: nothing in the text is marked as a link, a mention or a tag.\(looseNote)",
                detail: looseDetail.isEmpty ? nil : looseDetail
            )
        }
        let broken = readings.filter { $0.isBroken }
        let doubtful = readings.filter { !$0.isBroken && !$0.problems.isEmpty }
        if !broken.isEmpty {
            let lines = broken.map { reading -> String in
                let message = reading.problems.first(where: { $0.level == .error })?.message ?? ""
                return "facet \(reading.position + 1): \(message)"
            }
            return Finding(
                id: .facets,
                status: .fail,
                title: title,
                summary: "\(broken.count) of \(count(readings.count, "facet")) \(broken.count == 1 ? "does" : "do") not fit the text.\(looseNote)",
                detail: lines + looseDetail
            )
        }
        if !doubtful.isEmpty || !loose.isEmpty {
            let lookAt = doubtful.isEmpty ? "" : ", with \(count(doubtful.count, "thing")) to look at"
            let lines = doubtful.map { "facet \($0.position + 1): \($0.problems[0].message)" }
            return Finding(
                id: .facets,
                status: .warn,
                title: title,
                summary: "\(count(readings.count, "facet")), all inside the text and on character boundaries\(lookAt).\(looseNote)",
                detail: lines + looseDetail
            )
        }
        return Finding(
            id: .facets,
            status: .pass,
            title: title,
            summary: "\(count(readings.count, "facet")), all inside the text and on character boundaries."
        )
    }

    static func gateFinding(
        _ id: FindingID,
        _ title: String,
        _ probe: GateProbe?,
        open: String,
        describe: ([String: JSONValue]) -> GateReading,
        prefix: String = ""
    ) -> Finding {
        guard let probe else { return Finding(id: id, status: .pending, title: title, summary: "Checking\u{2026}") }
        switch probe {
        case .error:
            return Finding(id: id, status: .info, title: title, summary: "The rule record could not be looked up, so this is not known.")
        case .absent:
            return Finding(id: id, status: .info, title: title, summary: "\(prefix)\(open)")
        case .found(let uri, let value):
            let reading = describe(value)
            return Finding(id: id, status: .info, title: title, summary: "\(prefix)\(reading.summary)", detail: [uri] + reading.detail)
        }
    }

    /// Everything the record says, as a list of findings.
    public static func buildFindings(_ evidence: Evidence) -> [Finding] {
        let record = evidence.record
        let text = evidence.text
        let measure = measureText(text)
        let readings = readFacets(text, record["facets"])
        var findings: [Finding] = []

        // ── Length ──
        let over = measure.graphemes > Limits.graphemes || measure.bytes > Limits.bytes
        let lengthDetail = [
            "\(measure.graphemes) graphemes of \(Limits.graphemes)",
            "\(measure.bytes) UTF-8 bytes of \(Limits.bytes)",
            "\(measure.utf16) UTF-16 code units",
        ]
        let hasEmbed = truthy(record["embed"])
        if record["text"]?.stringValue == nil {
            findings.append(Finding(
                id: .length,
                status: .fail,
                title: "Text",
                summary: "The record has no text field, which the lexicon requires. A post with only an embed still carries an empty string."
            ))
        } else if over {
            findings.append(Finding(
                id: .length,
                status: .fail,
                title: "Text",
                summary: "The text is over the limit of \(Limits.graphemes) graphemes and \(Limits.bytes) bytes.",
                detail: lengthDetail
            ))
        } else {
            let summary: String
            if text.isEmpty {
                summary = hasEmbed
                    ? "The text is empty, which is fine for a post that is only an embed."
                    : "The text is empty and there is no embed, so the post shows nothing."
            } else {
                summary = "\(count(measure.graphemes, "grapheme")) of \(Limits.graphemes) and \(count(measure.bytes, "byte")) of \(grouped(Limits.bytes))."
            }
            findings.append(Finding(
                id: .length,
                status: text.isEmpty && !hasEmbed ? .warn : .pass,
                title: "Text",
                summary: summary,
                detail: lengthDetail
            ))
        }

        findings.append(facetsFinding(text, readings))

        // ── Timestamps ──
        var indexedAt: String?
        if case .found(let view)? = evidence.view {
            indexedAt = view.indexedAt
        }
        let times = readTimes(createdAt: record["createdAt"], rkey: evidence.rkey, indexedAt: indexedAt)
        var timeDetail = [
            "createdAt   \(times.createdAtRaw ?? "missing")",
            "record key  \(times.keyTime.map(Formatting.isoTimestamp) ?? "not a TID")",
        ]
        if evidence.view != nil {
            timeDetail.append("indexedAt   \(times.indexedAt.map(Formatting.isoTimestamp) ?? "not indexed")")
        }
        let timeWarnings = times.notes.filter { $0.level == .warn }
        var timeLines: [String] = []
        if timeWarnings.isEmpty {
            timeLines.append("createdAt and the time in the record key agree to within a few minutes.")
        }
        timeLines.append(contentsOf: times.notes.map { $0.message })
        let timeStatus: FindingStatus
        if times.createdAt == nil {
            timeStatus = .fail
        } else if !timeWarnings.isEmpty {
            timeStatus = .warn
        } else {
            timeStatus = .pass
        }
        findings.append(Finding(
            id: .times,
            status: timeStatus,
            title: "Timestamps",
            summary: timeLines.joined(separator: " "),
            detail: timeDetail
        ))

        // ── Reply ──
        let reply = replyRef(record)
        if let reply {
            let root = reply.root ?? ""
            let parent = reply.parent ?? ""
            if root.isEmpty || parent.isEmpty {
                findings.append(Finding(
                    id: .reply,
                    status: .fail,
                    title: "Thread",
                    summary: "The reply names no \(parent.isEmpty ? "parent" : "root"). A reply has to point at both the post it answers and the thread\u{2019}s first post."
                ))
            } else {
                findings.append(Finding(
                    id: .reply,
                    status: .info,
                    title: "Thread",
                    summary: root == parent
                        ? "A reply to the first post of its thread."
                        : "A reply to a reply, further down its thread.",
                    detail: ["parent \(parent)", "root   \(root)"]
                ))
            }
        } else {
            findings.append(Finding(id: .reply, status: .info, title: "Thread", summary: "Not a reply. This post starts its own thread."))
        }

        // ── Who can reply, who can quote ──
        findings.append(gateFinding(
            .threadgate,
            "Who can reply",
            evidence.threadgate,
            open: "Anyone can reply. There is no threadgate record.",
            describe: describeThreadgate,
            prefix: reply == nil ? "" : "Set on the thread\u{2019}s first post: "
        ))
        findings.append(gateFinding(
            .postgate,
            "Who can quote",
            evidence.postgate,
            open: "Anyone can quote this post. There is no postgate record.",
            describe: describePostgate
        ))

        // ── Embed ──
        let embed = describeEmbed(record["embed"])
        findings.append(Finding(
            id: .embed,
            status: .info,
            title: "Embed",
            summary: embed?.summary ?? "No embed.",
            detail: (embed?.detail.isEmpty ?? true) ? nil : embed?.detail
        ))

        // ── Languages and tags ──
        let langs = (record["langs"]?.arrayValue ?? []).map { RecordValidator.jsString($0) }
        let tags = (record["tags"]?.arrayValue ?? []).map { RecordValidator.jsString($0) }
        let tooMany = langs.count > Limits.langs || tags.count > Limits.tags
        let langText = langs.isEmpty ? "No language is set." : "Marked as \(list(langs))."
        let tagText = tags.isEmpty ? "No tags outside the text." : "\(count(tags.count, "tag")) outside the text: \(list(tags))."
        let limitText = tooMany ? " The lexicon allows \(Limits.langs) languages and \(Limits.tags) tags." : ""
        findings.append(Finding(
            id: .langs,
            status: tooMany ? .fail : .info,
            title: "Languages and tags",
            summary: "\(langText) \(tagText)\(limitText)"
        ))

        // ── Labels ──
        let own = selfLabels(record)
        if let view = evidence.view {
            var applied: [AppliedLabel] = []
            if case .found(let post) = view {
                applied = post.labels.filter { label in
                    guard let val = label.val, !val.isEmpty else { return false }
                    return !label.neg && !own.contains(val)
                }
            }
            let ownText = own.isEmpty ? "No self-labels." : "The author labelled it \(list(own))."
            let appViewText: String
            if view == .missing {
                appViewText = "Bluesky\u{2019}s AppView has no view of the post, so its labels are not known."
            } else if applied.isEmpty {
                appViewText = "Bluesky\u{2019}s AppView shows none from its default labelers."
            } else {
                let values = applied.map { label in label.val ?? "" }
                appViewText = "Bluesky\u{2019}s AppView shows \(count(applied.count, "label")) from labelers: \(list(values))."
            }
            let lines = applied.map { label -> String in
                let source = label.src ?? "an unnamed labeler"
                return "\(label.val ?? "") from \(source)"
            }
            findings.append(Finding(
                id: .labels,
                status: .info,
                title: "Labels",
                summary: "\(ownText) \(appViewText)",
                detail: lines.isEmpty ? nil : lines
            ))
        } else {
            findings.append(Finding(id: .labels, status: .pending, title: "Labels", summary: "Checking\u{2026}"))
        }

        return findings
    }

    public struct Verdict: Hashable, Sendable {
        public enum Tone: String, Hashable, Sendable {
            case pass, warn, fail, pending
        }

        public let tone: Tone
        public let title: String
        public let text: String

        public init(tone: Tone, title: String, text: String) {
            self.tone = tone
            self.title = title
            self.text = text
        }
    }

    /// The one-line answer above the findings.
    public static func verdict(_ findings: [Finding]) -> Verdict {
        let failed = findings.filter { $0.status == .fail }
        if let first = failed.first {
            let problems = failed.count == 1 ? "a problem" : "\(failed.count) problems"
            return Verdict(tone: .fail, title: "This record has \(problems)", text: first.summary)
        }
        if findings.contains(where: { $0.status == .pending }) {
            return Verdict(
                tone: .pending,
                title: "Reading the record",
                text: "Looking up the AppView\u{2019}s view and the reply and quote rules."
            )
        }
        let warned = findings.filter { $0.status == .warn }
        if let first = warned.first {
            let things = warned.count == 1 ? "one thing" : "\(warned.count) things"
            return Verdict(tone: .warn, title: "This record reads cleanly, with \(things) to look at", text: first.summary)
        }
        let facets = findings.first { $0.id == .facets }
        return Verdict(
            tone: .pass,
            title: "This record reads cleanly",
            text: facets?.status == .pass
                ? "Every facet lines up with the text, the text is inside its limits, and the timestamps agree."
                : "The text is inside its limits and the timestamps agree."
        )
    }
}

// MARK: - Fetching

/// The reads the post inspector makes, port of the fetches in
/// PostInspector.tsx: the record from Slingshot or its own PDS, the
/// AppView's view of it, and the two gate records beside it.
public struct PostInspectorClient: Sendable {
    public enum Failure: Error, Equatable, Sendable {
        case message(String)

        public var text: String {
            switch self {
            case .message(let text): return text
            }
        }
    }

    private let http: HTTPClient
    private let slingshot: SlingshotClient
    private let pds: PDSClient
    private let appView: AppViewClient

    public init(http: HTTPClient = .shared) {
        self.http = http
        slingshot = SlingshotClient(http: http)
        pds = PDSClient(http: http)
        appView = AppViewClient(client: http)
    }

    /// The post's record. The cache misses on brand-new records and unusual
    /// hosts, and cannot say a record is gone; the repository's own PDS can.
    public func fetchRecord(authority: String, rkey: String) async -> Result<FetchedRecord, Failure> {
        let asked = "at://\(authority)/\(PostInspector.postCollection)/\(rkey)"
        if let cached = await slingshot.getRecordByUri(asked) {
            return .success(FetchedRecord(uri: cached.uri.isEmpty ? asked : cached.uri, cid: cached.cid, value: cached.value))
        }
        guard let identity = await slingshot.resolveMiniDoc(authority) else {
            return .failure(.message("\(authority) did not resolve to an account."))
        }
        do {
            let record = try await pds.getRecord(
                pds: identity.pds,
                repo: identity.did,
                collection: PostInspector.postCollection,
                rkey: rkey
            )
            let uri = record.uri.isEmpty ? "at://\(identity.did)/\(PostInspector.postCollection)/\(rkey)" : record.uri
            return .success(FetchedRecord(uri: uri, cid: record.cid, value: record.value))
        } catch let error as HTTPError where error.status == 400 || error.status == 404 {
            return .failure(.message("There is no post at this address. It may have been deleted."))
        } catch {
            return .failure(.message("The post could not be read: its PDS did not answer."))
        }
    }

    /// The AppView's view of the post, nil when it has none.
    public func fetchView(uri: String) async -> BskyPost? {
        await appView.getPosts([uri])?.first
    }

    /// A gate record, read from Slingshot with its answer kept apart: "there
    /// is no such record" is the ordinary case and means the post has no
    /// rule, while a failed lookup means nothing is known. The shared client
    /// folds both into nil, which is right for hydrating a list and wrong
    /// here.
    public func readGate(_ uri: String?) async -> PostInspector.GateProbe {
        guard let uri else { return .absent }
        let url = makeURL(Endpoints.slingshot, path: "/xrpc/blue.microcosm.repo.getRecordByUri", query: [("at_uri", uri)])
        do {
            let body = try await http.getJSONValue(from: url)
            if let value = body["value"]?.objectValue {
                return .found(uri: body["uri"]?.stringValue ?? uri, value: value)
            }
            return .absent
        } catch let error as HTTPError {
            return error.status == 400 || error.status == 404 ? .absent : .error
        } catch {
            return .error
        }
    }
}

// MARK: - Patterns (post.ts)

private let postRkeyPattern = #/[A-Za-z0-9._:~-]{1,512}/#
private let postDidPattern = #/did:[a-z]+:[A-Za-z0-9._:%-]+/#
private let postHandlePattern = #/(?:[a-z0-9-]+\.)+[a-z0-9-]+/#.ignoresCase()
private let mentionDidPattern = #/did:[a-z]+:\S+/#
private let fitsMentionPattern = #/@[^\s@]+/#
private let fitsTagPattern = #/[#＃]\S+/#
private let fitsLinkPattern = #/(?:https?://)?[^\s/@]+\.[^\s]+/#.ignoresCase()
private let looseLinkPattern = #/(^|\s|\()(https?://[^\s]+)/#.ignoresCase()
private let looseMentionPattern = #/(^|\s|\()(@(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*)/#.ignoresCase()
private let looseTagPattern = #/(^|\s)([#＃](?=[^\s#＃]*[^0-9\s\p{P}])[^\s#＃]+)/#
