import Foundation
import XCTest
@testable import AturiCore

/// Port of src/lib/tools/__tests__/post.test.ts, plus the client and the
/// screen model, which the web has no tests for. `formatSpan` takes
/// seconds here, a `TimeInterval`, where the web's takes milliseconds.
final class PostInspectorTests: XCTestCase {
    private typealias P = PostInspector

    private static let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
    private static let rkey = "3mzebbdw64s27"
    private static let uri = "at://\(did)/app.bsky.feed.post/\(rkey)"

    /// Four people joined by three zero-width joiners: one grapheme.
    private static let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"

    /// Byte offsets of `needle` in `text`, the way a correct client computes them.
    private static func bytesOf(_ text: String, _ needle: String) -> JSONValue {
        guard let range = text.range(of: needle) else {
            XCTFail("\"\(needle)\" is in the text")
            return .null
        }
        let start = text[..<range.lowerBound].utf8.count
        return index(start, start + needle.utf8.count)
    }

    /// The same, counted in UTF-16 code units: the classic bug.
    private static func utf16Of(_ text: String, _ needle: String) -> JSONValue {
        guard let range = text.range(of: needle) else {
            XCTFail("\"\(needle)\" is in the text")
            return .null
        }
        let start = range.lowerBound.utf16Offset(in: text)
        return index(start, start + needle.utf16.count)
    }

    private static func index(_ start: Int, _ end: Int) -> JSONValue {
        ["byteStart": .number(Double(start)), "byteEnd": .number(Double(end))]
    }

    private static func mention(_ index: JSONValue) -> JSONValue {
        ["index": index, "features": [["$type": "app.bsky.richtext.facet#mention", "did": .string(did)]]]
    }

    private static func link(_ index: JSONValue, _ uri: String = "https://example.com/a") -> JSONValue {
        ["index": index, "features": [["$type": "app.bsky.richtext.facet#link", "uri": .string(uri)]]]
    }

    private static func tag(_ index: JSONValue, _ value: String = "atproto") -> JSONValue {
        ["index": index, "features": [["$type": "app.bsky.richtext.facet#tag", "tag": .string(value)]]]
    }

    private static func read(_ text: String, _ facets: JSONValue...) -> [P.FacetReading] {
        P.readFacets(text, .array(facets))
    }

    // MARK: Input

    func testParsePostInputReadsLinksAndAtURIs() {
        XCTAssertEqual(P.parseInput("https://bsky.app/profile/atproto.com/post/\(Self.rkey)"), .post(authority: "atproto.com", rkey: Self.rkey))
        XCTAssertEqual(P.parseInput("bsky.app/profile/\(Self.did)/post/\(Self.rkey)"), .post(authority: Self.did, rkey: Self.rkey))
        XCTAssertEqual(P.parseInput(" \(Self.uri) "), .post(authority: Self.did, rkey: Self.rkey))
        XCTAssertEqual(P.parseInput("at://Atproto.com/app.bsky.feed.post/\(Self.rkey)"), .post(authority: "atproto.com", rkey: Self.rkey))
        // A Bluesky-shaped path on a host with no entry of its own.
        XCTAssertEqual(P.parseInput("https://client.example/profile/atproto.com/post/\(Self.rkey)"), .post(authority: "atproto.com", rkey: Self.rkey))
    }

    func testParsePostInputSaysWhySomethingIsNotAPost() {
        func reason(_ raw: String) -> String {
            P.parseInput(raw).reason ?? ""
        }
        XCTAssertTrue(reason("").contains("Enter a post"))
        XCTAssertTrue(reason("at://\(Self.did)/app.bsky.feed.like/\(Self.rkey)").contains("app.bsky.feed.like"))
        XCTAssertTrue(reason("at://\(Self.did)").contains("three parts"))
        XCTAssertTrue(reason("https://bsky.app/profile/bsky.app/feed/whats-hot").contains("feed inspector"))
        XCTAssertTrue(reason("https://example.com/").contains("does not point at a post"))
    }

    // MARK: Counting

