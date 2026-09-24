import XCTest
@testable import AturiCore

final class PersonalizeTests: XCTestCase {
    private let custom = CustomWaypoint(
        id: "custom:one",
        name: "MyApp",
        domain: "myapp.example",
        supportedTypes: [.profile, .post],
        templates: [.profile: "https://myapp.example/u/{handle}", .post: "https://myapp.example/u/{handle}/p/{rkey}"],
        redirectCompat: [.blueskySocial]
    )

    func testCustomToWaypointDescriptionFallbacks() {
        XCTAssertEqual(Personalize.customToWaypoint(custom).describe(collection: nil), "Open on myapp.example")
        XCTAssertEqual(Personalize.customToWaypoint(custom).describe(collection: "app.bsky.feed.post"), "Open on myapp.example")
        var described = custom
        described.description = "My reader"
        XCTAssertEqual(Personalize.customToWaypoint(described).describe(collection: nil), "My reader")
        var bare = custom
        bare.domain = nil
        bare.description = ""
        XCTAssertEqual(Personalize.customToWaypoint(bare).describe(collection: nil), "Custom waypoint")
    }

    func testCustomToWaypointShape() {
        let waypoint = Personalize.customToWaypoint(custom)
        XCTAssertEqual(waypoint.id, "custom:one")
        XCTAssertEqual(waypoint.name, "MyApp")
        XCTAssertEqual(waypoint.category, "custom")
        XCTAssertEqual(waypoint.supportedTypes, [.profile, .post])
        XCTAssertEqual(waypoint.redirectCompat, [.blueskySocial])
        XCTAssertNil(waypoint.composeIntent)
        XCTAssertNil(waypoint.expectedCollections)
        XCTAssertEqual(waypoint.url(handle: "alice"), "https://myapp.example/u/alice")
        XCTAssertEqual(waypoint.url(handle: "alice", collection: "app.bsky.feed.post", rkey: "rk", did: "did:plc:x"), "https://myapp.example/u/alice/p/rk")
        var noFamily = custom
        noFamily.redirectCompat = nil
        XCTAssertEqual(Personalize.customToWaypoint(noFamily).redirectCompat, [])
        let needsRkey = CustomWaypoint(id: "custom:r", name: "R", supportedTypes: [.record], templates: [.record: "https://r.test/{rkey}"])
        XCTAssertNil(Personalize.customToWaypoint(needsRkey).url(handle: "alice"), "unsatisfied placeholders give nil, not a broken URL")
    }

    func testPersonalizeCategorizedBuildsFromGroupsInOrder() {
        var prefs = Preferences.defaults
        prefs.customWaypoints = [custom]
        prefs.waypointGroups = [
            WaypointGroup(id: "g_mine", name: "Mine", waypointIds: ["deer", "custom:one", "retiredWaypoint", "bluesky"]),
            WaypointGroup(id: "publications", name: "Reading", waypointIds: ["offprint"]),
            WaypointGroup(id: "g_empty", name: "Empty", waypointIds: []),
            WaypointGroup(id: "g_lists", name: "Lists", waypointIds: ["reddwarf"]),
        ]
        let post = Personalize.personalizeCategorized(prefs, type: .post)
        XCTAssertEqual(post.map(\.category.id), ["g_mine", "publications", "g_lists"])
        XCTAssertEqual(post[0].category.name, "Mine")
        XCTAssertEqual(post[0].category.defaultWaypointId, "deer")
        XCTAssertEqual(post[0].waypoints.map(\.id), ["deer", "custom:one", "bluesky"], "unknown ids are dropped, order kept")
        XCTAssertEqual(post[0].waypoints[1].category, "custom")
        XCTAssertTrue(post[0].category.subcategories.isEmpty)

        // The custom waypoint does not support lists, and neither does Red Dwarf.
        let list = Personalize.personalizeCategorized(prefs, type: .list)
        XCTAssertEqual(list.map(\.category.id), ["g_mine", "publications"])
        XCTAssertEqual(list[0].waypoints.map(\.id), ["deer", "bluesky"])
    }

    func testPersonalizeCategorizedWithDefaultsMirrorsTheCatalogGroups() {
        let categorized = Personalize.personalizeCategorized(.defaults, type: .post)
        XCTAssertEqual(categorized.map(\.category.id), ["blueskyClients", "blueskyForks", "publications", "atmosphereApps", "devTools"])
        XCTAssertEqual(categorized.flatMap(\.waypoints).map(\.id), Preferences.defaults.waypointGroups.flatMap(\.waypointIds))
        XCTAssertEqual(Set(categorized.flatMap(\.waypoints).map(\.id)), Set(WaypointCatalog.forType(.post).map(\.id)))
        XCTAssertEqual(categorized.map(\.category.defaultWaypointId), ["anisota", "blacksky", "leaflet", "aturi", "aturiExplore"])
        XCTAssertTrue(Personalize.personalizeCategorized(Preferences(waypointGroups: []), type: .post).isEmpty)
    }

    func testPersonalizeRecommendedKeepsOnlyVisibleIds() {
        var prefs = Preferences.defaults
        prefs.waypointGroups = [WaypointGroup(id: "g", name: "G", waypointIds: ["anisota", "pdsls"])]
        let recommended = WaypointCatalog.recommended(for: .post, collection: "app.bsky.feed.post").waypoints
        XCTAssertEqual(recommended.map(\.id), ["bluesky", "anisota", "blacksky"])
        XCTAssertEqual(Personalize.personalizeRecommended(recommended, prefs: prefs).map(\.id), ["anisota"])
        prefs.waypointGroups = []
        XCTAssertEqual(Personalize.personalizeRecommended(recommended, prefs: prefs), [])
        XCTAssertEqual(Personalize.personalizeRecommended(recommended, prefs: .defaults).map(\.id), ["bluesky", "anisota", "blacksky"])
    }
}
