import XCTest
@testable import AturiCore

final class WaypointDirectoryTests: XCTestCase {
    private let custom = CustomWaypoint(
        id: "custom:mine",
        name: "My Reader",
        domain: "reader.example",
        supportedTypes: [.post, .profile],
        templates: [.post: "https://reader.example/{handle}/{rkey}", .profile: "https://reader.example/{handle}"]
    )

    private func link(type: WaypointType, collection: String? = nil, rkey: String? = nil) -> ResolvedLink {
        let parsed = parseURI(handle: "alice.test", collection: collection, rkey: rkey)
        let atUri = collection.flatMap { c in rkey.map { "at://did:plc:alice123/\(c)/\($0)" } } ?? "at://did:plc:alice123"
        return ResolvedLink(
            components: AtUriComponents(identifier: "alice.test", collection: collection, rkey: rkey),
            parsed: parsed,
            type: type,
            did: "did:plc:alice123",
            handle: "alice.test",
            displayName: "@alice.test",
            collection: collection,
            rkey: rkey,
            atUri: atUri,
            aturiLink: generateAturiLink(AtUriComponents(identifier: "alice.test", collection: collection, rkey: rkey))
        )
    }

    private var post: ResolvedLink {
        link(type: .post, collection: "app.bsky.feed.post", rkey: "3kabc")
    }

    // MARK: Listings

    func testListingsAreTheCatalogInOrderThenCustoms() {
        let listings = WaypointDirectory.listings(customWaypoints: [custom])
        XCTAssertEqual(listings.map(\.id), WaypointCatalog.order + ["custom:mine"])
        let deer = listings.first { $0.id == "deer" }
        XCTAssertEqual(deer?.name, "Deer")
        XCTAssertEqual(deer?.host, "deer.social")
        XCTAssertEqual(deer?.category, "Bluesky Forks")
        XCTAssertEqual(deer?.isCustom, false)
        let mine = listings.last
        XCTAssertEqual(mine?.host, "reader.example")
        XCTAssertEqual(mine?.category, "My Waypoints")
        XCTAssertEqual(mine?.isCustom, true)
        XCTAssertEqual(mine?.supportedTypes, [.post, .profile])
    }

    func testMatchingSearchesNamesHostsAndIds() {
        XCTAssertEqual(WaypointDirectory.listings(matching: "DEER", customWaypoints: []).map(\.id), ["deer"])
        XCTAssertEqual(WaypointDirectory.listings(matching: "pdsls.dev", customWaypoints: []).map(\.id), ["pdsls"])
        XCTAssertEqual(WaypointDirectory.listings(matching: "aturiExplore", customWaypoints: []).map(\.id), ["aturiExplore"])
        XCTAssertEqual(WaypointDirectory.listings(matching: "my reader", customWaypoints: [custom]).map(\.id), ["custom:mine"])
        XCTAssertEqual(WaypointDirectory.listings(matching: "reader", customWaypoints: [custom]).map(\.id), ["anisotaReader", "standardReader", "custom:mine"])
        XCTAssertEqual(WaypointDirectory.listings(matching: "  ", customWaypoints: []).count, WaypointCatalog.count)
        XCTAssertTrue(WaypointDirectory.listings(matching: "no such client", customWaypoints: []).isEmpty)
    }

    func testListingsForIdsKeepTheAskedOrderAndDropTheGone() {
        let listings = WaypointDirectory.listings(ids: ["pdsls", "custom:gone", "bluesky", "custom:mine"], customWaypoints: [custom])
        XCTAssertEqual(listings.map(\.id), ["pdsls", "bluesky", "custom:mine"])
    }

    // MARK: Client links

    func testBuiltInLinksMatchThePicker() {
        XCTAssertEqual(WaypointDirectory.clientLink(for: post, waypointId: "deer", customWaypoints: []), .success("https://deer.social/profile/alice.test/post/3kabc"))
        XCTAssertEqual(WaypointDirectory.clientLink(for: post, waypointId: "pdsls", customWaypoints: []), .success("https://pdsls.dev/at://did:plc:alice123/app.bsky.feed.post/3kabc"))
        XCTAssertEqual(WaypointDirectory.clientLink(for: link(type: .profile), waypointId: "bluesky", customWaypoints: []), .success("https://bsky.app/profile/alice.test"))
    }

    func testAClientThatCannotOpenThePageSaysWhy() {
        let list = link(type: .list, collection: "app.bsky.graph.list", rkey: "3klist")
        XCTAssertEqual(WaypointDirectory.clientLink(for: list, waypointId: "reddwarf", customWaypoints: []), .failure(.unsupportedType(.list)))
        XCTAssertEqual(WaypointDirectory.clientLink(for: link(type: .profile), waypointId: "offprint", customWaypoints: []), .failure(.noDestination))
        XCTAssertEqual(WaypointDirectory.clientLink(for: post, waypointId: "custom:gone", customWaypoints: [custom]), .failure(.unknownWaypoint))
    }

    func testCustomWaypointsExpandTheirTemplates() {
        XCTAssertEqual(WaypointDirectory.clientLink(for: post, waypointId: "custom:mine", customWaypoints: [custom]), .success("https://reader.example/alice.test/3kabc"))
        let record = link(type: .record, collection: "com.example.thing", rkey: "abc")
        XCTAssertEqual(WaypointDirectory.clientLink(for: record, waypointId: "custom:mine", customWaypoints: [custom]), .failure(.unsupportedType(.record)))
    }

    func testCustomWaypointsMustProduceWebLinks() {
        let sneaky = CustomWaypoint(
            id: "custom:sneaky",
            name: "Sneaky",
            supportedTypes: [.profile],
            templates: [.profile: "shortcuts://run-shortcut?name={handle}"]
        )
        XCTAssertEqual(WaypointDirectory.clientLink(for: link(type: .profile), waypointId: "custom:sneaky", customWaypoints: [sneaky]), .failure(.unsafeDestination))
    }
}
