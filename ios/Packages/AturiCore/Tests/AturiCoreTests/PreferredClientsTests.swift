import XCTest
@testable import AturiCore

/// Port of packages/waypoints/src/__tests__/preferredClients.test.ts and the
/// declared-client cases of src/utils/__tests__/autoRedirect.test.ts. The
/// derived templates are pinned to the exact strings the TypeScript tests
/// expect, so the two implementations cannot drift apart.
final class PreferredClientsTests: XCTestCase {
    private let did = "did:plc:abc234def567"
    private var post: String { "at://\(did)/app.bsky.feed.post/3k7" }
    private var list: String { "at://\(did)/app.bsky.graph.list/l1" }
    private var tangledRepo: String { "at://\(did)/sh.tangled.repo/r1" }

    private func client(_ id: String) -> DeclaredClient {
        guard let client = declaredClient(fromWaypoint: id) else {
            XCTFail("no declared client for \(id)")
            return DeclaredClient(url: "https://invalid.test")
        }
        return client
    }

    // MARK: Templates from the catalog

    func testCatalogClientMatchesTheWeb() {
        XCTAssertEqual(client("blacksky"), DeclaredClient(
            url: "https://blacksky.community",
            name: "Blacksky",
            waypoint: "blacksky",
            templates: [
                .profile: "https://blacksky.community/profile/{handle}",
                .post: "https://blacksky.community/profile/{handle}/post/{rkey}",
                .list: "https://blacksky.community/profile/{handle}/lists/{rkey}",
            ]
        ))
        XCTAssertEqual(client("pdsls").templates, [
            .profile: "https://pdsls.dev/at://{actor}",
            .post: "https://pdsls.dev/at://{actor}/app.bsky.feed.post/{rkey}",
            .list: "https://pdsls.dev/at://{actor}/app.bsky.graph.list/{rkey}",
            .record: "https://pdsls.dev/at://{actor}/{collection}/{rkey}",
        ])
    }

    func testEveryCatalogClientInAKnownCategoryIsDeclarable() {
        for category in PreferredClients.categories {
            let members = WaypointCatalog.order.filter { WaypointCatalog.all[$0]?.redirectCompat.contains(category) == true }
            XCTAssertGreaterThan(members.count, 1)
            for id in members {
                XCTAssertNotNil(declaredClient(fromWaypoint: id), id)
            }
        }
        XCTAssertNil(declaredClient(fromWaypoint: "nope"))
    }

    func testDerivedTemplatesReproduceTheCatalogBuilders() {
        let handle = "bob.example.org"
        let did = "did:plc:zzz777yyy888"
        let inputs: [(ClientLinkTemplateKind, String?, String?)] = [
            (.profile, nil, nil),
            (.post, "app.bsky.feed.post", "p1"),
            (.list, "app.bsky.graph.list", "l1"),
            (.record, "org.example.thing", "r1"),
        ]
        for id in WaypointCatalog.order {
            guard let waypoint = WaypointCatalog.all[id], let templates = waypointLinkTemplates(id) else { continue }
            for (kind, collection, rkey) in inputs {
                guard let template = templates[kind] else { continue }
                let only = DeclaredClient(url: "https://x.test", templates: [kind: template])
                let target = CustomWaypointContext(handle: handle, did: did, collection: collection, rkey: rkey)
                XCTAssertEqual(
                    preferredClientUrl(only, target: target),
                    waypoint.url(handle: handle, collection: collection, rkey: rkey, did: did),
                    "\(id) \(kind)"
                )
            }
        }
    }

    // MARK: Links

