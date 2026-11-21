import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the details store: the first pattern
/// found in the URL answers, anything else is a 404.
private final class DetailsFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let routes: [(pattern: String, status: Int, body: String)]
    private var requests: [String] = []

    init(_ routes: [(String, Int, String)]) {
        self.routes = routes.map { (pattern: $0.0, status: $0.1, body: $0.2) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        record(url.absoluteString)
        let route = routes.first { url.absoluteString.contains($0.pattern) }
        let status = route?.status ?? 404
        let body = route?.body ?? #"{"error":"NotFound"}"#
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (Data(body.utf8), response)
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ url: String) {
        lock.lock(); defer { lock.unlock() }
        requests.append(url)
    }

    func count(containing fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.contains(fragment) }.count
    }
}

/// Port of src/utils/atproto/__tests__/backlinkDetails.test.ts, plus the
/// store the web keeps as module-level caches.
@MainActor
final class BacklinkDetailsTests: XCTestCase {
    // MARK: Pure parts

    func testAStarterPackReadsAsItsName() {
        XCTAssertEqual(
            BacklinkDetails.describeLinkingRecord("app.bsky.graph.starterpack", value: .object(["name": .string("Comic Artists"), "list": .string("at://x")])),
            RecordContext(kind: "Starter pack", text: "Comic Artists")
        )
    }

    func testADocumentPrefersItsTitleToItsBody() {
        XCTAssertEqual(
            BacklinkDetails.describeLinkingRecord("site.standard.document", value: .object(["title": .string("Release notes"), "text": .string("Long body")])),
            RecordContext(kind: "Document", text: "Release notes")
        )
    }

    func testAnUnknownRecordTypeKeepsItsTextWithoutAKind() {
        XCTAssertEqual(
            BacklinkDetails.describeLinkingRecord("place.stream.chat.message", value: .object(["text": .string("  hello\n\n there ")])),
            RecordContext(kind: nil, text: "hello there")
        )
    }

    func testLongTextIsCutWithAnEllipsis() throws {
        let context = try XCTUnwrap(BacklinkDetails.describeLinkingRecord("app.example.note", value: .object(["text": .string(String(repeating: "a", count: 500))])))
        XCTAssertEqual(context.text.count, 300)
        XCTAssertTrue(context.text.hasSuffix("\u{2026}"))
    }

    func testARecordWithNoWordsHasNoContext() {
        XCTAssertNil(BacklinkDetails.describeLinkingRecord("app.example.thing", value: .object(["subject": .string("did:plc:x"), "createdAt": .string("2026-01-01")])))
        XCTAssertNil(BacklinkDetails.describeLinkingRecord("app.example.thing", value: .null))
        XCTAssertNil(BacklinkDetails.describeLinkingRecord("app.example.thing", value: nil))
        XCTAssertNil(BacklinkDetails.describeLinkingRecord("app.example.thing", value: .object(["title": .string("   ")])), "blank text is no text")
    }

    func testListPurposesNameTheList() {
        XCTAssertEqual(BacklinkDetails.listKind("app.bsky.graph.defs#curatelist"), "List")
        XCTAssertEqual(BacklinkDetails.listKind("app.bsky.graph.defs#modlist"), "Moderation list")
        XCTAssertEqual(BacklinkDetails.listKind("app.bsky.graph.defs#referencelist"), "Starter pack list")
        XCTAssertEqual(BacklinkDetails.listKind(nil), "List")
    }

    func testFollowsBlocksLikesAndRepostsAreNeverFetchedForContext() {
        XCTAssertTrue(BacklinkDetails.hasNoContext("app.bsky.graph.follow"))
        XCTAssertTrue(BacklinkDetails.hasNoContext("network.cosmik.follow"))
        XCTAssertTrue(BacklinkDetails.hasNoContext("app.bsky.feed.block"))
        XCTAssertTrue(BacklinkDetails.hasNoContext("app.bsky.feed.like"))
        XCTAssertTrue(BacklinkDetails.hasNoContext("app.bsky.feed.repost"))
        XCTAssertFalse(BacklinkDetails.hasNoContext("app.bsky.graph.listitem"))
        XCTAssertFalse(BacklinkDetails.hasNoContext("app.bsky.feed.post"))
    }