    func testMeasureTextCountsBytesUTF16UnitsAndGraphemesApart() {
        XCTAssertEqual(P.measureText("hello"), .init(bytes: 5, utf16: 5, graphemes: 5))
        // é is two bytes, one unit.
        XCTAssertEqual(P.measureText("caf\u{E9}"), .init(bytes: 5, utf16: 4, graphemes: 4))
        // 👍 is four bytes and a surrogate pair.
        XCTAssertEqual(P.measureText("\u{1F44D}"), .init(bytes: 4, utf16: 2, graphemes: 1))
        XCTAssertEqual(P.measureText(Self.family), .init(bytes: 25, utf16: 11, graphemes: 1))
        // CJK is three bytes a character.
        XCTAssertEqual(P.measureText("\u{65E5}\u{672C}\u{8A9E}"), .init(bytes: 9, utf16: 3, graphemes: 3))
        XCTAssertEqual(P.utf8Length(""), 0)
    }

    func testByteIndexMapsCharacterStartsAndMarksTheInsidesOfCharacters() {
        // a(1) é(2) 👍(4) b(1) = 8 bytes; UTF-16: a0 é1 👍2-3 b4.
        XCTAssertEqual(P.byteIndex("a\u{E9}\u{1F44D}b"), [0, 1, -1, 2, -1, -1, -1, 4, 5])
        XCTAssertEqual(P.byteIndex(""), [0])
    }

    func testSliceBytesCutsOnCharacterBoundariesOnly() {
        let text = "a\u{E9}\u{1F44D}b"
        XCTAssertEqual(P.sliceBytes(text, 0, 1), "a")
        XCTAssertEqual(P.sliceBytes(text, 1, 3), "\u{E9}")
        XCTAssertEqual(P.sliceBytes(text, 3, 7), "\u{1F44D}")
        XCTAssertEqual(P.sliceBytes(text, 0, 8), text)
        XCTAssertEqual(P.sliceBytes(text, 3, 3), "", "an empty range cuts nothing")
        // Inside é, inside the emoji, past the end, reversed.
        XCTAssertNil(P.sliceBytes(text, 2, 3))
        XCTAssertNil(P.sliceBytes(text, 3, 5))
        XCTAssertNil(P.sliceBytes(text, 0, 9))
        XCTAssertNil(P.sliceBytes(text, 3, 1))
        XCTAssertNil(P.sliceBytes(text, -1, 2))
    }

    func testDecodeBytesShowsASplitCharacterAsAReplacementMark() {
        XCTAssertEqual(P.decodeBytes("a\u{E9}\u{1F44D}b", 0, 2), "a\u{FFFD}")
        XCTAssertEqual(P.decodeBytes("abc", 1, 99), "bc")
    }

    // MARK: Facets

    func testCorrectFacetsOverPlainAndMultiByteTextAreReadWithoutProblems() {
        let text = "\u{1F389} Thanks @alice.example.com \u{2014} read https://example.com/a #atproto"
        let readings = Self.read(
            text,
            Self.mention(Self.bytesOf(text, "@alice.example.com")),
            Self.link(Self.bytesOf(text, "https://example.com/a")),
            Self.tag(Self.bytesOf(text, "#atproto"))
        )
        XCTAssertEqual(readings.map(\.covered), ["@alice.example.com", "https://example.com/a", "#atproto"])
        XCTAssertTrue(readings.allSatisfy { $0.problems.isEmpty })
        XCTAssertEqual(readings[0].features, [.mention(did: Self.did)])
        // The UTF-16 range is where to cut the text's code units.
        XCTAssertEqual(readings[1].utf16.map { P.utf16Slice(text, $0) }, "https://example.com/a")
    }

    func testOffsetsCountedInUTF16UnitsAfterAnEmojiAreCaughtAndNamed() {
        let text = "\u{1F389}\u{1F389} hello @alice.example.com"
        let reading = Self.read(text, Self.mention(Self.utf16Of(text, "@alice.example.com")))[0]
        let units = reading.problems.first { $0.code == .units }
        XCTAssertNotNil(units, "the unit mix-up is reported")
        XCTAssertEqual(units?.level, .error)
        XCTAssertTrue(units?.message.contains("UTF-16 code units") ?? false)
        XCTAssertTrue(units?.message.contains("@alice.example.com") ?? false)
    }

