import XCTest
@testable import AturiCore

/// Port of packages/waypoints/src/__tests__/uriParser.test.ts.
final class URIParserTests: XCTestCase {
    // MARK: space marker

    func testRefusesTheLiteralSpaceMarkerInTheCollectionPosition() {
        let parsed = parseURI(handle: "did:plc:x", collection: "space", rkey: "com.example.forum")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertNotNil(parsed.error)
        XCTAssertFalse(parsed.error?.isEmpty ?? true)
        XCTAssertNil(parsed.collection)
        XCTAssertEqual(parsed.uri, "")
        XCTAssertEqual(parsed.handle, "did:plc:x")
    }

    func testRefusesTheMarkerEvenWithoutAThirdSegment() {
        let parsed = parseURI(handle: "did:plc:x", collection: "space")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertEqual(parsed.error, "Space URIs are not public records")
    }

    func testStillParsesAnNsidThatMerelyStartsWithTheLettersSpace() {
        let parsed = parseURI(handle: "did:plc:x", collection: "space.example.thing", rkey: "abc")
        XCTAssertEqual(parsed.type, .record)
        XCTAssertEqual(parsed.collection, "space.example.thing")
        XCTAssertEqual(parsed.rkey, "abc")
        XCTAssertEqual(parsed.uri, "at://did:plc:x/space.example.thing/abc")
        XCTAssertNil(parsed.error)
    }

    // MARK: unchanged branches

    func testParsesAProfile() {
        let parsed = parseURI(handle: "alice.bsky.social")
        XCTAssertEqual(parsed.type, .profile)
        XCTAssertEqual(parsed.uri, "at://alice.bsky.social")
        XCTAssertEqual(parsed.handle, "alice.bsky.social")
        XCTAssertNil(parsed.did)
        XCTAssertNil(parsed.collection)
        XCTAssertNil(parsed.rkey)
        XCTAssertNil(parsed.error)
    }

    func testParsesAProfileByDid() {
        let parsed = parseURI(handle: "did:plc:x")
        XCTAssertEqual(parsed.type, .profile)
        XCTAssertEqual(parsed.did, "did:plc:x")
        XCTAssertEqual(parsed.uri, "at://did:plc:x")
    }

    func testEmptySegmentsCountAsAbsent() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: "", rkey: "")
        XCTAssertEqual(parsed.type, .profile)
        XCTAssertEqual(parsed.uri, "at://alice.bsky.social")
    }

    func testParsesAPost() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: "app.bsky.feed.post", rkey: "abc")
        XCTAssertEqual(parsed.type, .post)
        XCTAssertEqual(parsed.uri, "at://alice.bsky.social/app.bsky.feed.post/abc")
        XCTAssertEqual(parsed.collection, "app.bsky.feed.post")
        XCTAssertEqual(parsed.rkey, "abc")
        XCTAssertNil(parsed.did)
    }

    func testParsesAPostByDidAndKeepsTheDid() {
        let parsed = parseURI(handle: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc")
        XCTAssertEqual(parsed.type, .post)
        XCTAssertEqual(parsed.did, "did:plc:x")
        XCTAssertEqual(parsed.handle, "did:plc:x")
    }

    func testParsesAList() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: "app.bsky.graph.list", rkey: "abc")
        XCTAssertEqual(parsed.type, .list)
        XCTAssertEqual(parsed.uri, "at://alice.bsky.social/app.bsky.graph.list/abc")
    }

    func testOtherCollectionsAreGenericRecords() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: "app.bsky.feed.like", rkey: "abc")
        XCTAssertEqual(parsed.type, .record)
        XCTAssertEqual(parsed.uri, "at://alice.bsky.social/app.bsky.feed.like/abc")
    }

    func testReportsAMissingHandle() {
        let parsed = parseURI(handle: "")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertEqual(parsed.error, "Handle or DID is required")
        XCTAssertEqual(parsed.uri, "")
        XCTAssertEqual(parsed.handle, "")
    }

    func testMissingHandleWinsOverOtherSegments() {
        let parsed = parseURI(handle: "", collection: "app.bsky.feed.post", rkey: "abc")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertEqual(parsed.error, "Handle or DID is required")
    }

    func testReportsACollectionWithNoRkeyAsAnInvalidStructure() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: "app.bsky.feed.post")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertEqual(parsed.error, "Invalid URI structure")
        XCTAssertEqual(parsed.uri, "")
        XCTAssertEqual(parsed.handle, "alice.bsky.social")
    }

    func testReportsAnRkeyWithNoCollectionAsAnInvalidStructure() {
        let parsed = parseURI(handle: "alice.bsky.social", collection: nil, rkey: "abc")
        XCTAssertEqual(parsed.type, .unknown)
        XCTAssertEqual(parsed.error, "Invalid URI structure")
    }

    // MARK: displayName

    func testDisplayName() {
        XCTAssertEqual(displayName(handle: "alice.bsky.social"), "@alice.bsky.social")
        XCTAssertEqual(displayName(handle: "alice.bsky.social", did: "did:plc:x"), "@alice.bsky.social")
        XCTAssertEqual(displayName(handle: "did:plc:z72i7hdynmk6r22z27h6tvur", did: "did:plc:z72i7hdynmk6r22z27h6tvur"), "@did:plc:z72i7hdy...")
        XCTAssertEqual(displayName(handle: "did:plc:x", did: "did:plc:x"), "@did:plc:x...")
        XCTAssertEqual(displayName(handle: "did:plc:x"), "Unknown")
    }

    func testKindRawValuesMatchTheWaypointTypeUnion() {
        XCTAssertEqual(ParsedURI.Kind.allCases.map(\.rawValue), ["post", "profile", "list", "record", "unknown"])
    }
}