    func testAListItemNamesTheAccountItAddsAndItsList() {
        XCTAssertEqual(
            BacklinkDetails.listItemMember(.object(["subject": .string("did:plc:member"), "list": .string("at://did:plc:owner/app.bsky.graph.list/3kabc")])),
            ListMember(did: "did:plc:member", list: "at://did:plc:owner/app.bsky.graph.list/3kabc")
        )
        XCTAssertNil(BacklinkDetails.listItemMember(.object(["subject": .string("did:plc:member")])))
        XCTAssertNil(BacklinkDetails.listItemMember(.object(["subject": .string("alice.example"), "list": .string("at://did:plc:owner/app.bsky.graph.list/3kabc")])))
        XCTAssertNil(BacklinkDetails.listItemMember(nil))
    }

    // MARK: The store

    nonisolated private static let profiles = "app.bsky.actor.getProfiles"
    nonisolated private static let posts = "app.bsky.feed.getPosts"
    nonisolated private static let slingshot = "slingshot.microcosm.blue"
    nonisolated private static let listItemRecord = "getRecordByUri?at_uri=at%3A%2F%2Fdid%3Aplc%3Aowner%2Fapp.bsky.graph.listitem%2F3li"
    nonisolated private static let listRecord = "getRecordByUri?at_uri=at%3A%2F%2Fdid%3Aplc%3Aowner%2Fapp.bsky.graph.list%2F3kl"
    nonisolated private static let packRecord = "getRecordByUri?at_uri=at%3A%2F%2Fdid%3Aplc%3Acarol%2Fapp.bsky.graph.starterpack%2F3sp"

    nonisolated private static let profilesBody = #"{"profiles":[{"did":"did:plc:bob","handle":"bob.test","displayName":"Bob","avatar":"https://cdn.example/img/avatar/plain/bob"},{"did":"did:plc:owner","handle":"owner.test"},{"did":"did:plc:member","handle":"member.test"}]}"#
    nonisolated private static let postsBody = #"{"posts":[{"uri":"at://did:plc:bob/app.bsky.feed.post/3kp","cid":"c","author":{"did":"did:plc:bob","handle":"bob.test"},"record":{"$type":"app.bsky.feed.post","text":"  hello\nthere ","createdAt":"2026-01-01T00:00:00Z"},"indexedAt":"2026-01-01T00:00:00Z"}]}"#
    nonisolated private static let listItemBody = #"{"uri":"at://did:plc:owner/app.bsky.graph.listitem/3li","cid":"c","value":{"$type":"app.bsky.graph.listitem","subject":"did:plc:member","list":"at://did:plc:owner/app.bsky.graph.list/3kl","createdAt":"2026-01-01T00:00:00Z"}}"#
    nonisolated private static let listBody = #"{"uri":"at://did:plc:owner/app.bsky.graph.list/3kl","cid":"c","value":{"$type":"app.bsky.graph.list","name":"Good people","purpose":"app.bsky.graph.defs#modlist","createdAt":"2026-01-01T00:00:00Z"}}"#
    nonisolated private static let packBody = #"{"uri":"at://did:plc:carol/app.bsky.graph.starterpack/3sp","cid":"c","value":{"$type":"app.bsky.graph.starterpack","name":"Comic Artists","list":"at://x","createdAt":"2026-01-01T00:00:00Z"}}"#

    private func happyTransport(overrides: [(String, Int, String)] = []) -> DetailsFakeTransport {
        DetailsFakeTransport(overrides + [
            (Self.profiles, 200, Self.profilesBody),
            (Self.posts, 200, Self.postsBody),
            (Self.listItemRecord, 200, Self.listItemBody),
            (Self.listRecord, 200, Self.listBody),
            (Self.packRecord, 200, Self.packBody),
        ])
    }

