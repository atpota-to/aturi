import XCTest
@testable import AturiCore

// Port of the link-generator halves of
// packages/waypoints/src/__tests__/universalLinks.test.ts plus the input
// shapes documented on extractAtUriComponents in src/utils/linkGenerator.ts.
final class LinkGeneratorTests: XCTestCase {
    private func components(_ identifier: String, _ collection: String? = nil, _ rkey: String? = nil) -> AtUriComponents {
        AtUriComponents(identifier: identifier, collection: collection, rkey: rkey)
    }

    // MARK: extractAtUriComponents: AT URIs

    func testExtractsNativeAtUris() {
        XCTAssertEqual(extractAtUriComponents("at://did:plc:abc"), components("did:plc:abc"))
        XCTAssertEqual(extractAtUriComponents("at://alice.bsky.social"), components("alice.bsky.social"))
        XCTAssertEqual(
            extractAtUriComponents("at://did:plc:abc/app.bsky.feed.post/3k7"),
            components("did:plc:abc", "app.bsky.feed.post", "3k7")
        )
        XCTAssertEqual(
            extractAtUriComponents("  at://alice.bsky.social/app.bsky.graph.list/abc \n"),
            components("alice.bsky.social", "app.bsky.graph.list", "abc")
        )
    }

    func testTwoSegmentAtUriIsNotARecord() {
        // A collection without an rkey is neither a profile nor a record. For
        // a DID the browser's URL parser rejects the non-numeric port, for a
        // handle it parses the path and returns the collection as though it
        // were a handle; both are what the web does today.
        XCTAssertNil(extractAtUriComponents("at://did:plc:abc/app.bsky.feed.post"))
        XCTAssertEqual(
            extractAtUriComponents("at://alice.test/app.bsky.feed.post"),
            components("app.bsky.feed.post")
        )
    }

    // MARK: extractAtUriComponents: universal patterns

    func testAcceptsAnAtUriEmbeddedInAnyHostsPath() {
        XCTAssertEqual(
            extractAtUriComponents("https://example.com/at://did:plc:abc/app.bsky.feed.post/3k7"),
            components("did:plc:abc", "app.bsky.feed.post", "3k7")
        )
        // Single-slash spelling, which servers and browsers normalize paths to.
        XCTAssertEqual(
            extractAtUriComponents("https://example.com/at:/did:plc:abc/app.bsky.feed.post/3k7"),
            components("did:plc:abc", "app.bsky.feed.post", "3k7")
        )
        XCTAssertEqual(extractAtUriComponents("https://pdsls.dev/at://did:plc:abc"), components("did:plc:abc"))
        XCTAssertEqual(extractAtUriComponents("https://atp.tools/at:/did:plc:abc"), components("did:plc:abc"))
        // Only a path that begins with the AT URI is universal; a prefix
        // segment before it (Taproot's `/uri/at://`) is left to the reverse
        // parsers, exactly as on the web.
        XCTAssertNil(extractAtUriComponents("https://atproto.at/uri/at://did:plc:abc/app.bsky.feed.post/3k7"))
    }

    func testAcceptsIdentifierPaths() {
        XCTAssertEqual(
            extractAtUriComponents("https://anydomain.com/did:plc:xxx/app.bsky.feed.post/rkey"),
            components("did:plc:xxx", "app.bsky.feed.post", "rkey")
        )
        XCTAssertEqual(
            extractAtUriComponents("https://anydomain.com/handle.bsky.social/app.bsky.feed.post/rkey"),
            components("handle.bsky.social", "app.bsky.feed.post", "rkey")
        )
        XCTAssertEqual(extractAtUriComponents("https://aturi.to/did:plc:abc"), components("did:plc:abc"))
        XCTAssertEqual(extractAtUriComponents("https://tangled.org/alice.bsky.social"), components("alice.bsky.social"))
        XCTAssertEqual(extractAtUriComponents("https://aturi.to/explore/did:plc:abc"), nil)
        XCTAssertEqual(extractAtUriComponents("https://offprint.app/did:plc:abc/pub.leaflet.document/xyz"), components("did:plc:abc", "pub.leaflet.document", "xyz"))
        // A collection without a dot is not a lexicon, so the universal
        // pattern does not fire and nothing else claims the path.
        XCTAssertNil(extractAtUriComponents("https://example.com/alice.test/posts/abc"))
        // Trailing slashes are ignored by the universal pattern.
        XCTAssertEqual(extractAtUriComponents("https://tangled.org/alice.bsky.social/"), components("alice.bsky.social"))
    }