    func testUTF16OffsetsThatSplitACharacterAreABoundaryErrorAndAUnitError() {
        // é is two bytes, so UTF-16 offsets after two of them land two bytes
        // early: this one starts inside the second é.
        let text = "\u{E9}\u{E9} https://example.com/a"
        let reading = Self.read(text, Self.link(Self.utf16Of(text, "https://example.com/a")))[0]
        XCTAssertNil(reading.covered)
        XCTAssertNil(reading.utf16)
        XCTAssertEqual(reading.problems.map(\.code), [.boundary, .units])
        // After one é the range is shifted a single byte, which still starts
        // and ends on characters...
        let one = "\u{E9} https://example.com/a"
        let shifted = Self.read(one, Self.link(Self.utf16Of(one, "https://example.com/a")))[0]
        XCTAssertEqual(shifted.covered, " https://example.com/", "a valid range over the wrong text")
        XCTAssertTrue(shifted.problems.contains { $0.code == .units }, "...and is still caught, because it covers the wrong thing")

        let cjk = "\u{65E5}\u{672C}\u{8A9E} @alice.example.com"
        let bad = Self.read(cjk, Self.mention(Self.utf16Of(cjk, "@alice.example.com")))[0]
        XCTAssertTrue(bad.problems.contains { $0.code == .boundary })
        XCTAssertTrue(bad.problems.contains { $0.code == .units })
    }

    func testOffsetsCountedInGraphemesAreNamedAsSuch() {
        // The family emoji is 11 UTF-16 units and 1 grapheme, so the two
        // wrong units give different answers and only graphemes lines up.
        let text = Self.family + " #atproto"
        let start = P.graphemes(text).firstIndex(of: "#") ?? 0
        let reading = Self.read(text, Self.tag(Self.index(start, start + "#atproto".count)))[0]
        let units = reading.problems.first { $0.code == .units }
        XCTAssertNotNil(units)
        XCTAssertTrue(units?.message.contains("graphemes") ?? false)
    }

    func testPlainASCIITextNeverRaisesAUnitError() {
        let text = "hello @alice.example.com"
        // Wrong, but not because of the unit: every unit agrees on ASCII.
        let reading = Self.read(text, Self.mention(Self.index(0, 5)))[0]
        XCTAssertEqual(reading.covered, "hello")
        XCTAssertFalse(reading.problems.contains { $0.code == .units })
    }

    func testALinkOverArbitraryWordsIsNotSecondGuessed() {
        let text = "\u{1F389} read the announcement here"
        let reading = Self.read(text, Self.link(Self.bytesOf(text, "announcement")))[0]
        XCTAssertEqual(reading.covered, "announcement")
        XCTAssertEqual(reading.problems, [])
    }

    func testRangesThatAreEmptyReversedOutOfTheTextOrMalformedAreErrors() {
        let text = "hello world"
        func codes(_ facet: JSONValue) -> [P.FacetProblem.Code] {
            Self.read(text, facet)[0].problems.map(\.code)
        }
        XCTAssertEqual(codes(Self.link(Self.index(3, 3))), [.empty])
        XCTAssertEqual(codes(Self.link(Self.index(5, 2))), [.empty])
        XCTAssertEqual(codes(Self.link(Self.index(6, 40))), [.range])
        XCTAssertEqual(codes(Self.link(Self.index(0, 11))), [], "the end of the text is a valid end")
        XCTAssertEqual(codes(Self.link(["byteStart": "0", "byteEnd": 5])), [.shape])
        XCTAssertEqual(codes(Self.link(["byteStart": -1, "byteEnd": 5])), [.shape])
        XCTAssertEqual(codes(Self.link(["byteStart": 0.5, "byteEnd": 5])), [.shape])
        XCTAssertEqual(codes(["features": .array([])]), [.shape])
        XCTAssertEqual(codes(.null), [.shape])
        XCTAssertEqual(P.readFacets(text, nil), [])
        XCTAssertEqual(P.readFacets(text, "nope"), [])
    }

    func testOverlappingFacetsAreFlaggedOnTheLaterOne() {
        let text = "see example.com/a now"
        let readings = Self.read(
            text,
            Self.link(Self.index(4, 17)),
            Self.link(Self.index(10, 21)),
            Self.link(Self.index(18, 21))
        )
        XCTAssertEqual(readings[0].problems, [])
        XCTAssertEqual(readings[1].problems.map(\.code), [.overlap])
        XCTAssertTrue(readings[1].problems[0].message.contains("facet 1"))
        // The third starts after the first ends, and the second was never drawn.
        XCTAssertEqual(readings[2].problems, [])
    }

