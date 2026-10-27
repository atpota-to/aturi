import XCTest
@testable import AturiCore

/// Port of the pure-decision tests in src/utils/__tests__/autoRedirect.test.ts.
/// The inline-script, breadcrumb and back/forward cases are browser
/// behaviour and have no counterpart here.
final class AutoRedirectTests: XCTestCase {
    private let handle = "alice.test"
    private let did = "did:plc:example000000000000000"
    private let rkey = "3kexamplerkey00"

    private var post: AutoRedirectContext {
        AutoRedirectContext(type: .post, handle: handle, did: did, collection: "app.bsky.feed.post", rkey: rkey)
    }

    private var profile: AutoRedirectContext {
        AutoRedirectContext(type: .profile, handle: handle, did: did)
    }

    private var tangled: AutoRedirectContext {
        AutoRedirectContext(type: .record, handle: handle, did: did, collection: "sh.tangled.repo", rkey: rkey)
    }

    private let candidates: [AutoRedirectCandidate] = [
        AutoRedirectCandidate(id: "alpha", url: "https://alpha.test/x", families: [.blueskySocial]),
        AutoRedirectCandidate(id: "beta", url: "https://beta.test/x", families: [.pinksky]),
        AutoRedirectCandidate(id: "gamma", url: "https://gamma.test/x", families: [.tangled]),
    ]

    private func prefs(autoRedirect: Bool, favorites: [RedirectCompatFamily: String], custom: [CustomWaypoint] = []) -> Preferences {
        var prefs = Preferences.defaults
        prefs.autoRedirect = autoRedirect
        prefs.favoriteByFamily = favorites
        prefs.customWaypoints = custom
        return prefs
    }

    // MARK: isSafeRedirectUrl

    func testIsSafeRedirectUrlAllowsOnlyHttpAndHttps() {
        XCTAssertTrue(isSafeRedirectUrl("https://bsky.app/profile/alice.test"))
        XCTAssertTrue(isSafeRedirectUrl("http://example.test/x"))
        XCTAssertTrue(isSafeRedirectUrl("HTTPS://Example.test/x"))
        // The reason the function exists: a custom template comes from a
        // PDS record and auto-redirect follows it with no tap.
        XCTAssertFalse(isSafeRedirectUrl("javascript:alert(1)"))
        XCTAssertFalse(isSafeRedirectUrl("  javascript:alert(1)"))
        XCTAssertFalse(isSafeRedirectUrl("JavaScript:alert(1)"))
        XCTAssertFalse(isSafeRedirectUrl("data:text/html,<script>alert(1)</script>"))
        XCTAssertFalse(isSafeRedirectUrl("file:///etc/passwd"))
        XCTAssertFalse(isSafeRedirectUrl("//evil.test/x"))
        XCTAssertFalse(isSafeRedirectUrl("/relative/path"))
        XCTAssertFalse(isSafeRedirectUrl("not a url"))
        XCTAssertFalse(isSafeRedirectUrl(""))
        XCTAssertFalse(isSafeRedirectUrl("https://"))
        XCTAssertFalse(isSafeRedirectUrl("https:///path"))
    }

    func testIsSafeRedirectUrlRefusesOurOwnHostCaseInsensitively() {
        XCTAssertFalse(isSafeRedirectUrl("https://aturi.to/explore/x", selfHost: "aturi.to"))
        XCTAssertFalse(isSafeRedirectUrl("https://ATURI.to/explore/x", selfHost: "aturi.to"))
        XCTAssertFalse(isSafeRedirectUrl("https://aturi.to/explore/x", selfHost: "ATURI.TO"))
        XCTAssertTrue(isSafeRedirectUrl("https://bsky.app/x", selfHost: "aturi.to"))
        // Similar-but-different hosts are not ours.
        XCTAssertTrue(isSafeRedirectUrl("https://aturi.to.evil.test/x", selfHost: "aturi.to"))
        XCTAssertTrue(isSafeRedirectUrl("https://aturi.to:8443/x", selfHost: "aturi.to"), "the port is part of the host")
        XCTAssertTrue(isSafeRedirectUrl("https://aturi.to/x", selfHost: ""))
    }

    // MARK: buildAutoRedirectCandidates

    func testCandidatesForABskyPostIncludeBlueskyClientsAndGenericExplorers() {
        let ids = buildAutoRedirectCandidates(post).map(\.id)
        XCTAssertTrue(ids.contains("bluesky"), "bsky.app should be a candidate for a post")
        // PDSls declares no expectedCollections and joins the explorer family.
        XCTAssertTrue(ids.contains("pdsls"), "pdsls should be reachable via its family")
        XCTAssertEqual(ids, WaypointCatalog.order.filter { ids.contains($0) }, "catalog order")
    }

