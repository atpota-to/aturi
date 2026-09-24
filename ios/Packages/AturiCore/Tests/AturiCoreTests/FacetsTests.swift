import XCTest
@testable import AturiCore

/// Port of the facet handling in PostPreview.tsx, exercised on the byte
/// offsets real records carry.
final class FacetsTests: XCTestCase {
    private func link(_ start: Int, _ end: Int, _ uri: String) -> BskyFacet {
        BskyFacet(byteStart: start, byteEnd: end, features: [BskyFacetFeature(type: BskyFacetFeature.linkType, uri: uri)])
    }

    private func mention(_ start: Int, _ end: Int, _ did: String) -> BskyFacet {
        BskyFacet(byteStart: start, byteEnd: end, features: [BskyFacetFeature(type: BskyFacetFeature.mentionType, did: did)])
    }

    private func tag(_ start: Int, _ end: Int, _ tag: String) -> BskyFacet {
        BskyFacet(byteStart: start, byteEnd: end, features: [BskyFacetFeature(type: BskyFacetFeature.tagType, tag: tag)])
    }

    // MARK: Byte offsets

    func testEmojiBeforeALinkShiftsTheByteOffsetsNotTheCharacters() {
        // "🦋 " is 4 + 1 bytes, so the link starts at byte 5 even though it
        // is the third character. The trailing text has a 2-byte "é".
        let text = "\u{1F98B} bsky.app/about is where, café"
        let linkText = "bsky.app/about"
        let start = 5
        let end = start + linkText.utf8.count
        XCTAssertEqual(text.utf8.count, 4 + 1 + linkText.utf8.count + " is where, café".utf8.count)

        let segments = Facets.segments(text: text, facets: [link(start, end, "https://bsky.app/about")])
        XCTAssertEqual(segments, [
            .text("\u{1F98B} "),
            .link("bsky.app/about", url: "https://bsky.app/about"),
            .text(" is where, café"),
        ])
        XCTAssertEqual(segments.map { $0.text }.joined(), text, "every character is emitted exactly once")
    }

    func testMultiByteTextInsideAndAroundAFacet() {
        let text = "日本語 @ユーザー.bsky.social です"
        let handle = "@ユーザー.bsky.social"
        let start = "日本語 ".utf8.count
        let end = start + handle.utf8.count
        let segments = Facets.segments(text: text, facets: [mention(start, end, "did:plc:abc123")])
        XCTAssertEqual(segments, [
            .text("日本語 "),
            .mention(handle, did: "did:plc:abc123"),
            .text(" です"),
        ])
    }

    func testAnOffsetInsideAMultiByteScalarSnapsForward() {
        // Byte 1 is inside the 4-byte emoji; the web walks code points and
        // returns the first boundary at or past the target, i.e. index 1.
        let text = "\u{1F98B}abc"
        let segments = Facets.segments(text: text, facets: [link(1, 6, "https://example.com")])
        XCTAssertEqual(segments, [
            .text("\u{1F98B}"),
            .link("ab", url: "https://example.com"),
            .text("c"),
        ])
    }

    func testFacetAtTheVeryStartAndVeryEnd() {
        let text = "#first and #last"
        let segments = Facets.segments(text: text, facets: [tag(0, 6, "first"), tag(11, 16, "last")])
        XCTAssertEqual(segments, [
            .tag("#first", tag: "first"),
            .text(" and "),
            .tag("#last", tag: "last"),
        ])
    }

    func testAdjacentFacetsProduceNoEmptyTextBetweenThem() {
        let text = "ab"
        let segments = Facets.segments(text: text, facets: [tag(0, 1, "a"), tag(1, 2, "b")])
        XCTAssertEqual(segments, [.tag("a", tag: "a"), .tag("b", tag: "b")])
    }

    // MARK: Ordering and malformed facets

    func testFacetsAreAppliedInByteOrderRegardlessOfRecordOrder() {
        let text = "one two three"
        let segments = Facets.segments(text: text, facets: [tag(8, 13, "three"), tag(0, 3, "one")])
        XCTAssertEqual(segments, [
            .tag("one", tag: "one"),
            .text(" two "),
            .tag("three", tag: "three"),
        ])
    }

    func testOverlappingFacetIsIgnored() {
        let text = "hello world"
        let segments = Facets.segments(text: text, facets: [
            link(0, 5, "https://a.example"),
            link(3, 8, "https://b.example"),
            link(6, 11, "https://c.example"),
        ])
        XCTAssertEqual(segments, [
            .link("hello", url: "https://a.example"),
            .text(" "),
            .link("world", url: "https://c.example"),
        ])
    }

    func testDuplicateFacetsKeepOnlyTheFirst() {
        let text = "hello"
        let segments = Facets.segments(text: text, facets: [link(0, 5, "https://first.example"), link(0, 5, "https://second.example")])
        XCTAssertEqual(segments, [.link("hello", url: "https://first.example")])
    }

    func testOutOfRangeAndInvertedFacetsAreIgnored() {
        let text = "short"
        let segments = Facets.segments(text: text, facets: [
            link(0, 6, "https://too-long.example"),
            link(4, 2, "https://inverted.example"),
            link(3, 3, "https://empty.example"),
            link(-1, 2, "https://negative.example"),
            link(9, 12, "https://past-the-end.example"),
        ])
        XCTAssertEqual(segments, [.text("short")])
    }

    func testNoFacetsAndEmptyText() {
        XCTAssertEqual(Facets.segments(text: "plain", facets: []), [.text("plain")])
        XCTAssertEqual(Facets.segments(text: "", facets: [link(0, 0, "https://x.example")]), [])
        XCTAssertEqual(Facets.segments(text: "", facets: []), [])
    }