    func testFeaturesAreCheckedForWhatTheyMustCarry() {
        let text = "a @b.example c d"
        let at = Self.bytesOf(text, "@b.example")
        func messages(_ facet: JSONValue) -> String {
            Self.read(text, facet)[0].problems.map(\.message).joined(separator: " ")
        }
        XCTAssertTrue(messages(["index": at, "features": [["$type": "app.bsky.richtext.facet#mention", "did": "b.example"]]]).contains("by DID"))
        XCTAssertTrue(messages(Self.link(at, "example.com/a")).contains("complete URL"))
        XCTAssertTrue(messages(Self.tag(at, "")).contains("empty"))
        XCTAssertTrue(messages(Self.tag(at, String(repeating: "x", count: 65))).contains("longer than 64"))
        XCTAssertTrue(messages(["index": at, "features": .array([])]).contains("no features"))
        // A feature type this tool does not know is kept, not judged.
        let unknown = Self.read(text, ["index": at, "features": [["$type": "com.example.facet#spoiler"]]])[0]
        XCTAssertEqual(unknown.features, [.unknown(type: "com.example.facet#spoiler")])
        XCTAssertEqual(unknown.problems, [])
    }

    func testSegmentTextCutsTheTextAroundTheFacetsThatCanBeDrawn() {
        let text = "\u{1F44D} hi @alice.example.com and #atproto!"
        let readings = Self.read(
            text,
            Self.tag(Self.bytesOf(text, "#atproto")),
            Self.mention(Self.bytesOf(text, "@alice.example.com")),
            // Broken: runs past the end. Left out of the markup.
            Self.link(Self.index(5, 999))
        )
        let segments = P.segmentText(text, readings)
        XCTAssertEqual(segments, [
            P.TextSegment(text: "\u{1F44D} hi ", facet: nil),
            P.TextSegment(text: "@alice.example.com", facet: 1),
            P.TextSegment(text: " and ", facet: nil),
            P.TextSegment(text: "#atproto", facet: 0),
            P.TextSegment(text: "!", facet: nil),
        ])
        XCTAssertEqual(segments.map(\.text).joined(), text, "nothing is lost or repeated")
        XCTAssertEqual(P.segmentText("", []), [P.TextSegment(text: "", facet: nil)])
        XCTAssertEqual(P.segmentText("plain", []), [P.TextSegment(text: "plain", facet: nil)])
    }

    func testLooseTokensFindsLinksMentionsAndTagsWithNoFacetOverThem() {
        let text = "Read https://example.com/a, thanks @alice.example.com! #atproto #1 @ me"
        XCTAssertEqual(P.looseTokens(text, []), [
            P.LooseToken(kind: .link, text: "https://example.com/a"),
            P.LooseToken(kind: .mention, text: "@alice.example.com"),
            P.LooseToken(kind: .tag, text: "#atproto"),
        ])
        let covered = Self.read(
            text,
            Self.link(Self.bytesOf(text, "https://example.com/a")),
            Self.mention(Self.bytesOf(text, "@alice.example.com")),
            Self.tag(Self.bytesOf(text, "#atproto"))
        )
        XCTAssertEqual(P.looseTokens(text, covered), [])
        XCTAssertEqual(P.looseTokens("nothing to see", []), [])
    }

    // MARK: Timestamps

    func testReadTimesComparesCreatedAtWithTheRecordKeyAndTheIndexTime() {
        // 3mzebbdw64s27 was written at 2026-11-02T21:27:04Z.
        let agree = P.readTimes(createdAt: "2026-11-02T21:27:03.719Z", rkey: Self.rkey, indexedAt: "2026-11-02T21:27:05.906Z")
        XCTAssertEqual(agree.notes, [])
        XCTAssertEqual(agree.keyTime.map { String(Formatting.isoTimestamp($0).prefix(16)) }, "2026-11-02T21:27")

        let backdated = P.readTimes(createdAt: "2019-01-01T00:00:00.000Z", rkey: Self.rkey)
        XCTAssertEqual(backdated.notes.count, 1)
        XCTAssertEqual(backdated.notes.first?.level, .warn)
        XCTAssertTrue(backdated.notes.first?.message.contains("8 years earlier") ?? false)
        XCTAssertTrue(backdated.notes.first?.message.contains("backdated") ?? false)

        let ahead = P.readTimes(createdAt: "2026-11-03T21:27:04.000Z", rkey: Self.rkey)
        XCTAssertTrue(ahead.notes.first?.message.contains("1 day later") ?? false)

        let late = P.readTimes(createdAt: "2026-11-02T21:27:03.719Z", rkey: Self.rkey, indexedAt: "2026-11-05T21:27:04.000Z")
        XCTAssertEqual(late.notes.map(\.level), [.info])
        XCTAssertTrue(late.notes.first?.message.contains("3 days after") ?? false)

        XCTAssertTrue(P.readTimes(createdAt: "yesterday", rkey: Self.rkey).notes.first?.message.contains("not a date") ?? false)
        XCTAssertTrue(P.readTimes(createdAt: nil, rkey: Self.rkey).notes.first?.message.contains("no createdAt") ?? false)
        XCTAssertTrue(P.readTimes(createdAt: "2026-11-02T21:27:03.719Z", rkey: "self").notes.first?.message.contains("not a TID") ?? false)
    }