    func testAWaypointThatOptsOutOfRedirectsIsNeverACandidate() {
        XCTAssertEqual(WaypointCatalog.all["taproot"]?.redirectCompat.count, 0)
        let ids = buildAutoRedirectCandidates(AutoRedirectContext(type: .record, handle: handle, did: did, collection: "com.example.thing", rkey: rkey)).map(\.id)
        XCTAssertFalse(ids.contains("taproot"))
        XCTAssertTrue(ids.contains("pdsls"))
    }

    func testCandidatesRespectTheCollectionAWaypointClaims() {
        let postIds = buildAutoRedirectCandidates(post).map(\.id)
        XCTAssertFalse(postIds.contains("tangled"), "Tangled declares sh.tangled.* and must not claim a bsky post")
        let tangledIds = buildAutoRedirectCandidates(tangled).map(\.id)
        XCTAssertFalse(tangledIds.contains("bluesky"), "a bsky client must not claim an sh.tangled record")
        XCTAssertTrue(tangledIds.contains("tangled"))
        XCTAssertTrue(tangledIds.contains("aturi"), "no expectedCollections means no opinion")
    }

    func testCandidatesRespectTheRecordTypeAWaypointSupports() {
        let profileCandidates = buildAutoRedirectCandidates(profile)
        XCTAssertFalse(profileCandidates.isEmpty)
        for candidate in profileCandidates {
            XCTAssertFalse(candidate.url.isEmpty, "\(candidate.id) produced an empty URL for a profile")
        }
        for candidate in buildAutoRedirectCandidates(post) {
            XCTAssertFalse(candidate.families.isEmpty, "\(candidate.id) has no families")
        }
        // Offprint supports profiles in name but builds no URL for one.
        XCTAssertFalse(profileCandidates.map(\.id).contains("offprint"))
    }

    func testCandidatesDropWaypointsServedFromOurOwnHost() {
        let host = WaypointCatalog.host(of: "aturiExplore")
        XCTAssertEqual(host, "aturi.to")
        XCTAssertTrue(buildAutoRedirectCandidates(post).map(\.id).contains("aturiExplore"))
        let ids = buildAutoRedirectCandidates(post, selfHost: host).map(\.id)
        XCTAssertFalse(ids.contains("aturiExplore"), "a waypoint on our own host would redirect the page to itself")
        XCTAssertFalse(ids.contains("aturi"))
        XCTAssertTrue(ids.contains("bluesky"))
    }

    // MARK: resolveAutoRedirectTarget

    func testNoFavoritesMeansNoRedirect() {
        XCTAssertNil(resolveAutoRedirectTarget(favoriteByFamily: [:], candidates: candidates))
        XCTAssertNil(resolveAutoRedirectTarget(favoriteByFamily: nil, candidates: candidates))
    }

    func testCompatFamilyOrderBreaksATieBetweenTwoClaimingFamilies() {
        let target = resolveAutoRedirectTarget(favoriteByFamily: [.pinksky: "beta", .blueskySocial: "alpha"], candidates: candidates)
        XCTAssertEqual(target?.waypointId, "alpha")
        XCTAssertEqual(target?.family, .blueskySocial)
        XCTAssertEqual(target?.url, "https://alpha.test/x")
    }

    func testAFavoriteThatCannotRenderThisPageIsSkippedForTheNextFamily() {
        let target = resolveAutoRedirectTarget(favoriteByFamily: [.blueskySocial: "not-a-candidate", .tangled: "gamma"], candidates: candidates)
        XCTAssertEqual(target?.waypointId, "gamma")
        XCTAssertEqual(target?.family, .tangled)
    }

    func testAStaleFavoriteWhoseWaypointLeftTheFamilyIsSkipped() {
        XCTAssertNil(resolveAutoRedirectTarget(favoriteByFamily: [.tangled: "alpha"], candidates: candidates))
    }

    func testAnEmptyFavoriteIsTreatedAsAbsent() {
        XCTAssertNil(resolveAutoRedirectTarget(favoriteByFamily: [.blueskySocial: ""], candidates: candidates))
    }

    // MARK: resolveAutoRedirect