    func testUnknownFeatureTypeAndMissingFeaturesRenderAsText() {
        let text = "a b c"
        let facets = [
            BskyFacet(byteStart: 0, byteEnd: 1, features: [BskyFacetFeature(type: "app.bsky.richtext.facet#future")]),
            BskyFacet(byteStart: 2, byteEnd: 3, features: []),
        ]
        XCTAssertEqual(Facets.segments(text: text, facets: facets), [.text("a b c")], "plain runs merge")
    }

    func testOnlyTheFirstFeatureCounts() {
        let facet = BskyFacet(byteStart: 0, byteEnd: 4, features: [
            BskyFacetFeature(type: BskyFacetFeature.tagType, tag: "tag"),
            BskyFacetFeature(type: BskyFacetFeature.linkType, uri: "https://example.com"),
        ])
        XCTAssertEqual(Facets.segments(text: "text", facets: [facet]), [.tag("text", tag: "tag")])
    }

    // MARK: Sanitisation

    func testLinksMustBeAbsoluteHttpUrls() {
        let text = "click"
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "https://example.com/path?q=1#frag")]), [.link("click", url: "https://example.com/path?q=1#frag")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "HTTP://Example.com")]), [.link("click", url: "HTTP://Example.com")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "  https://example.com  ")]), [.link("click", url: "https://example.com")], "trimmed")
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "javascript:alert(1)")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "JavaScript:alert(1)")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "data:text/html,hi")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "/relative/path")]), [.text("click")], "facet links must be absolute")
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "//protocol.relative")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "ftp://example.com")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "at://did:plc:x")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "")]), [.text("click")])
        XCTAssertEqual(Facets.segments(text: text, facets: [link(0, 5, "https://")]), [.text("click")], "no host")
        XCTAssertEqual(Facets.segments(text: text, facets: [BskyFacet(byteStart: 0, byteEnd: 5, features: [BskyFacetFeature(type: BskyFacetFeature.linkType)])]), [.text("click")])
    }

    func testLinksWithUnicodeInThePathSurvive() {
        XCTAssertEqual(
            Facets.segments(text: "link", facets: [link(0, 4, "https://example.com/caf\u{E9}")]),
            [.link("link", url: "https://example.com/caf\u{E9}")]
        )
    }

    func testMentionsMustBeWellFormedDids() {
        let text = "@who"
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:plc:ewvi7nxzyoun6zhxrhs64oiz")]), [.mention("@who", did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz")])
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:web:example.com")]), [.mention("@who", did: "did:web:example.com")])
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, " did:plc:abc ")]), [.mention("@who", did: "did:plc:abc")], "trimmed")
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:plc:../x")]), [.text("@who")], "path traversal")
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:PLC:abc")]), [.text("@who")], "method must be lowercase")
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "alice.test")]), [.text("@who")])
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:plc:")]), [.text("@who")])
        XCTAssertEqual(Facets.segments(text: text, facets: [mention(0, 4, "did:plc:a/b")]), [.text("@who")])
        XCTAssertEqual(Facets.segments(text: text, facets: [BskyFacet(byteStart: 0, byteEnd: 4, features: [BskyFacetFeature(type: BskyFacetFeature.mentionType)])]), [.text("@who")])
    }

    func testHashtagsAreStrippedToSafeCharacters() {
        let text = "#tag"
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "bluesky")]), [.tag("#tag", tag: "bluesky")])
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "#bluesky")]), [.tag("#tag", tag: "bluesky")], "leading # dropped")
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "blue sky!")]), [.tag("#tag", tag: "bluesky")], "unsafe characters removed, not rejected")
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "snake_case-ok9")]), [.tag("#tag", tag: "snake_case-ok9")])
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "日本")]), [.text("#tag")], "nothing left")
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "#")]), [.text("#tag")])
        XCTAssertEqual(Facets.segments(text: text, facets: [tag(0, 4, "")]), [.text("#tag")])
        XCTAssertEqual(Facets.segments(text: text, facets: [BskyFacet(byteStart: 0, byteEnd: 4, features: [BskyFacetFeature(type: BskyFacetFeature.tagType)])]), [.text("#tag")])
    }

    // MARK: Convenience

    func testSegmentsFromARawRecord() throws {
        let record = try JSONValue.parse(Data("""
        {"$type":"app.bsky.feed.post","text":"see bsky.app now",
         "facets":[{"index":{"byteStart":4,"byteEnd":12},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://bsky.app"}]}]}
        """.utf8))
        let expected: [FacetSegment] = [.text("see "), .link("bsky.app", url: "https://bsky.app"), .text(" now")]
        XCTAssertEqual(Facets.segments(text: "see bsky.app now", facets: record["facets"]), expected)
        XCTAssertEqual(Facets.segments(of: try XCTUnwrap(BskyPostRecord(json: record))), expected)
        XCTAssertEqual(Facets.segments(text: "see bsky.app now", facets: JSONValue?.none), [.text("see bsky.app now")])
    }

    func testSegmentAccessors() {
        XCTAssertEqual(FacetSegment.link("a", url: "https://a").text, "a")
        XCTAssertEqual(FacetSegment.mention("b", did: "did:plc:b").text, "b")
        XCTAssertEqual(FacetSegment.tag("c", tag: "c").text, "c")
        XCTAssertTrue(FacetSegment.text("d").isText)
        XCTAssertFalse(FacetSegment.tag("c", tag: "c").isText)
        XCTAssertEqual(Facets.hashtagURL("bluesky"), "https://bsky.app/hashtag/bluesky")
        XCTAssertEqual(Facets.mentionPath("did:plc:x"), "/did:plc:x")
    }
}