    func testAcceptsProfileRoutes() {
        XCTAssertEqual(extractAtUriComponents("https://bsky.app/profile/did:plc:xxx"), components("did:plc:xxx"))
        XCTAssertEqual(
            extractAtUriComponents("https://bsky.app/profile/handle.bsky.social/post/rkey"),
            components("handle.bsky.social", "app.bsky.feed.post", "rkey")
        )
        XCTAssertEqual(
            extractAtUriComponents("https://aturi.to/profile/did:plc:abc/lists/abc"),
            components("did:plc:abc", "app.bsky.graph.list", "abc")
        )
        for host in ["blacksky.community", "anisota.net", "reddwarf.app", "witchsky.app", "deer.social", "semble.so"] {
            XCTAssertEqual(
                extractAtUriComponents("https://\(host)/profile/alice.test/post/3k7"),
                components("alice.test", "app.bsky.feed.post", "3k7"), host
            )
            XCTAssertEqual(extractAtUriComponents("https://\(host)/profile/alice.test"), components("alice.test"), host)
        }
        XCTAssertNil(extractAtUriComponents("https://bsky.app/profile/alice.test/feed/abc"))
        XCTAssertNil(extractAtUriComponents("https://bsky.app/profile/alice.test/post"))
    }

    func testAcceptsLeafletMarginAndLegacyRoutes() {
        XCTAssertEqual(extractAtUriComponents("https://leaflet.pub/p/alice.test"), components("alice.test"))
        XCTAssertEqual(
            extractAtUriComponents("https://margin.at/example.com/annotation/3k7"),
            components("example.com", "at.margin.annotation", "3k7")
        )
        XCTAssertEqual(
            extractAtUriComponents("https://margin.at/example.com/CollectionItem/3k7"),
            components("example.com", "at.margin.collectionitem", "3k7")
        )
        XCTAssertEqual(extractAtUriComponents("https://margin.at/profile/did:plc:abc"), components("did:plc:abc"))
        XCTAssertEqual(extractAtUriComponents("https://margin.at/example.com"), components("example.com"))
        XCTAssertNil(extractAtUriComponents("https://margin.at/example.com/unknown/3k7"))
        // The margin branch treats any single segment as a handle, dots or not.
        XCTAssertEqual(extractAtUriComponents("https://margin.at/about"), components("about"))
        XCTAssertEqual(
            extractAtUriComponents("https://aturi.to/at/did:plc:abc/app.bsky.feed.post/3k7"),
            components("did:plc:abc", "app.bsky.feed.post", "3k7")
        )
        XCTAssertEqual(extractAtUriComponents("https://aturi.to/at/alice.test"), components("alice.test"))
        XCTAssertEqual(
            extractAtUriComponents("https://atp.tools/record/did:plc:abc/app.bsky.feed.post/3k7"),
            components("did:plc:abc", "app.bsky.feed.post", "3k7")
        )
        XCTAssertEqual(extractAtUriComponents("https://atp.tools/record/did:plc:abc"), components("did:plc:abc"))
    }

    func testHostsAreCaseInsensitiveAndQueriesAreDropped() {
        XCTAssertEqual(
            extractAtUriComponents("HTTPS://Margin.AT/example.com/highlight/3k7?ref=x#frag"),
            components("example.com", "at.margin.highlight", "3k7")
        )
        XCTAssertEqual(
            extractAtUriComponents("http://www.aturi.to/profile/alice.bsky.social?stay=1"),
            components("alice.bsky.social")
        )
        XCTAssertEqual(extractAtUriComponents("https://user:pw@bsky.app:443/profile/alice.test"), components("alice.test"))
    }

    func testPathsArePercentEncodedLikeTheBrowser() {
        // JS `new URL` encodes a space in the path, so the rkey is kept as
        // the browser would present it.
        XCTAssertEqual(
            extractAtUriComponents("https://bsky.app/profile/alice.test/post/a b"),
            components("alice.test", "app.bsky.feed.post", "a%20b")
        )
        XCTAssertEqual(
            extractAtUriComponents("https://aturi.to/alice.bsky.social/app.bsky.feed.post/a%20b"),
            components("alice.bsky.social", "app.bsky.feed.post", "a%20b")
        )
    }

    // MARK: extractAtUriComponents: bare identifiers and rejections

    func testAcceptsBareIdentifiers() {
        XCTAssertEqual(extractAtUriComponents("did:plc:abc"), components("did:plc:abc"))
        XCTAssertEqual(extractAtUriComponents("did:web:example.com"), components("did:web:example.com"))
        XCTAssertEqual(extractAtUriComponents("alice.bsky.social"), components("alice.bsky.social"))
        XCTAssertEqual(extractAtUriComponents("  alice.bsky.social  "), components("alice.bsky.social"))
        // The web keeps the `@`; universalLinks strips it before calling.
        XCTAssertEqual(extractAtUriComponents("@alice.bsky.social"), components("@alice.bsky.social"))
    }

    func testReturnsNilForInputThatNamesNothing() {
        XCTAssertNil(extractAtUriComponents(""))
        XCTAssertNil(extractAtUriComponents("   "))
        XCTAssertNil(extractAtUriComponents("not-a-handle"))
        XCTAssertNil(extractAtUriComponents("https://example.com/some/page"))
        XCTAssertNil(extractAtUriComponents("https://example.com"))
        XCTAssertNil(extractAtUriComponents("ftp://example.com"))
        XCTAssertNil(extractAtUriComponents("alice.bsky.social/app.bsky.feed.post/3k7"))
        XCTAssertNil(extractAtUriComponents("https://bsky.app/profile/alice.test/post/abc/extra"))
        XCTAssertFalse(isValidInput("not-a-handle"))
        XCTAssertTrue(isValidInput("at://did:plc:abc/app.bsky.feed.post/3k7"))
        XCTAssertTrue(isValidInput("did:plc:abc"))
    }