    func testFormatSpanPicksTheLargestUnitThatFits() {
        XCTAssertEqual(P.formatSpan(1.5), "2 seconds")
        XCTAssertEqual(P.formatSpan(-90), "2 minutes")
        XCTAssertEqual(P.formatSpan(3600), "1 hour")
        XCTAssertEqual(P.formatSpan(3 * 86_400), "3 days")
        XCTAssertEqual(P.formatSpan(400 * 86_400), "1 year")
    }

    // MARK: Gates and embeds

    func testDescribeThreadgatePutsTheRulesInWords() {
        func rule(_ name: String) -> JSONValue {
            ["$type": .string("app.bsky.feed.threadgate#\(name)")]
        }
        XCTAssertTrue(P.describeThreadgate([:]).summary.contains("Anyone can reply"))
        XCTAssertTrue(P.describeThreadgate(["allow": .array([])]).summary.contains("Nobody can reply"))
        let gate = P.describeThreadgate([
            "allow": [rule("mentionRule"), rule("followingRule"), rule("followerRule")],
            "hiddenReplies": ["at://a/b/c", "at://d/e/f"],
        ])
        XCTAssertEqual(
            gate.summary,
            "Replies are limited to accounts mentioned in the post, accounts the author follows and accounts that follow the author. The author has hidden 2 replies."
        )
        let listed = P.describeThreadgate([
            "allow": [["$type": "app.bsky.feed.threadgate#listRule", "list": "at://did:plc:x/app.bsky.graph.list/1"]],
        ])
        XCTAssertTrue(listed.summary.contains("accounts on a list"))
        XCTAssertEqual(listed.detail, ["list at://did:plc:x/app.bsky.graph.list/1"])
    }

    func testDescribePostgateSaysWhetherQuotingIsOff() {
        XCTAssertTrue(P.describePostgate([:]).summary.contains("Anyone can quote"))
        let gate = P.describePostgate([
            "embeddingRules": [["$type": "app.bsky.feed.postgate#disableRule"]],
            "detachedEmbeddingUris": ["at://did:plc:x/app.bsky.feed.post/1"],
        ])
        XCTAssertEqual(gate.summary, "Quoting is turned off for this post. The author has detached it from 1 quote.")
        XCTAssertEqual(gate.detail, ["detached from at://did:plc:x/app.bsky.feed.post/1"])
    }

    func testDescribeEmbedNamesWhatAPostCarries() {
        XCTAssertNil(P.describeEmbed(nil))
        XCTAssertEqual(
            P.describeEmbed(["$type": "app.bsky.embed.images", "images": [["alt": "A cat"], ["alt": ""], .object([:])]])?.summary,
            "3 images, 1 of them with alt text."
        )
        XCTAssertEqual(P.describeEmbed(["$type": "app.bsky.embed.images", "images": [["alt": "A cat"]]])?.summary, "1 image, with alt text.")
        XCTAssertEqual(P.describeEmbed(["$type": "app.bsky.embed.video"])?.summary, "A video, without alt text.")
        let card = P.describeEmbed(["$type": "app.bsky.embed.external", "external": ["uri": "https://example.com", "title": "Example"]])
        XCTAssertEqual(card?.summary, "A link card titled \u{201C}Example\u{201D}.")
        XCTAssertEqual(card?.detail, ["https://example.com"])
        let quote = P.describeEmbed(["$type": "app.bsky.embed.record", "record": ["uri": .string("at://\(Self.did)/app.bsky.graph.list/1")]])
        XCTAssertEqual(quote?.summary, "Quotes a list.")
        let both = P.describeEmbed([
            "$type": "app.bsky.embed.recordWithMedia",
            "record": ["$type": "app.bsky.embed.record", "record": ["uri": .string(Self.uri)]],
            "media": ["$type": "app.bsky.embed.images", "images": [["alt": "x"]]],
        ])
        XCTAssertTrue(both?.summary.hasPrefix("Quotes a post, with media: 1 image") ?? false)
        XCTAssertEqual(both?.detail, [Self.uri])
        XCTAssertTrue(P.describeEmbed(["$type": "app.bsky.embed.gallery"])?.summary.contains("does not read (app.bsky.embed.gallery)") ?? false)
    }