    nonisolated private static let post = BacklinkRecord(did: "did:plc:bob", collection: "app.bsky.feed.post", rkey: "3kp")
    nonisolated private static let like = BacklinkRecord(did: "did:plc:bob", collection: "app.bsky.feed.like", rkey: "3kl1")
    nonisolated private static let listItem = BacklinkRecord(did: "did:plc:owner", collection: "app.bsky.graph.listitem", rkey: "3li")
    nonisolated private static let pack = BacklinkRecord(did: "did:plc:carol", collection: "app.bsky.graph.starterpack", rkey: "3sp")

    func testHydrateFillsProfilesPostsListsAndOtherRecords() async {
        let transport = happyTransport()
        let store = BacklinkDetailsStore(http: HTTPClient(transport: transport))
        await store.hydrate([Self.post, Self.like, Self.listItem, Self.pack])

        XCTAssertEqual(store.profile(for: "did:plc:bob"), LinkerProfile(did: "did:plc:bob", handle: "bob.test", displayName: "Bob", avatar: "https://cdn.example/img/avatar/plain/bob"))
        XCTAssertNil(store.profile(for: "did:plc:carol"))
        XCTAssertTrue(store.isProfileKnown("did:plc:carol"), "the AppView answered and does not know carol")
        XCTAssertTrue(store.missingProfiles.contains("did:plc:carol"))
        XCTAssertEqual(store.profile(for: "did:plc:member")?.handle, "member.test", "a list item's member is looked up after its list item")

        XCTAssertEqual(store.context(for: Self.post.atUri), RecordContext(text: "hello there"))
        XCTAssertNil(store.context(for: Self.like.atUri))
        XCTAssertTrue(store.isContextKnown(Self.like.atUri), "a like settles without a request")
        XCTAssertEqual(
            store.context(for: Self.listItem.atUri),
            RecordContext(kind: "Moderation list", text: "Good people", member: ListMember(did: "did:plc:member", list: "at://did:plc:owner/app.bsky.graph.list/3kl"))
        )
        XCTAssertEqual(store.context(for: Self.pack.atUri), RecordContext(kind: "Starter pack", text: "Comic Artists"))

        XCTAssertEqual(transport.count(containing: Self.profiles), 2, "the linking accounts, then the member")
        XCTAssertEqual(transport.count(containing: Self.posts), 1)
        XCTAssertEqual(transport.count(containing: "app.bsky.feed.like"), 0, "likes are never fetched")
        XCTAssertEqual(transport.count(containing: Self.slingshot), 3, "the list item, the starter pack, then the list")
    }

    func testWhatIsKnownIsNeverAskedForAgain() async {
        let transport = happyTransport()
        let store = BacklinkDetailsStore(http: HTTPClient(transport: transport))
        await store.hydrate([Self.post, Self.pack])
        await store.hydrate([Self.post, Self.pack])
        XCTAssertEqual(transport.count(containing: Self.profiles), 1)
        XCTAssertEqual(transport.count(containing: Self.posts), 1)
        XCTAssertEqual(transport.count(containing: Self.slingshot), 1)
    }

    func testAFailedLookupIsLeftUnknownAndAskedAgain() async {
        let transport = happyTransport(overrides: [(Self.profiles, 503, "down"), (Self.posts, 503, "down")])
        let store = BacklinkDetailsStore(http: HTTPClient(transport: transport))
        await store.hydrate([Self.post])
        XCTAssertFalse(store.isProfileKnown("did:plc:bob"), "a failed chunk marks nobody as missing")
        XCTAssertFalse(store.isContextKnown(Self.post.atUri))

        await store.hydrate([Self.post])
        XCTAssertEqual(transport.count(containing: Self.profiles), 2)
        XCTAssertEqual(transport.count(containing: Self.posts), 2)
    }

    func testARecordSlingshotCannotFindSettlesWithoutContext() async {
        let transport = happyTransport()
        let store = BacklinkDetailsStore(http: HTTPClient(transport: transport))
        let missing = BacklinkRecord(did: "did:plc:carol", collection: "app.example.card", rkey: "3gone")
        await store.hydrate([missing])
        XCTAssertNil(store.context(for: missing.atUri))
        XCTAssertTrue(store.isContextKnown(missing.atUri))
        await store.hydrate([missing])
        XCTAssertEqual(transport.count(containing: Self.slingshot), 1)
    }
}