    func testTheMasterSwitchGatesEverything() {
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: false, favorites: [.blueskySocial: "bluesky"]), context: post))
        let target = resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "bluesky"]), context: post)
        XCTAssertEqual(target?.waypointId, "bluesky")
        XCTAssertEqual(target?.url, "https://bsky.app/profile/alice.test/post/3kexamplerkey00")
    }

    func testACustomWaypointThatDeclaresAFamilyCanWin() {
        let mine = CustomWaypoint(id: "custom:mine", name: "Mine", supportedTypes: [.post], templates: [.post: "https://mine.test/{handle}/{rkey}"], redirectCompat: [.blueskySocial])
        let target = resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:mine"], custom: [mine]), context: post)
        XCTAssertEqual(target?.waypointId, "custom:mine")
        XCTAssertEqual(target?.url, "https://mine.test/\(handle)/\(rkey)")
    }

    func testACustomWaypointDeclaringNoFamilyIsNeverADestination() {
        let mine = CustomWaypoint(id: "custom:mine", name: "Mine", supportedTypes: [.post], templates: [.post: "https://mine.test/{handle}/{rkey}"])
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:mine"], custom: [mine]), context: post))
        var empty = mine
        empty.redirectCompat = []
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:mine"], custom: [empty]), context: post))
    }

    func testAnUnsafeCustomTemplateNeverBecomesATarget() {
        let evil = CustomWaypoint(id: "custom:evil", name: "Evil", supportedTypes: [.post], templates: [.post: "javascript:alert({rkey})"], redirectCompat: [.blueskySocial])
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:evil"], custom: [evil]), context: post))
        let loop = CustomWaypoint(id: "custom:loop", name: "Loop", supportedTypes: [.post], templates: [.post: "https://aturi.to/profile/{handle}/post/{rkey}"], redirectCompat: [.blueskySocial])
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:loop"], custom: [loop]), context: post, selfHost: "aturi.to"))
        XCTAssertNotNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:loop"], custom: [loop]), context: post))
    }

    func testACustomWaypointThatDoesNotSupportTheTypeIsSkipped() {
        let mine = CustomWaypoint(id: "custom:mine", name: "Mine", supportedTypes: [.profile], templates: [.profile: "https://mine.test/{handle}"], redirectCompat: [.blueskySocial])
        XCTAssertNil(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:mine"], custom: [mine]), context: post))
        XCTAssertEqual(resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "custom:mine"], custom: [mine]), context: profile)?.url, "https://mine.test/alice.test")
    }

    func testABuiltInWinsATieWithACustomInTheSameFamily() {
        let mine = CustomWaypoint(id: "custom:mine", name: "Mine", supportedTypes: [.post], templates: [.post: "https://mine.test/{rkey}"], redirectCompat: [.blueskySocial])
        let target = resolveAutoRedirect(prefs(autoRedirect: true, favorites: [.blueskySocial: "deer", .pinksky: "custom:mine"], custom: [mine]), context: post)
        XCTAssertEqual(target?.waypointId, "deer")
    }

    // MARK: Cache

    func testThePrePaintCacheCarriesTheSwitchAndTheFavorites() {
        var prefs = Preferences.defaults
        prefs.autoRedirect = true
        prefs.setFavorite(for: .blueskySocial, waypointId: "deer")
        prefs.setFavorite(for: .tangled, waypointId: nil)
        XCTAssertEqual(autoRedirectCacheFor(prefs), AutoRedirectCache(enabled: true, byFamily: [.blueskySocial: "deer"]))
        XCTAssertEqual(autoRedirectCacheFor(.defaults), AutoRedirectCache(enabled: false, byFamily: [:]))
    }

    func testParsingTheCacheRejectsJunkAndDefaultsToDisabled() {
        XCTAssertNil(AutoRedirectCache(parsing: "not json"))
        XCTAssertNil(AutoRedirectCache(parsing: "[]"))
        XCTAssertNil(AutoRedirectCache(parsing: "null"))
        XCTAssertEqual(AutoRedirectCache(parsing: "{}"), AutoRedirectCache(enabled: false, byFamily: [:]))
        let parsed = AutoRedirectCache(parsing: #"{"enabled": true, "byFamily": {"bluesky-social": "deer", "bogus": "x", "tangled": 3, "margin": ""}}"#)
        XCTAssertEqual(parsed, AutoRedirectCache(enabled: true, byFamily: [.blueskySocial: "deer"]))
        XCTAssertEqual(AutoRedirectCache(parsing: #"{"enabled": "yes"}"#)?.enabled, false)
        let cache = AutoRedirectCache(enabled: true, byFamily: [.blueskySocial: "deer"])
        XCTAssertEqual(AutoRedirectCache(json: cache.jsonValue), cache)
    }
}