    func testOpensPostsListsAndProfiles() {
        let blacksky = client("blacksky")
        XCTAssertEqual(preferredClientUrl(blacksky, atUri: post), "https://blacksky.community/profile/\(did)/post/3k7")
        XCTAssertEqual(preferredClientUrl(blacksky, atUri: list), "https://blacksky.community/profile/\(did)/lists/l1")
        XCTAssertEqual(preferredClientUrl(blacksky, atUri: "at://\(did)"), "https://blacksky.community/profile/\(did)")
        XCTAssertNil(preferredClientUrl(blacksky, atUri: tangledRepo))
        XCTAssertEqual(preferredClientUrl(client("pdsls"), atUri: tangledRepo), "https://pdsls.dev/at://\(did)/sh.tangled.repo/r1")
    }

    func testFallsBackFromPostToRecordAndFromRecordToCatalog() {
        let explorer = DeclaredClient(url: "https://explorer.example", templates: [.record: "https://explorer.example/{did}/{collection}/{rkey}"])
        XCTAssertEqual(preferredClientUrl(explorer, atUri: post), "https://explorer.example/\(did)/app.bsky.feed.post/3k7")

        let partial = DeclaredClient(url: "https://deer.social", waypoint: "deer", templates: [.profile: "https://deer.social/profile/{handle}"])
        XCTAssertEqual(preferredClientUrl(partial, atUri: post), "https://deer.social/profile/\(did)/post/3k7")

        var own = client("deer")
        own.templates = [.post: "https://deer.social/p/{rkey}"]
        XCTAssertEqual(preferredClientUrl(own, atUri: post), "https://deer.social/p/3k7")
    }

    func testPlaceholdersEncodingAndMissingValues() {
        let needsDid = DeclaredClient(url: "https://x.example", templates: [.profile: "https://x.example/{did}"])
        XCTAssertNil(preferredClientUrl(needsDid, target: CustomWaypointContext(handle: "alice.example.com")))
        let record = DeclaredClient(url: "https://x.example", templates: [.record: "https://x.example/{actor}/{collection}/{rkey}"])
        XCTAssertEqual(
            preferredClientUrl(record, target: CustomWaypointContext(did: did, collection: "a.b.c", rkey: "a/b?c")),
            "https://x.example/\(did)/a.b.c/a%2Fb%3Fc"
        )
    }

    func testNeverReturnsANonHttpUrl() {
        let hostile = DeclaredClient(url: "https://x.example", templates: [.profile: "javascript:alert({handle})", .post: "data:text/html,{rkey}"])
        XCTAssertNil(preferredClientUrl(hostile, atUri: "at://\(did)"))
        XCTAssertNil(preferredClientUrl(hostile, atUri: post))
        XCTAssertNil(preferredClientUrl(client("pdsls"), atUri: "at://\(did)/space/x.y/z"))
    }

    // MARK: Record

    func testRoundTripsWhatBuildWrites() {
        let built = PreferredClientsRecord.build(
            [ClientPreference(category: "bluesky-social", client: client("blacksky"), mobile: client("deer"))],
            now: Date(timeIntervalSince1970: 1_767_323_045)
        )
        XCTAssertEqual(built.updatedAt, "2026-01-02T03:04:05.000Z")
        let value = built.toRecordValue()
        XCTAssertEqual(value["$type"]?.stringValue, PreferredClients.collection)
        XCTAssertEqual(PreferredClientsRecord(recordValue: value), built)
    }

    func testRefusesValuesThatAreNotADeclaration() {
        XCTAssertNil(PreferredClientsRecord(recordValue: nil))
        XCTAssertNil(PreferredClientsRecord(recordValue: .string("x")))
        XCTAssertNil(PreferredClientsRecord(recordValue: .object(["$type": .string("app.bsky.feed.post"), "preferences": .array([])])))
        XCTAssertNil(PreferredClientsRecord(recordValue: .object(["$type": .string(PreferredClients.collection)])))
    }