    func testGateRecordsSitAtThePostsOwnKeyAndReplyRulesOnTheThreadsFirstPost() {
        XCTAssertEqual(P.gateUri(Self.uri, collection: "app.bsky.feed.postgate"), "at://\(Self.did)/app.bsky.feed.postgate/\(Self.rkey)")
        XCTAssertEqual(P.threadRoot(uri: Self.uri, record: [:]), Self.uri)
        let root = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3aaaaaaaaaa2a"
        let reply: JSONValue = ["root": ["uri": .string(root)], "parent": ["uri": .string(root)]]
        XCTAssertEqual(P.threadRoot(uri: Self.uri, record: ["reply": reply]), root)
    }

    // MARK: Findings

    private static func evidence(_ record: [String: JSONValue]) -> P.Evidence {
        var members: [String: JSONValue] = ["$type": "app.bsky.feed.post", "createdAt": "2026-11-02T21:27:03.719Z"]
        for (key, value) in record { members[key] = value }
        return P.Evidence(
            uri: uri,
            rkey: rkey,
            record: members,
            view: .found(P.AppViewPost(indexedAt: "2026-11-02T21:27:05.906Z", labels: [])),
            threadgate: .absent,
            postgate: .absent
        )
    }

    private static func status(_ evidence: P.Evidence, _ id: P.FindingID) -> P.FindingStatus? {
        P.buildFindings(evidence).first { $0.id == id }?.status
    }

    func testACleanPostPasses() {
        let text = "\u{1F389} hello @alice.example.com"
        let clean = Self.evidence(["text": .string(text), "facets": [Self.mention(Self.bytesOf(text, "@alice.example.com"))], "langs": ["en"]])
        let findings = P.buildFindings(clean)
        XCTAssertEqual(findings.map { "\($0.id.rawValue) \($0.status.rawValue)" }, [
            "length pass", "facets pass", "times pass", "reply info", "threadgate info",
            "postgate info", "embed info", "langs info", "labels info",
        ])
        XCTAssertEqual(P.verdict(findings).tone, .pass)
    }