    // MARK: generateAturiLink

    func testGeneratesCanonicalProfileLinks() {
        XCTAssertEqual(
            generateAturiLink(components("did:plc:abc", "app.bsky.feed.post", "3k7")),
            "https://aturi.to/profile/did:plc:abc/post/3k7"
        )
        XCTAssertEqual(
            generateAturiLink(components("alice.bsky.social", "app.bsky.graph.list", "abc")),
            "https://aturi.to/profile/alice.bsky.social/lists/abc"
        )
        XCTAssertEqual(
            generateAturiLink(components("did:plc:abc", "pub.leaflet.document", "xyz")),
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz"
        )
        XCTAssertEqual(generateAturiLink(components("alice.bsky.social")), "https://aturi.to/profile/alice.bsky.social")
        XCTAssertEqual(generateAturiLink(components("did:plc:abc")), "https://aturi.to/profile/did:plc:abc")
        // A collection without an rkey is a profile link, as `collection && rkey` in JS.
        XCTAssertEqual(generateAturiLink(components("did:plc:abc", "app.bsky.feed.post")), "https://aturi.to/profile/did:plc:abc")
        XCTAssertEqual(generateAturiLink(components("did:plc:abc", "app.bsky.feed.post", "")), "https://aturi.to/profile/did:plc:abc")
    }

    func testGeneratesAtPrefixedLinks() {
        XCTAssertEqual(
            generateAturiLink(components("did:plc:abc", "app.bsky.feed.post", "3k7"), useAtPrefix: true),
            "https://aturi.to/at://did:plc:abc/app.bsky.feed.post/3k7"
        )
        XCTAssertEqual(
            generateAturiLink(components("alice.bsky.social"), useAtPrefix: true),
            "https://aturi.to/at://alice.bsky.social"
        )
    }

    func testConvertsEndToEnd() {
        let profile = "https://aturi.to/profile/alice.bsky.social"
        XCTAssertEqual(convertToAturiLink("alice.bsky.social"), profile)
        XCTAssertEqual(convertToAturiLink("  alice.bsky.social  "), profile)
        XCTAssertEqual(convertToAturiLink("did:plc:abc"), "https://aturi.to/profile/did:plc:abc")
        XCTAssertEqual(
            convertToAturiLink("https://bsky.app/profile/alice.bsky.social/post/3k7"),
            "https://aturi.to/profile/alice.bsky.social/post/3k7"
        )
        XCTAssertEqual(convertToAturiLink("https://tangled.org/alice.bsky.social"), profile)
        XCTAssertEqual(
            convertToAturiLink("https://example.com/at://did:plc:abc/app.bsky.feed.post/3k7"),
            "https://aturi.to/profile/did:plc:abc/post/3k7"
        )
        XCTAssertEqual(
            convertToAturiLink("https://example.com/at:/did:plc:abc/app.bsky.feed.post/3k7"),
            "https://aturi.to/profile/did:plc:abc/post/3k7"
        )
        XCTAssertEqual(
            convertToAturiLink("at://did:plc:abc/pub.leaflet.document/xyz"),
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz"
        )
        XCTAssertEqual(
            convertToAturiLink("at://did:plc:abc/app.bsky.feed.post/3k7", useAtPrefix: true),
            "https://aturi.to/at://did:plc:abc/app.bsky.feed.post/3k7"
        )
        XCTAssertNil(convertToAturiLink("https://example.com/some/page"))
        XCTAssertNil(convertToAturiLink("ftp://example.com"))
    }

    func testRoundTripsItsOwnLinks() {
        let url = "https://aturi.to/profile/did:plc:abc/post/3k7"
        XCTAssertEqual(convertToAturiLink(url), url)
        let list = "https://aturi.to/profile/alice.bsky.social/lists/abc"
        XCTAssertEqual(convertToAturiLink(list), list)
        let atPrefixed = "https://aturi.to/at://did:plc:abc/app.bsky.feed.post/3k7"
        XCTAssertEqual(convertToAturiLink(atPrefixed, useAtPrefix: true), atPrefixed)
        // The generic `/profile/{id}/{collection}/{rkey}` route is not one of
        // the extractor's shapes (the web's reverse parsers read it), so it
        // does not round-trip here; the legacy bare path does.
        XCTAssertNil(convertToAturiLink("https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz"))
        XCTAssertEqual(
            convertToAturiLink("https://aturi.to/did:plc:abc/pub.leaflet.document/xyz"),
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz"
        )
    }

    func testComponentsValueSemantics() {
        var value = components("alice.test")
        XCTAssertFalse(value.isRecord)
        value.collection = "app.bsky.feed.post"
        XCTAssertFalse(value.isRecord)
        value.rkey = "3k7"
        XCTAssertTrue(value.isRecord)
        XCTAssertEqual(value, components("alice.test", "app.bsky.feed.post", "3k7"))
    }
}