    func testDropsMalformedEntriesAndUnsafeClients() throws {
        let raw = #"""
        {"$type":"to.aturi.client.declaration","preferences":[
          "nope",
          {"client":{"url":"https://bsky.app"}},
          {"category":"bluesky-social","client":{"url":"javascript:alert(1)"}},
          {"category":"atproto-explorer","client":{"url":"https://pdsls.dev","name":42,"templates":{"record":7,"profile":"https://pdsls.dev/at://{did}"}},"desktop":{"url":"not a url"}},
          {"category":"org.example.thing","mobile":{"url":"https://thing.example"}}
        ]}
        """#
        let parsed = try XCTUnwrap(PreferredClientsRecord(recordValue: JSONValue.parse(Data(raw.utf8))))
        XCTAssertEqual(parsed.preferences, [
            ClientPreference(category: "atproto-explorer", client: DeclaredClient(url: "https://pdsls.dev", templates: [.profile: "https://pdsls.dev/at://{did}"])),
            ClientPreference(category: "org.example.thing", mobile: DeclaredClient(url: "https://thing.example")),
        ])
    }

    func testBuildKeepsTheFirstEntryPerCategory() {
        let built = PreferredClientsRecord.build([
            ClientPreference(category: "bluesky-social"),
            ClientPreference(category: "bluesky-social", client: client("deer")),
            ClientPreference(category: "bluesky-social", client: client("blacksky")),
        ])
        XCTAssertEqual(built.preferences, [ClientPreference(category: "bluesky-social", client: client("deer"))])
    }

    func testPlatformLookup() {
        let record = PreferredClientsRecord.build([
            ClientPreference(category: "bluesky-social", client: client("bluesky"), mobile: client("blacksky")),
            ClientPreference(category: "atproto-explorer", desktop: client("pdsls")),
        ])
        XCTAssertEqual(record.client(for: "bluesky-social", platform: .mobile)?.waypoint, "blacksky")
        XCTAssertEqual(record.client(for: "bluesky-social", platform: .desktop)?.waypoint, "bluesky")
        XCTAssertEqual(record.client(for: "bluesky-social")?.waypoint, "bluesky")
        XCTAssertEqual(record.client(for: "atproto-explorer", platform: .desktop)?.waypoint, "pdsls")
        XCTAssertNil(record.client(for: "atproto-explorer", platform: .mobile))
        XCTAssertNil(record.client(for: "atproto-explorer"))
        XCTAssertNil(record.client(for: "standard-site"))
    }

    // MARK: Auto-redirect

    private let skylark = DeclaredClient(
        url: "https://skylark.example",
        name: "Skylark",
        templates: [.profile: "https://skylark.example/u/{handle}", .post: "https://skylark.example/u/{handle}/p/{rkey}"]
    )

    private let lens = DeclaredClient(
        url: "https://lens.example",
        name: "Lens",
        templates: [.profile: "https://lens.example/{did}", .record: "https://lens.example/{did}/{collection}/{rkey}"]
    )

    private func on() -> Preferences {
        var prefs = Preferences.defaults
        prefs.autoRedirect = true
        return prefs
    }

    private func declared(_ preferences: [ClientPreference], platform: ClientPlatform = .mobile) -> DeclaredClients {
        DeclaredClients(record: PreferredClientsRecord.build(preferences), platform: platform)
    }

    private let handle = "alice.test"
    private let contextDid = "did:plc:example000000000000000"
    private let rkey = "3kexamplerkey00"
    private var postContext: AutoRedirectContext {
        AutoRedirectContext(type: .post, handle: handle, did: contextDid, collection: "app.bsky.feed.post", rkey: rkey)
    }
    private var tangledContext: AutoRedirectContext {
        AutoRedirectContext(type: .record, handle: handle, did: contextDid, collection: "sh.tangled.repo", rkey: rkey)
    }

    func testDeclaredCatalogClientFillsAnEmptyFamily() {
        let blacksky = declared([ClientPreference(category: "bluesky-social", client: client("blacksky"))])
        XCTAssertEqual(effectiveFavorites(on(), declared: blacksky), [.blueskySocial: "blacksky"])
        XCTAssertEqual(
            resolveAutoRedirect(on(), context: postContext, selfHost: "aturi.to", declared: blacksky)?.url,
            "https://blacksky.community/profile/\(handle)/post/\(rkey)"
        )
    }

    func testAFavoriteAlwaysBeatsTheDeclaration() {
        let blacksky = declared([ClientPreference(category: "bluesky-social", client: client("blacksky"))])
        var prefs = on()
        prefs.setFavorite(for: .blueskySocial, waypointId: "deer")
        XCTAssertEqual(resolveAutoRedirect(prefs, context: postContext, selfHost: "aturi.to", declared: blacksky)?.waypointId, "deer")
        prefs.setFavorite(for: .blueskySocial, waypointId: "retired-client")
        XCTAssertNil(resolveAutoRedirect(prefs, context: postContext, selfHost: "aturi.to", declared: blacksky))
    }

    func testFollowSwitchAndMasterSwitch() {
        let blacksky = declared([ClientPreference(category: "bluesky-social", client: client("blacksky"))])
        var prefs = on()
        prefs.setFollowDeclaredClients(false)
        XCTAssertNil(resolveAutoRedirect(prefs, context: postContext, selfHost: "aturi.to", declared: blacksky))
        XCTAssertNil(resolveAutoRedirect(Preferences.defaults, context: postContext, selfHost: "aturi.to", declared: blacksky))
    }

    func testTheDevicePicksTheClient() {
        let split = [ClientPreference(category: "bluesky-social", client: client("bluesky"), mobile: client("blacksky"))]
        XCTAssertEqual(resolveAutoRedirect(on(), context: postContext, selfHost: "aturi.to", declared: declared(split, platform: .mobile))?.waypointId, "blacksky")
        XCTAssertEqual(resolveAutoRedirect(on(), context: postContext, selfHost: "aturi.to", declared: declared(split, platform: .desktop))?.waypointId, "bluesky")
    }

    func testTemplateOnlyClientsOpenWhatTheirFamilyCovers() {
        let mine = declared([
            ClientPreference(category: "bluesky-social", client: skylark),
            ClientPreference(category: "atproto-explorer", client: lens),
        ])
        XCTAssertEqual(effectiveFavorites(on(), declared: mine), [
            .blueskySocial: "declared:bluesky-social",
            .atprotoExplorer: "declared:atproto-explorer",
        ])
        let post = resolveAutoRedirect(on(), context: postContext, selfHost: "aturi.to", declared: mine)
        XCTAssertEqual(post?.waypointId, "declared:bluesky-social")
        XCTAssertEqual(post?.url, "https://skylark.example/u/\(handle)/p/\(rkey)")
        let repo = resolveAutoRedirect(on(), context: tangledContext, selfHost: "aturi.to", declared: mine)
        XCTAssertEqual(repo?.waypointId, "declared:atproto-explorer")
        XCTAssertEqual(repo?.url, "https://lens.example/\(contextDid)/sh.tangled.repo/\(rkey)")

        XCTAssertEqual(effectiveFavorites(on(), declared: declared([ClientPreference(category: "standard-site", client: skylark)])), [:])
    }

    func testDeclaredClientsPassTheSafetyChecks() {
        let selfLoop = declared([ClientPreference(
            category: "atproto-explorer",
            client: DeclaredClient(url: "https://aturi.to", templates: [.record: "https://aturi.to/x/{collection}/{rkey}"])
        )])
        XCTAssertNil(resolveAutoRedirect(on(), context: tangledContext, selfHost: "aturi.to", declared: selfLoop))
        let explore = declared([ClientPreference(category: "atproto-explorer", client: client("aturiExplore"))])
        XCTAssertNil(resolveAutoRedirect(on(), context: tangledContext, selfHost: "aturi.to", declared: explore))
    }

    func testFollowDeclaredClientsDefaultsOnAndRoundTrips() {
        XCTAssertTrue(Preferences.defaults.followDeclaredClients)
        XCTAssertTrue(Preferences.mergeWithDefaults(.object([:])).followDeclaredClients)
        XCTAssertFalse(Preferences.mergeWithDefaults(.object(["followDeclaredClients": .bool(false)])).followDeclaredClients)
        var off = Preferences.defaults
        off.setFollowDeclaredClients(false)
        XCTAssertFalse(Preferences.preferencesAreEqual(Preferences.defaults, off))
        XCTAssertEqual(off.toRecordValue()["followDeclaredClients"], .bool(false))
        XCTAssertFalse(Preferences(recordValue: off.toRecordValue()).followDeclaredClients)
    }

    // MARK: The Clients settings form

    func testDraftSeedsFromTheRecordOrTheFavorites() {
        let published = PreferredClientsRecord.build([
            ClientPreference(category: "bluesky-social", client: client("bluesky"), mobile: client("blacksky")),
            ClientPreference(category: "org.example.thing", client: lens),
        ])
        let options = PreferredClientsDraft.options(customWaypoints: [], published: published)
        let draft = PreferredClientsDraft(published: published, options: options, favorites: [:])
        XCTAssertEqual(draft.slots[.blueskySocial], DeclaredClientSlots(client: "waypoint:bluesky", mobile: "waypoint:blacksky", split: true))
        XCTAssertEqual(draft.slots[.atprotoExplorer], DeclaredClientSlots())

        // Unchanged, the draft publishes exactly what is there, the category
        // it doesn't offer included.
        XCTAssertTrue(PreferredClientsDraft.samePreferences(draft.preferences(options: options, published: published), published.preferences))

        let fresh = PreferredClientsDraft(published: nil, options: options, favorites: [.blueskySocial: "deer"])
        XCTAssertEqual(fresh.slots[.blueskySocial]?.client, "waypoint:deer")
    }

    func testDraftKeepsClientsItDoesNotOffer() {
        let published = PreferredClientsRecord.build([ClientPreference(category: "bluesky-social", client: skylark)])
        let options = PreferredClientsDraft.options(customWaypoints: [], published: published)
        let recordOption = options[.blueskySocial]?.first { $0.source == .record }
        XCTAssertEqual(recordOption?.client, skylark)

        var draft = PreferredClientsDraft(published: published, options: options, favorites: [:])
        XCTAssertEqual(draft.slots[.blueskySocial]?.client, recordOption?.id)
        draft.slots[.blueskySocial]?.split = true
        draft.slots[.blueskySocial]?.desktop = "waypoint:deer"
        let next = draft.preferences(options: options, published: published)
        XCTAssertEqual(next, [ClientPreference(category: "bluesky-social", client: skylark, desktop: client("deer"))])
        XCTAssertFalse(PreferredClientsDraft.samePreferences(next, published.preferences))
    }

    func testCustomWaypointsBecomeDeclarableClients() {
        let custom = CustomWaypoint(
            id: "custom:mine",
            name: "Mine",
            supportedTypes: [.profile, .post],
            templates: [.profile: "https://mine.example/u/{handle}", .post: "https://mine.example/u/{handle}/p/{rkey}"],
            redirectCompat: [.blueskySocial]
        )
        XCTAssertEqual(declaredClient(fromCustom: custom), DeclaredClient(
            url: "https://mine.example",
            name: "Mine",
            templates: [.profile: "https://mine.example/u/{handle}", .post: "https://mine.example/u/{handle}/p/{rkey}"]
        ))
        let options = PreferredClientsDraft.options(customWaypoints: [custom], published: nil)
        XCTAssertTrue(options[.blueskySocial]?.contains { $0.id == "custom:custom:mine" } == true)
        XCTAssertFalse(options[.atprotoExplorer]?.contains { $0.source == .custom } == true)
    }
}