    func testAFacetCountedInTheWrongUnitFailsThePost() {
        let text = "\u{1F389} hello @alice.example.com"
        let broken = Self.evidence(["text": .string(text), "facets": [Self.mention(Self.utf16Of(text, "@alice.example.com"))]])
        XCTAssertEqual(Self.status(broken, .facets), .fail)
        let verdict = P.verdict(P.buildFindings(broken))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.text.contains("1 of 1 facet does not fit"))
    }

    func testALinkInTheTextWithNoFacetIsAWarning() {
        let loose = Self.evidence(["text": "read https://example.com/a"])
        let finding = P.buildFindings(loose).first { $0.id == .facets }
        XCTAssertEqual(finding?.status, .warn)
        XCTAssertTrue(finding?.summary.contains("reads as a link but has no facet") ?? false)
        XCTAssertEqual(Self.status(Self.evidence(["text": "nothing to mark"]), .facets), .info)
    }

    func testTextOverTheLimitsFailsAndEmptyTextNeedsAnEmbed() {
        XCTAssertEqual(Self.status(Self.evidence(["text": .string(String(repeating: "a", count: 301))]), .length), .fail)
        // 300 graphemes, but 1200 bytes: inside both limits.
        XCTAssertEqual(Self.status(Self.evidence(["text": .string(String(repeating: "\u{1F44D}", count: 300))]), .length), .pass)
        // 251 family emoji: 251 graphemes, 6275 bytes.
        XCTAssertEqual(Self.status(Self.evidence(["text": .string(String(repeating: Self.family, count: 251))]), .length), .fail)
        XCTAssertEqual(Self.status(Self.evidence(["text": ""]), .length), .warn)
        XCTAssertEqual(Self.status(Self.evidence(["text": "", "embed": ["$type": "app.bsky.embed.video"]]), .length), .pass)
        XCTAssertEqual(Self.status(Self.evidence([:]), .length), .fail)
    }

    func testGatesRepliesAndLabelsAreReportedInWords() {
        let root = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3aaaaaaaaaa2a"
        var reply = Self.evidence([
            "text": "hi",
            "reply": ["root": ["uri": .string(root)], "parent": ["uri": .string(root)]],
            "labels": ["$type": "com.atproto.label.defs#selfLabels", "values": [["val": "porn"]]],
        ])
        reply.threadgate = .found(uri: "at://x/app.bsky.feed.threadgate/1", value: ["allow": .array([])])
        reply.postgate = .error
        reply.view = .found(P.AppViewPost(labels: [
            P.AppliedLabel(val: "porn", src: Self.did),
            P.AppliedLabel(val: "spam", src: "did:plc:labeler"),
            P.AppliedLabel(val: "old", src: "did:plc:labeler", neg: true),
        ]))
        let findings = P.buildFindings(reply)
        func by(_ id: P.FindingID) -> P.Finding? {
            findings.first { $0.id == id }
        }
        XCTAssertTrue(by(.reply)?.summary.contains("first post of its thread") ?? false)
        XCTAssertTrue(by(.threadgate)?.summary.hasPrefix("Set on the thread\u{2019}s first post: Nobody can reply") ?? false)
        XCTAssertTrue(by(.postgate)?.summary.contains("could not be looked up") ?? false)
        // The self-label is not repeated, and a negated label is not shown.
        XCTAssertEqual(
            by(.labels)?.summary,
            "The author labelled it porn. Bluesky\u{2019}s AppView shows 1 label from labelers: spam."
        )
        let rootless = Self.evidence(["text": "hi", "reply": ["root": ["uri": .string(root)]]])
        XCTAssertEqual(Self.status(rootless, .reply), .fail)
    }

    func testFindingsStillOnTheirWayHoldTheVerdictBack() {
        var waiting = Self.evidence(["text": "hi"])
        waiting.view = nil
        waiting.threadgate = nil
        waiting.postgate = nil
        XCTAssertEqual(Self.status(waiting, .labels), .pending)
        XCTAssertEqual(Self.status(waiting, .threadgate), .pending)
        XCTAssertEqual(P.verdict(P.buildFindings(waiting)).tone, .pending)
        // A failure is said at once, whatever else is pending.
        var failing = Self.evidence(["text": .string(String(repeating: "a", count: 400))])
        failing.view = nil
        XCTAssertEqual(P.verdict(P.buildFindings(failing)).tone, .fail)
    }

    func testABackdatedPostIsAWarning() {
        let old = Self.evidence(["text": "hi", "createdAt": "2020-05-01T00:00:00.000Z"])
        XCTAssertEqual(Self.status(old, .times), .warn)
        XCTAssertEqual(P.verdict(P.buildFindings(old)).tone, .warn)
        XCTAssertEqual(Self.status(Self.evidence(["text": "hi", "createdAt": "soon"]), .times), .fail)
    }

    // MARK: The client and the screen

    private static let recordBody = #"{"uri":"\#(uri)","cid":"bafyreib","value":{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2026-11-02T21:27:03.719Z"}}"#
    private static let postsBody = #"{"posts":[{"uri":"\#(uri)","cid":"bafyreib","author":{"did":"\#(did)","handle":"bsky.app","displayName":"Bluesky"},"record":{},"indexedAt":"2026-11-02T21:27:05.906Z","labels":[],"likeCount":3,"repostCount":1,"replyCount":0,"quoteCount":0}]}"#

    func testTheClientFallsBackToThePDSWhenSlingshotMisses() async {
        let transport = SchemaLookupFakeTransport([
            (["resolveMiniDoc", "identifier=atproto.com"], .init(status: 200, body: SchemaLookupFixtures.miniDoc(Self.did, handle: "atproto.com"))),
            (["pds.example.com", "com.atproto.repo.getRecord", "rkey=\(Self.rkey)"], .init(status: 200, body: Self.recordBody)),
        ])
        let client = PostInspectorClient(http: HTTPClient(transport: transport))
        let fetched = await client.fetchRecord(authority: "atproto.com", rkey: Self.rkey)
        if case .success(let record) = fetched {
            XCTAssertEqual(record.uri, Self.uri)
            XCTAssertEqual(record.value["text"]?.stringValue, "hello")
        } else {
            XCTFail("expected the record, got \(fetched)")
        }
        XCTAssertEqual(transport.count(containing: "getRecordByUri"), 1, "the cache is asked first")
    }

    func testTheClientSaysWhyARecordCouldNotBeRead() async {
        let gone = SchemaLookupFakeTransport([
            (["resolveMiniDoc"], .init(status: 200, body: SchemaLookupFixtures.miniDoc(Self.did, handle: "atproto.com"))),
            (["com.atproto.repo.getRecord"], .init(status: 400, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let missing = await PostInspectorClient(http: HTTPClient(transport: gone)).fetchRecord(authority: "atproto.com", rkey: Self.rkey)
        XCTAssertEqual(missing, .failure(.message("There is no post at this address. It may have been deleted.")))

        let down = SchemaLookupFakeTransport([
            (["resolveMiniDoc"], .init(status: 200, body: SchemaLookupFixtures.miniDoc(Self.did, handle: "atproto.com"))),
            (["com.atproto.repo.getRecord"], .init(status: 503, body: "busy")),
        ])
        let unreachable = await PostInspectorClient(http: HTTPClient(transport: down)).fetchRecord(authority: "atproto.com", rkey: Self.rkey)
        XCTAssertEqual(unreachable, .failure(.message("The post could not be read: its PDS did not answer.")))

        let nobody = await PostInspectorClient(http: HTTPClient(transport: SchemaLookupFakeTransport([]))).fetchRecord(authority: "nobody.example", rkey: Self.rkey)
        XCTAssertEqual(nobody, .failure(.message("nobody.example did not resolve to an account.")))
    }

    func testAGateLookupKeepsNoRecordApartFromNoAnswer() async {
        let transport = SchemaLookupFakeTransport([
            (["app.bsky.feed.threadgate"], .init(status: 400, body: #"{"error":"RecordNotFound"}"#)),
            (["app.bsky.feed.postgate"], .init(status: 500, body: "oops")),
            (["app.bsky.feed.like"], .init(status: 200, body: #"{"uri":"at://x/app.bsky.feed.like/1","value":{"embeddingRules":[]}}"#)),
        ])
        let client = PostInspectorClient(http: HTTPClient(transport: transport))
        let absent = await client.readGate("at://x/app.bsky.feed.threadgate/1")
        XCTAssertEqual(absent, .absent)
        let failed = await client.readGate("at://x/app.bsky.feed.postgate/1")
        XCTAssertEqual(failed, .error)
        let found = await client.readGate("at://x/app.bsky.feed.like/1")
        XCTAssertEqual(found, .found(uri: "at://x/app.bsky.feed.like/1", value: ["embeddingRules": .array([])]))
        let none = await client.readGate(nil)
        XCTAssertEqual(none, .absent)
    }

    @MainActor
    func testTheModelReadsThePostAndEverythingBesideIt() async {
        let transport = SchemaLookupFakeTransport([
            (["app.bsky.feed.getPosts"], .init(status: 200, body: Self.postsBody)),
            (["app.bsky.feed.threadgate"], .init(status: 404, body: #"{"error":"NotFound"}"#)),
            (["app.bsky.feed.postgate"], .init(status: 200, body: #"{"uri":"at://\#(Self.did)/app.bsky.feed.postgate/\#(Self.rkey)","value":{"embeddingRules":[{"$type":"app.bsky.feed.postgate#disableRule"}]}}"#)),
            (["getRecordByUri", "app.bsky.feed.post%2F"], .init(status: 200, body: Self.recordBody)),
        ])
        let model = PostInspectorModel(http: HTTPClient(transport: transport))
        let input = "https://bsky.app/profile/atproto.com/post/\(Self.rkey)"
        _ = await model.inspect(input)?.value
        XCTAssertFalse(model.isRunning)
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.evidence?.uri, Self.uri)
        XCTAssertEqual(model.text, "hello")
        XCTAssertEqual(model.post?.likeCount, 3)
        XCTAssertEqual(model.evidence?.threadgate, .absent)
        XCTAssertEqual(model.findings.first { $0.id == .postgate }?.summary, "Quoting is turned off for this post.")
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertEqual(model.shareQuery, ["post": input])
    }

    @MainActor
    func testTheModelSaysWhenThereIsNoPost() async {
        let transport = SchemaLookupFakeTransport([
            (["resolveMiniDoc"], .init(status: 200, body: SchemaLookupFixtures.miniDoc(Self.did, handle: "atproto.com"))),
            (["com.atproto.repo.getRecord"], .init(status: 400, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let model = PostInspectorModel(http: HTTPClient(transport: transport))
        _ = await model.inspect("at://atproto.com/app.bsky.feed.post/\(Self.rkey)")?.value
        XCTAssertNil(model.evidence)
        XCTAssertEqual(model.failure, "There is no post at this address. It may have been deleted.")

        XCTAssertNil(model.inspect("https://example.com/"))
        XCTAssertTrue(model.inputProblem?.contains("does not point at a post") ?? false)
    }
}
