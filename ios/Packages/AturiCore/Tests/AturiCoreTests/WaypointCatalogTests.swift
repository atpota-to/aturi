import XCTest
@testable import AturiCore

// Port of packages/waypoints/src/__tests__/waypoints.data.test.ts, the
// catalog-facing halves of universalLinks.test.ts and resolve.test.ts, the
// waypointHost case of src/utils/__tests__/autoRedirect.test.ts, and a full
// regression table of every waypoint's URLs derived from waypoints.data.ts.
final class WaypointCatalogTests: XCTestCase {
    private func waypoint(_ id: String) -> Waypoint {
        guard let waypoint = WaypointCatalog.all[id] else {
            XCTFail("missing waypoint \(id)")
            fatalError("missing waypoint \(id)")
        }
        return waypoint
    }

    // MARK: Regression table

    /// One row per id in `WaypointCatalog.order`: the URL for a post record
    /// (handle alice.test, rkey 3abc, did did:plc:x), the profile URL when a
    /// DID is known, and the profile URL when only the handle is known. Every
    /// string was derived by hand from the TypeScript builders.
    private struct WaypointUrlRow {
        let id: String
        let post: String?
        let profileWithDid: String?
        let profileHandleOnly: String?
    }

    private static let pinkleapPost =
        "https://pinkleap.app/feed?uri=at%3A%2F%2Fdid%3Aplc%3Ax%2Fapp.bsky.feed.post%2F3abc&src=profile&index=1&did=did%3Aplc%3Ax&showThreads=did%3Aplc%3Ax"

    private static let urlTable: [WaypointUrlRow] = [
        WaypointUrlRow(id: "anisota", post: "https://anisota.net/profile/alice.test/post/3abc", profileWithDid: "https://anisota.net/profile/alice.test", profileHandleOnly: "https://anisota.net/profile/alice.test"),
        WaypointUrlRow(id: "bluesky", post: "https://bsky.app/profile/alice.test/post/3abc", profileWithDid: "https://bsky.app/profile/alice.test", profileHandleOnly: "https://bsky.app/profile/alice.test"),
        WaypointUrlRow(id: "bluepy", post: "https://bluepy.social/at://did:plc:x/app.bsky.feed.post/3abc", profileWithDid: "https://bluepy.social/at://did:plc:x/app.bsky.actor.profile/self", profileHandleOnly: "https://bluepy.social/at://alice.test/app.bsky.actor.profile/self"),
        WaypointUrlRow(id: "reddwarf", post: "https://reddwarf.app/profile/alice.test/post/3abc", profileWithDid: "https://reddwarf.app/profile/alice.test", profileHandleOnly: "https://reddwarf.app/profile/alice.test"),
        WaypointUrlRow(id: "impro", post: "https://impro.social/profile/alice.test/post/3abc", profileWithDid: "https://impro.social/profile/alice.test", profileHandleOnly: "https://impro.social/profile/alice.test"),
        WaypointUrlRow(id: "blacksky", post: "https://blacksky.community/profile/alice.test/post/3abc", profileWithDid: "https://blacksky.community/profile/alice.test", profileHandleOnly: "https://blacksky.community/profile/alice.test"),
        WaypointUrlRow(id: "leaflet", post: "https://leaflet.pub/p/alice.test", profileWithDid: "https://leaflet.pub/p/alice.test", profileHandleOnly: "https://leaflet.pub/p/alice.test"),
        WaypointUrlRow(id: "aturi", post: "https://aturi.to/profile/alice.test/post/3abc", profileWithDid: "https://aturi.to/profile/alice.test", profileHandleOnly: "https://aturi.to/profile/alice.test"),
        WaypointUrlRow(id: "pinksky", post: pinkleapPost, profileWithDid: "https://pinkleap.app/profile/alice.test", profileHandleOnly: "https://pinkleap.app/profile/alice.test"),
        WaypointUrlRow(id: "margin", post: "https://margin.at/profile/did:plc:x", profileWithDid: "https://margin.at/profile/did:plc:x", profileHandleOnly: "https://margin.at/profile/alice.test"),
        WaypointUrlRow(id: "semble", post: "https://semble.so/profile/alice.test", profileWithDid: "https://semble.so/profile/alice.test", profileHandleOnly: "https://semble.so/profile/alice.test"),
        WaypointUrlRow(id: "streamplace", post: "https://stream.place/alice.test", profileWithDid: "https://stream.place/alice.test", profileHandleOnly: "https://stream.place/alice.test"),
        WaypointUrlRow(id: "grain", post: "https://grain.social/profile/did:plc:x", profileWithDid: "https://grain.social/profile/did:plc:x", profileHandleOnly: "https://grain.social/profile/alice.test"),
        WaypointUrlRow(id: "popfeed", post: "https://popfeed.social/profile/did:plc:x", profileWithDid: "https://popfeed.social/profile/did:plc:x", profileHandleOnly: "https://popfeed.social/profile/alice.test"),
        WaypointUrlRow(id: "sifa", post: "https://sifa.id/p/alice.test", profileWithDid: "https://sifa.id/p/alice.test", profileHandleOnly: "https://sifa.id/p/alice.test"),
        WaypointUrlRow(id: "blento", post: "https://blento.app/alice.test", profileWithDid: "https://blento.app/alice.test", profileHandleOnly: "https://blento.app/alice.test"),
        WaypointUrlRow(id: "anisotaReader", post: "https://anisota.net/profile/alice.test", profileWithDid: "https://anisota.net/profile/alice.test", profileHandleOnly: "https://anisota.net/profile/alice.test"),
        WaypointUrlRow(id: "offprint", post: "https://offprint.app/did:plc:x/app.bsky.feed.post/3abc", profileWithDid: nil, profileHandleOnly: nil),
        WaypointUrlRow(id: "pckt", post: "https://pckt.blog/did:plc:x/app.bsky.feed.post/3abc", profileWithDid: nil, profileHandleOnly: nil),
        WaypointUrlRow(id: "standardReader", post: "https://standard-reader.app/u/did:plc:x", profileWithDid: "https://standard-reader.app/u/did:plc:x", profileHandleOnly: "https://standard-reader.app/u/alice.test"),
        WaypointUrlRow(id: "aturiExplore", post: "https://aturi.to/explore/did:plc:x/app.bsky.feed.post/3abc", profileWithDid: "https://aturi.to/explore/did:plc:x", profileHandleOnly: "https://aturi.to/explore/alice.test"),
        WaypointUrlRow(id: "pdsls", post: "https://pdsls.dev/at://did:plc:x/app.bsky.feed.post/3abc", profileWithDid: "https://pdsls.dev/at://did:plc:x", profileHandleOnly: "https://pdsls.dev/at://alice.test"),
        WaypointUrlRow(id: "tangled", post: "https://tangled.org/alice.test", profileWithDid: "https://tangled.org/alice.test", profileHandleOnly: "https://tangled.org/alice.test"),
        WaypointUrlRow(id: "atptools", post: "https://atp.tools/at:/did:plc:x/app.bsky.feed.post/3abc", profileWithDid: "https://atp.tools/at:/did:plc:x", profileHandleOnly: "https://atp.tools/at:/alice.test"),
        WaypointUrlRow(id: "taproot", post: "https://atproto.at/uri/at://did:plc:x/app.bsky.feed.post/3abc", profileWithDid: "https://atproto.at/uri/at://did:plc:x", profileHandleOnly: "https://atproto.at/uri/at://alice.test"),
        WaypointUrlRow(id: "witchsky", post: "https://witchsky.app/profile/alice.test/post/3abc", profileWithDid: "https://witchsky.app/profile/alice.test", profileHandleOnly: "https://witchsky.app/profile/alice.test"),
        WaypointUrlRow(id: "mu", post: "https://mu.social/profile/alice.test/post/3abc", profileWithDid: "https://mu.social/profile/alice.test", profileHandleOnly: "https://mu.social/profile/alice.test"),
        WaypointUrlRow(id: "deer", post: "https://deer.social/profile/alice.test/post/3abc", profileWithDid: "https://deer.social/profile/alice.test", profileHandleOnly: "https://deer.social/profile/alice.test"),
        WaypointUrlRow(id: "lea", post: "https://lea.ac/profile/alice.test/post/3abc", profileWithDid: "https://lea.ac/profile/alice.test", profileHandleOnly: "https://lea.ac/profile/alice.test"),
        WaypointUrlRow(id: "northsky", post: "https://northsky.app/profile/alice.test/post/3abc", profileWithDid: "https://northsky.app/profile/alice.test", profileHandleOnly: "https://northsky.app/profile/alice.test"),
    ]

    func testUrlTableCoversEveryWaypointInOrder() {
        XCTAssertEqual(Self.urlTable.map(\.id), WaypointCatalog.order)
        XCTAssertEqual(Set(WaypointCatalog.all.keys), Set(WaypointCatalog.order))
        XCTAssertEqual(WaypointCatalog.count, 30)
    }

    func testUrlTableMatchesEveryBuilder() {
        for row in Self.urlTable {
            let waypoint = waypoint(row.id)
            XCTAssertEqual(
                waypoint.url(handle: "alice.test", collection: "app.bsky.feed.post", rkey: "3abc", did: "did:plc:x"),
                row.post, "post url for \(row.id)"
            )
            XCTAssertEqual(
                waypoint.url(handle: "alice.test", did: "did:plc:x"),
                row.profileWithDid, "profile url (with did) for \(row.id)"
            )
            XCTAssertEqual(
                waypoint.url(handle: "alice.test"),
                row.profileHandleOnly, "profile url (handle only) for \(row.id)"
            )
            // The raw closure and the labelled spelling are the same call.
            XCTAssertEqual(waypoint.url("alice.test", "app.bsky.feed.post", "3abc", "did:plc:x"), row.post)
        }
    }

    // MARK: getUrl

    func testBuildsBlueskyPostUrl() {
        XCTAssertEqual(
            waypoint("bluesky").url(handle: "alice.bsky.social", collection: "app.bsky.feed.post", rkey: "abc"),
            "https://bsky.app/profile/alice.bsky.social/post/abc"
        )
    }

    func testBuildsAnisotaPostUrl() {
        XCTAssertEqual(
            waypoint("anisota").url(handle: "alice.bsky.social", collection: "app.bsky.feed.post", rkey: "abc"),
            "https://anisota.net/profile/alice.bsky.social/post/abc"
        )
    }

    // Regression: these clients advertised `list` support but had no
    // `app.bsky.graph.list` branch, so every list URL collapsed to its
    // author's profile.
    func testBuildsListUrls() {
        let cases: [(String, String)] = [
            ("bluesky", "https://bsky.app"),
            ("blacksky", "https://blacksky.community"),
            ("witchsky", "https://witchsky.app"),
            ("deer", "https://deer.social"),
            ("mu", "https://mu.social"),
            ("northsky", "https://northsky.app"),
            ("impro", "https://impro.social"),
            ("anisota", "https://anisota.net"),
            ("aturi", "https://aturi.to"),
        ]
        for (id, origin) in cases {
            XCTAssertEqual(
                waypoint(id).url(handle: "alice.bsky.social", collection: "app.bsky.graph.list", rkey: "abc"),
                "\(origin)/profile/alice.bsky.social/lists/abc", id
            )
        }
    }

    func testBuildsLeaPostUrl() {
        XCTAssertEqual(
            waypoint("lea").url(handle: "alice.bsky.social", collection: "app.bsky.feed.post", rkey: "abc"),
            "https://lea.ac/profile/alice.bsky.social/post/abc"
        )
    }

    func testDoesNotAdvertiseListSupportWithoutAListRoute() {
        for id in ["reddwarf", "lea"] {
            XCTAssertFalse(waypoint(id).supportedTypes.contains(.list), id)
        }
    }

    func testNeverSendsAListToItsAuthor() {
        // Waypoints in the bluesky-social family render bsky lists themselves,
        // so one claiming `list` support has to address the list rather than
        // fall back to the author's profile.
        for waypoint in WaypointCatalog.all.values {
            guard waypoint.redirectCompat.contains(.blueskySocial) else { continue }
            guard waypoint.supportedTypes.contains(.list) else { continue }
            let list = waypoint.url(handle: "alice.bsky.social", collection: "app.bsky.graph.list", rkey: "abc")
            let profile = waypoint.url(handle: "alice.bsky.social")
            XCTAssertNotEqual(list, profile, waypoint.id)
        }
    }

    func testReturnsNilForOffprintWithoutARecord() {
        XCTAssertNil(waypoint("offprint").url(handle: "alice.bsky.social"))
        XCTAssertNil(waypoint("pckt").url(handle: "alice.bsky.social"))
    }

    func testBlankArgumentsBehaveLikeMissingOnes() {
        // JS `collection && rkey` and `did || handle` are falsy for "".
        XCTAssertEqual(
            waypoint("bluesky").url(handle: "alice.test", collection: "app.bsky.feed.post", rkey: ""),
            "https://bsky.app/profile/alice.test"
        )
        XCTAssertEqual(waypoint("pdsls").url(handle: "alice.test", did: ""), "https://pdsls.dev/at://alice.test")
        XCTAssertNil(waypoint("offprint").url(handle: "alice.test", collection: "", rkey: ""))
        XCTAssertEqual(waypoint("aturi").describe(collection: ""), "View profile on aturi.to")
    }

    // MARK: URL branches beyond the post table

    func testAturiRecordUrlPrefersDid() {
        let aturi = waypoint("aturi")
        XCTAssertEqual(
            aturi.url(handle: "alice.bsky.social", collection: "pub.leaflet.document", rkey: "xyz", did: "did:plc:abc"),
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz"
        )
        XCTAssertEqual(
            aturi.url(handle: "alice.bsky.social", collection: "pub.leaflet.document", rkey: "xyz"),
            "https://aturi.to/profile/alice.bsky.social/pub.leaflet.document/xyz"
        )
    }

    func testAnisotaDocumentUrls() {
        let anisota = waypoint("anisota")
        XCTAssertEqual(
            anisota.url(handle: "alice.test", collection: "site.standard.document", rkey: "doc", did: "did:plc:x"),
            "https://anisota.net/profile/did:plc:x/document/doc"
        )
        XCTAssertEqual(
            anisota.url(handle: "alice.test", collection: "pub.leaflet.document", rkey: "doc"),
            "https://anisota.net/profile/alice.test/document/doc"
        )
        XCTAssertEqual(
            anisota.url(handle: "alice.test", collection: "sh.tangled.repo", rkey: "r", did: "did:plc:x"),
            "https://anisota.net/profile/alice.test"
        )
        let reader = waypoint("anisotaReader")
        XCTAssertEqual(
            reader.url(handle: "alice.test", collection: "site.standard.document", rkey: "doc", did: "did:plc:x"),
            "https://anisota.net/profile/did:plc:x/document/doc"
        )
        XCTAssertEqual(
            reader.url(handle: "alice.test", collection: "site.standard.document", rkey: "doc"),
            "https://anisota.net/profile/alice.test/document/doc"
        )
    }

    func testPublicationReaderUrls() {
        XCTAssertEqual(
            waypoint("standardReader").url(handle: "alice.test", collection: "site.standard.document", rkey: "doc", did: "did:plc:x"),
            "https://standard-reader.app/a/did:plc:x/doc"
        )
        XCTAssertEqual(
            waypoint("standardReader").url(handle: "alice.test", collection: "pub.leaflet.document", rkey: "doc"),
            "https://standard-reader.app/a/alice.test/doc"
        )
        XCTAssertEqual(
            waypoint("offprint").url(handle: "alice.test", collection: "pub.leaflet.document", rkey: "doc"),
            "https://offprint.app/alice.test/pub.leaflet.document/doc"
        )
        XCTAssertEqual(
            waypoint("pckt").url(handle: "alice.test", collection: "site.standard.document", rkey: "doc", did: "did:plc:x"),
            "https://pckt.blog/did:plc:x/site.standard.document/doc"
        )
    }

    func testMarginUrls() {
        let margin = waypoint("margin")
        XCTAssertEqual(
            margin.url(handle: "alice.test", collection: "at.margin.annotation", rkey: "r1", did: "did:plc:x"),
            "https://margin.at/alice.test/annotation/r1"
        )
        XCTAssertEqual(
            margin.url(handle: "alice.test", collection: "at.margin.highlight", rkey: "r1"),
            "https://margin.at/alice.test/highlight/r1"
        )
        XCTAssertEqual(
            margin.url(handle: "alice.test", collection: "at.margin.bookmark", rkey: "r1"),
            "https://margin.at/alice.test/bookmark/r1"
        )
        // A DID handed in as the handle is not a domain, so the identifier is used.
        XCTAssertEqual(
            margin.url(handle: "did:plc:x", collection: "at.margin.annotation", rkey: "r1", did: "did:plc:x"),
            "https://margin.at/did:plc:x/annotation/r1"
        )
        XCTAssertEqual(
            margin.url(handle: "alice.test", collection: "at.margin.collection", rkey: "r1", did: "did:plc:x"),
            "https://margin.at/profile/did:plc:x"
        )
        XCTAssertEqual(
            margin.url(handle: "alice.test", collection: "at.margin.collection", rkey: "r1"),
            "https://margin.at/profile/alice.test"
        )
    }

    func testGrainGalleryUrl() {
        let grain = waypoint("grain")
        XCTAssertEqual(
            grain.url(handle: "alice.test", collection: "social.grain.gallery", rkey: "g1", did: "did:plc:x"),
            "https://grain.social/profile/did:plc:x/gallery/g1"
        )
        XCTAssertEqual(
            grain.url(handle: "alice.test", collection: "social.grain.gallery", rkey: "g1"),
            "https://grain.social/profile/alice.test/gallery/g1"
        )
        XCTAssertEqual(
            grain.url(handle: "alice.test", collection: "social.grain.photo", rkey: "p1", did: "did:plc:x"),
            "https://grain.social/profile/did:plc:x"
        )
    }

    func testAturiExploreEncodesTheRkeyAndSupportsCollectionOnly() {
        let explore = waypoint("aturiExplore")
        XCTAssertEqual(
            explore.url(handle: "alice.test", collection: "app.bsky.feed.post", rkey: "a b/c", did: "did:plc:x"),
            "https://aturi.to/explore/did:plc:x/app.bsky.feed.post/a%20b%2Fc"
        )
        XCTAssertEqual(
            explore.url(handle: "alice.test", collection: "app.bsky.feed.post", did: "did:plc:x"),
            "https://aturi.to/explore/did:plc:x/app.bsky.feed.post"
        )
        XCTAssertEqual(
            explore.url(handle: "alice.test", collection: "app.bsky.feed.post"),
            "https://aturi.to/explore/alice.test/app.bsky.feed.post"
        )
    }

    func testGenericExplorerRecordUrlsFallBackToTheHandle() {
        XCTAssertEqual(
            waypoint("pdsls").url(handle: "alice.test", collection: "com.example.thing", rkey: "k"),
            "https://pdsls.dev/at://alice.test/com.example.thing/k"
        )
        XCTAssertEqual(
            waypoint("atptools").url(handle: "alice.test", collection: "com.example.thing", rkey: "k"),
            "https://atp.tools/at:/alice.test/com.example.thing/k"
        )
        XCTAssertEqual(
            waypoint("taproot").url(handle: "alice.test", collection: "com.example.thing", rkey: "k"),
            "https://atproto.at/uri/at://alice.test/com.example.thing/k"
        )
        XCTAssertEqual(
            waypoint("bluepy").url(handle: "alice.test", collection: "com.example.thing", rkey: "k"),
            "https://bluepy.social/at://alice.test/com.example.thing/k"
        )
    }

    func testBlueskyFamilyRecordUrlsFallBackToTheProfile() {
        for id in ["bluesky", "blacksky", "impro", "witchsky", "deer", "mu", "northsky", "reddwarf", "lea"] {
            XCTAssertEqual(
                waypoint(id).url(handle: "alice.test", collection: "com.example.thing", rkey: "k", did: "did:plc:x"),
                waypoint(id).url(handle: "alice.test"), id
            )
        }
        XCTAssertEqual(
            waypoint("pinksky").url(handle: "alice.test", collection: "app.bsky.graph.list", rkey: "k", did: "did:plc:x"),
            "https://pinkleap.app/profile/alice.test"
        )
    }

    func testPinkleapPostUrlFallsBackToTheHandle() {
        XCTAssertEqual(
            waypoint("pinksky").url(handle: "alice.test", collection: "app.bsky.feed.post", rkey: "3abc"),
            "https://pinkleap.app/feed?uri=at%3A%2F%2Falice.test%2Fapp.bsky.feed.post%2F3abc&src=profile&index=1&did=alice.test&showThreads=alice.test"
        )
    }

    // MARK: Descriptions

    func testDescriptions() {
        let post = "app.bsky.feed.post"
        let list = "app.bsky.graph.list"
        let doc = "site.standard.document"
        let leaflet = "pub.leaflet.document"

        XCTAssertEqual(waypoint("aturi").describe(collection: nil), "View profile on aturi.to")
        XCTAssertEqual(waypoint("aturi").describe(collection: post), "View post on aturi.to")
        XCTAssertEqual(waypoint("aturi").describe(collection: list), "View list on aturi.to")
        XCTAssertEqual(waypoint("aturi").describe(collection: doc), "View document on aturi.to")
        XCTAssertEqual(waypoint("aturi").describe(collection: leaflet), "View document on aturi.to")
        XCTAssertEqual(waypoint("aturi").describe(collection: "com.example.x"), "View record on aturi.to")

        XCTAssertEqual(waypoint("anisota").describe(collection: post), "View post on anisota.net")
        XCTAssertEqual(waypoint("anisota").describe(collection: list), "View list on anisota.net")
        XCTAssertEqual(waypoint("anisota").describe(collection: leaflet), "View document on anisota.net")
        XCTAssertEqual(waypoint("anisota").describe(collection: "com.example.x"), "View profile on anisota.net")
        XCTAssertEqual(waypoint("anisota").describe(nil), "View profile on anisota.net")

        let socialApps: [(String, String)] = [
            ("bluesky", "bsky.app"), ("blacksky", "blacksky.community"), ("impro", "impro.social"),
            ("witchsky", "witchsky.app"), ("deer", "deer.social"), ("mu", "mu.social"), ("northsky", "northsky.app"),
        ]
        for (id, host) in socialApps {
            XCTAssertEqual(waypoint(id).describe(collection: post), "View post on \(host)", id)
            XCTAssertEqual(waypoint(id).describe(collection: list), "View list on \(host)", id)
            XCTAssertEqual(waypoint(id).describe(collection: nil), "View profile on \(host)", id)
            XCTAssertEqual(waypoint(id).describe(collection: "com.example.x"), "View profile on \(host)", id)
        }
        for (id, host) in [("reddwarf", "reddwarf.app"), ("lea", "lea.ac"), ("pinksky", "pinkleap.app")] {
            XCTAssertEqual(waypoint(id).describe(collection: post), "View post on \(host)", id)
            XCTAssertEqual(waypoint(id).describe(collection: list), "View profile on \(host)", id)
            XCTAssertEqual(waypoint(id).describe(collection: nil), "View profile on \(host)", id)
        }

        XCTAssertEqual(waypoint("bluepy").describe(collection: post), "View post on bluepy.social")
        XCTAssertEqual(waypoint("bluepy").describe(collection: list), "View list on bluepy.social")
        XCTAssertEqual(waypoint("bluepy").describe(collection: "com.example.x"), "View record on bluepy.social")
        XCTAssertEqual(waypoint("bluepy").describe(collection: nil), "View profile on bluepy.social")

        XCTAssertEqual(waypoint("leaflet").describe(collection: doc), "View profile on leaflet.pub")
        XCTAssertEqual(waypoint("pdsls").describe(collection: post), "View raw record on pdsls.dev")
        XCTAssertEqual(waypoint("atptools").describe(collection: nil), "View raw record on atp.tools")
        XCTAssertEqual(waypoint("aturiExplore").describe(collection: post), "Inspect record on aturi.to/explore")
        XCTAssertEqual(waypoint("aturiExplore").describe(collection: nil), "Browse repo on aturi.to/explore")
        XCTAssertEqual(waypoint("taproot").describe(collection: post), "Inspect record on atproto.at")
        XCTAssertEqual(waypoint("taproot").describe(collection: nil), "Browse repo on atproto.at")
        XCTAssertEqual(waypoint("tangled").describe(collection: "sh.tangled.repo"), "View profile on tangled.org")

        XCTAssertEqual(waypoint("margin").describe(collection: "at.margin.annotation"), "View annotation on margin.at")
        XCTAssertEqual(waypoint("margin").describe(collection: "at.margin.highlight"), "View highlight on margin.at")
        XCTAssertEqual(waypoint("margin").describe(collection: "at.margin.bookmark"), "View bookmark on margin.at")
        XCTAssertEqual(waypoint("margin").describe(collection: "at.margin.collection"), "View on margin.at")
        XCTAssertEqual(waypoint("margin").describe(collection: post), "View profile on margin.at")
        XCTAssertEqual(waypoint("margin").describe(collection: nil), "View profile on margin.at")

        XCTAssertEqual(waypoint("semble").describe(collection: nil), "View profile on semble.so")
        XCTAssertEqual(waypoint("streamplace").describe(collection: nil), "View profile on stream.place")
        XCTAssertEqual(waypoint("grain").describe(collection: "social.grain.gallery"), "View gallery on grain.social")
        XCTAssertEqual(waypoint("grain").describe(collection: "social.grain.photo"), "View profile on grain.social")
        XCTAssertEqual(waypoint("popfeed").describe(collection: post), "View profile on popfeed.social")
        XCTAssertEqual(waypoint("sifa").describe(collection: nil), "View profile on sifa.id")
        XCTAssertEqual(waypoint("blento").describe(collection: nil), "View profile on blento.app")

        XCTAssertEqual(waypoint("anisotaReader").describe(collection: doc), "Read document on anisota.net")
        XCTAssertEqual(waypoint("anisotaReader").describe(collection: post), "View publications on anisota.net")
        XCTAssertEqual(waypoint("offprint").describe(collection: leaflet), "Read document on offprint.app")
        XCTAssertEqual(waypoint("offprint").describe(collection: nil), "View on offprint.app")
        XCTAssertEqual(waypoint("pckt").describe(collection: doc), "Read document on pckt.blog")
        XCTAssertEqual(waypoint("pckt").describe(collection: post), "View on pckt.blog")
        XCTAssertEqual(waypoint("standardReader").describe(collection: leaflet), "Read document on standard-reader.app")
        XCTAssertEqual(waypoint("standardReader").describe(collection: nil), "View documents on standard-reader.app")
    }

    // MARK: Catalog metadata

    func testNamesCategoriesFamiliesAndExpectedCollections() {
        struct Meta {
            let id: String
            let name: String
            let category: String
            let families: [RedirectCompatFamily]
            let expected: [String]?
            let types: [WaypointType]
        }
        let full: [WaypointType] = [.post, .profile, .list, .record]
        let table: [Meta] = [
            Meta(id: "anisota", name: "Anisota", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky.", "net.anisota."], types: full),
            Meta(id: "bluesky", name: "Bluesky", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "bluepy", name: "Bluepy", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "reddwarf", name: "Red Dwarf", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky."], types: [.post, .profile, .record]),
            Meta(id: "impro", name: "Impro", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "blacksky", name: "Blacksky", category: "blueskyForks", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "leaflet", name: "Leaflet", category: "publications", families: [.standardSite], expected: ["pub.leaflet.", "site.standard."], types: full),
            Meta(id: "aturi", name: "Aturi", category: "atmosphereApps", families: [.blueskySocial, .standardSite], expected: nil, types: full),
            Meta(id: "pinksky", name: "Pinkleap", category: "atmosphereApps", families: [.pinksky], expected: ["app.bsky."], types: full),
            Meta(id: "margin", name: "Margin", category: "atmosphereApps", families: [.margin], expected: ["at.margin."], types: full),
            Meta(id: "semble", name: "Semble", category: "atmosphereApps", families: [.semble], expected: ["so.semble."], types: full),
            Meta(id: "streamplace", name: "Streamplace", category: "atmosphereApps", families: [.streamplace], expected: ["place.stream."], types: full),
            Meta(id: "grain", name: "Grain", category: "atmosphereApps", families: [.grain], expected: ["social.grain."], types: full),
            Meta(id: "popfeed", name: "Popfeed", category: "atmosphereApps", families: [.popfeed], expected: ["social.popfeed."], types: full),
            Meta(id: "sifa", name: "Sifa", category: "atmosphereApps", families: [.sifa], expected: ["id.sifa."], types: full),
            Meta(id: "blento", name: "Blento", category: "atmosphereApps", families: [.blento], expected: ["app.blento."], types: full),
            Meta(id: "anisotaReader", name: "Anisota Reader", category: "publications", families: [.standardSite], expected: ["pub.leaflet.", "site.standard."], types: full),
            Meta(id: "offprint", name: "Offprint", category: "publications", families: [.standardSite], expected: ["pub.leaflet.", "site.standard."], types: full),
            Meta(id: "pckt", name: "pckt", category: "publications", families: [.standardSite], expected: ["pub.leaflet.", "site.standard."], types: full),
            Meta(id: "standardReader", name: "Standard Reader", category: "publications", families: [.standardSite], expected: ["pub.leaflet.", "site.standard."], types: full),
            Meta(id: "aturiExplore", name: "Aturi Explore", category: "devTools", families: [.atprotoExplorer], expected: nil, types: full),
            Meta(id: "pdsls", name: "PDSls", category: "devTools", families: [.atprotoExplorer], expected: nil, types: full),
            Meta(id: "tangled", name: "Tangled", category: "atmosphereApps", families: [.tangled], expected: ["sh.tangled."], types: full),
            Meta(id: "atptools", name: "atp.tools", category: "devTools", families: [.atprotoExplorer], expected: nil, types: full),
            Meta(id: "taproot", name: "Taproot", category: "devTools", families: [], expected: nil, types: full),
            Meta(id: "witchsky", name: "Witchsky", category: "blueskyForks", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "mu", name: "Mu", category: "blueskyForks", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "deer", name: "Deer", category: "blueskyForks", families: [.blueskySocial], expected: ["app.bsky."], types: full),
            Meta(id: "lea", name: "Lea", category: "blueskyClients", families: [.blueskySocial], expected: ["app.bsky."], types: [.post, .profile, .record]),
            Meta(id: "northsky", name: "Northsky", category: "blueskyForks", families: [.blueskySocial], expected: ["app.bsky."], types: full),
        ]
        XCTAssertEqual(table.map(\.id), WaypointCatalog.order)
        for meta in table {
            let waypoint = waypoint(meta.id)
            XCTAssertEqual(waypoint.name, meta.name, meta.id)
            XCTAssertEqual(waypoint.category, meta.category, meta.id)
            XCTAssertEqual(waypoint.redirectCompat, meta.families, meta.id)
            XCTAssertEqual(waypoint.expectedCollections, meta.expected, meta.id)
            XCTAssertEqual(waypoint.supportedTypes, meta.types, meta.id)
            XCTAssertNotNil(WaypointCatalog.categories[waypoint.category], "\(meta.id) category must exist")
        }
    }

    func testCategoriesAndOrder() {
        XCTAssertEqual(WaypointCatalog.categoryOrder, ["blueskyClients", "blueskyForks", "publications", "atmosphereApps", "devTools"])
        XCTAssertEqual(Set(WaypointCatalog.categories.keys), Set(WaypointCatalog.categoryOrder))

        let clients = WaypointCatalog.categories["blueskyClients"]
        XCTAssertEqual(clients?.name, "Bluesky Clients")
        XCTAssertEqual(clients?.description, "Official and alternative Bluesky clients")
        XCTAssertEqual(clients?.defaultWaypointId, "bluesky")
        XCTAssertEqual(clients?.subcategories.map(\.id), ["blueskyForks"])
        XCTAssertEqual(clients?.subcategories.first?.defaultWaypointId, "blacksky")

        XCTAssertEqual(WaypointCatalog.categories["blueskyForks"]?.name, "Bluesky Forks")
        XCTAssertEqual(WaypointCatalog.categories["blueskyForks"]?.description, "Community-built Bluesky variants")
        XCTAssertEqual(WaypointCatalog.categories["publications"]?.defaultWaypointId, "leaflet")
        XCTAssertEqual(WaypointCatalog.categories["publications"]?.description, "Readers for Standard Site and Leaflet publications")
        XCTAssertEqual(WaypointCatalog.categories["atmosphereApps"]?.name, "Atmosphere")
        XCTAssertEqual(WaypointCatalog.categories["atmosphereApps"]?.defaultWaypointId, "tangled")
        XCTAssertEqual(WaypointCatalog.categories["devTools"]?.name, "Dev Tools")
        XCTAssertEqual(WaypointCatalog.categories["devTools"]?.description, "Tools for developers and debugging")
        XCTAssertEqual(WaypointCatalog.categories["devTools"]?.defaultWaypointId, "aturiExplore")
        for category in WaypointCatalog.categories.values {
            XCTAssertNotNil(WaypointCatalog.all[category.defaultWaypointId], category.id)
        }
    }

    func testCompatFamilies() {
        XCTAssertEqual(WaypointCatalog.compatFamilyOrder, [
            .blueskySocial, .standardSite, .pinksky, .tangled, .margin, .grain,
            .semble, .streamplace, .popfeed, .sifa, .blento, .atprotoExplorer,
        ])
        XCTAssertEqual(Set(WaypointCatalog.compatFamilies.keys), Set(RedirectCompatFamily.allCases))
        XCTAssertEqual(Set(WaypointCatalog.compatFamilyOrder), Set(RedirectCompatFamily.allCases))
        for (family, meta) in WaypointCatalog.compatFamilies {
            XCTAssertEqual(meta.id, family)
        }
        XCTAssertEqual(WaypointCatalog.compatFamilies[.blueskySocial]?.name, "Bluesky clients")
        XCTAssertEqual(
            WaypointCatalog.compatFamilies[.blueskySocial]?.description,
            "Apps that render bsky posts, profiles, and lists at /profile/:handle."
        )
        XCTAssertEqual(WaypointCatalog.compatFamilies[.standardSite]?.name, "Publications")
        XCTAssertEqual(WaypointCatalog.compatFamilies[.pinksky]?.name, "Pinkleap")
        XCTAssertEqual(WaypointCatalog.compatFamilies[.atprotoExplorer]?.name, "Record explorers")
        XCTAssertEqual(RedirectCompatFamily.blueskySocial.rawValue, "bluesky-social")
        XCTAssertEqual(RedirectCompatFamily.standardSite.rawValue, "standard-site")
        XCTAssertEqual(RedirectCompatFamily.atprotoExplorer.rawValue, "atproto-explorer")
        XCTAssertEqual(RedirectCompatFamily(rawValue: "tangled"), .tangled)
    }

    // MARK: Type helpers and categorisation

    func testListsPostCapableWaypointsInOrder() {
        let ids = WaypointCatalog.forType(.post).map(\.id)
        XCTAssertEqual(ids.first, "anisota")
        XCTAssertTrue(ids.contains("bluesky"))
        XCTAssertEqual(ids, WaypointCatalog.order)
    }

    func testListSupportExcludesReddwarfAndLea() {
        let ids = WaypointCatalog.forType(.list).map(\.id)
        XCTAssertEqual(ids, WaypointCatalog.order.filter { $0 != "reddwarf" && $0 != "lea" })
        XCTAssertTrue(WaypointCatalog.forType(.unknown).isEmpty)
    }

    func testCategorizedSkipsSubcategoriesAtTopLevel() {
        let groups = WaypointCatalog.categorized(for: .post)
        XCTAssertEqual(groups.map(\.category.id), ["blueskyClients", "publications", "atmosphereApps", "devTools"])
        XCTAssertEqual(groups[0].waypoints.map(\.id), ["anisota", "bluesky", "bluepy", "reddwarf", "impro", "lea"])
        XCTAssertEqual(groups[1].waypoints.map(\.id), ["leaflet", "anisotaReader", "offprint", "pckt", "standardReader"])
        XCTAssertEqual(groups[2].waypoints.map(\.id), ["aturi", "pinksky", "margin", "semble", "streamplace", "grain", "popfeed", "sifa", "blento", "tangled"])
        XCTAssertEqual(groups[3].waypoints.map(\.id), ["aturiExplore", "pdsls", "atptools", "taproot"])
        // The forks are reachable through the parent's subcategory, and the
        // picker filters them from `forType` itself.
        XCTAssertEqual(groups[0].category.subcategories.map(\.id), ["blueskyForks"])
        let forks = WaypointCatalog.forType(.post).filter { $0.category == "blueskyForks" }.map(\.id)
        XCTAssertEqual(forks, ["blacksky", "witchsky", "mu", "deer", "northsky"])
    }

    func testCategorizedForListDropsListlessClients() {
        let groups = WaypointCatalog.categorized(for: .list)
        XCTAssertEqual(groups[0].waypoints.map(\.id), ["anisota", "bluesky", "bluepy", "impro"])
        XCTAssertTrue(WaypointCatalog.categorized(for: .unknown).isEmpty)
    }

    // MARK: Recommendations

    func testRecommendsBlueskyAnisotaBlackskyForPosts() {
        let result = WaypointCatalog.recommended(for: .post, collection: "app.bsky.feed.post")
        XCTAssertEqual(result.waypoints.map(\.id), ["bluesky", "anisota", "blacksky"])
        XCTAssertEqual(result.label, "Recommended for Posts")
    }

    func testMatchesNamespacePrefixes() {
        let tangled = WaypointCatalog.recommended(for: .record, collection: "sh.tangled.repo")
        XCTAssertTrue(tangled.waypoints.map(\.id).contains("tangled"))
        XCTAssertEqual(tangled.label, "Recommended for Repos")

        let tangledOther = WaypointCatalog.recommended(for: .record, collection: "sh.tangled.feed.star")
        XCTAssertEqual(tangledOther.waypoints.map(\.id), ["tangled", "pdsls", "atptools"])
        XCTAssertEqual(tangledOther.label, "Recommended for Tangled")

        let standard = WaypointCatalog.recommended(for: .record, collection: "site.standard.blog.entry")
        XCTAssertEqual(standard.waypoints.map(\.id), ["leaflet", "standardReader", "anisotaReader", "offprint", "pckt", "pdsls"])
        XCTAssertEqual(standard.label, "Recommended for Publications")

        let leaflet = WaypointCatalog.recommended(for: .record, collection: "pub.leaflet.document")
        XCTAssertEqual(leaflet.waypoints.map(\.id), ["leaflet", "anisotaReader", "offprint", "pckt", "pdsls"])

        XCTAssertEqual(WaypointCatalog.recommended(for: .record, collection: "at.margin.annotation").waypoints.map(\.id), ["margin", "pdsls", "atptools"])
        XCTAssertEqual(WaypointCatalog.recommended(for: .record, collection: "social.grain.gallery").waypoints.map(\.id), ["grain", "pdsls", "atptools"])
        XCTAssertEqual(WaypointCatalog.recommended(for: .record, collection: "social.grain.gallery").label, "Recommended for Grain")
    }

    func testExactCollectionBeatsPrefixAndTypeBeatsDefault() {
        let event = WaypointCatalog.recommended(for: .record, collection: "community.lexicon.calendar.event")
        XCTAssertEqual(event.waypoints.map(\.id), ["aturiExplore", "pdsls", "atptools"])
        XCTAssertEqual(event.label, "Recommended for Events")

        let record = WaypointCatalog.recommended(for: .record, collection: "com.example.thing")
        XCTAssertEqual(record.waypoints.map(\.id), ["aturiExplore", "pdsls", "atptools", "taproot"])
        XCTAssertEqual(record.label, "Recommended for Records")

        let profile = WaypointCatalog.recommended(for: .profile)
        XCTAssertEqual(profile.waypoints.map(\.id), ["bluesky", "anisota"])
        XCTAssertEqual(profile.label, "Recommended for Profiles")

        let list = WaypointCatalog.recommended(for: .list, collection: "app.bsky.graph.list")
        XCTAssertEqual(list.waypoints.map(\.id), ["bluesky", "anisota"])
        XCTAssertEqual(list.label, "Recommended for Lists")

        // A namespace prefix needs at least two segments: `sh.tangled` is
        // matched from `sh.tangled.repo`, but a two-segment collection never
        // matches a one-segment prefix.
        XCTAssertEqual(WaypointCatalog.recommended(for: .unknown, collection: "sh.tangled").label, "Recommended")
    }

    func testFallsBackToADefaultRecommendation() {
        let result = WaypointCatalog.recommended(for: .unknown)
        XCTAssertFalse(result.waypoints.isEmpty)
        XCTAssertEqual(result.waypoints.map(\.id), ["bluesky"])
        XCTAssertEqual(result.label, "Recommended")
        // The type fallback still applies when the collection is unknown.
        XCTAssertEqual(WaypointCatalog.recommended(for: .post, collection: "com.example.x").label, "Recommended")
        XCTAssertEqual(WaypointCatalog.recommended(for: .list, collection: "com.example.x").label, "Recommended")
    }

    func testReturnsAFeaturedWaypointForPosts() {
        XCTAssertEqual(WaypointCatalog.featured(for: .post, collection: "app.bsky.feed.post")?.id, "bluesky")
        XCTAssertEqual(WaypointCatalog.featured(for: .record, collection: "sh.tangled.repo")?.id, "tangled")
        XCTAssertEqual(WaypointCatalog.featured(for: .unknown)?.id, "bluesky")
    }

    // MARK: Activity

    func testWaypointActivity() {
        let bluesky = waypoint("bluesky")
        XCTAssertEqual(WaypointCatalog.activity(of: bluesky, repoCollections: nil), .unknown)
        XCTAssertEqual(WaypointCatalog.activity(of: bluesky, repoCollections: ["app.bsky.feed.post"]), .present)
        XCTAssertEqual(WaypointCatalog.activity(of: bluesky, repoCollections: ["sh.tangled.repo"]), .absent)
        XCTAssertEqual(WaypointCatalog.activity(of: bluesky, repoCollections: []), .absent)
        // Generic explorers have no opinion.
        XCTAssertEqual(WaypointCatalog.activity(of: waypoint("pdsls"), repoCollections: ["app.bsky.feed.post"]), .unknown)
        XCTAssertEqual(WaypointCatalog.activity(expectedCollections: [], repoCollections: ["app.bsky.feed.post"]), .unknown)
        // An exact NSID matches itself as well as by prefix.
        XCTAssertEqual(WaypointCatalog.activity(expectedCollections: ["app.bsky.feed.post"], repoCollections: ["app.bsky.feed.post"]), .present)
        XCTAssertEqual(WaypointCatalog.activity(expectedCollections: ["app.bsky.feed.post"], repoCollections: ["app.bsky.feed.like"]), .absent)
    }

    // MARK: Compose intents

    func testBuildsPrefilledComposeLinks() {
        // Each of these was confirmed against the client's shipped bundle.
        let cases: [(String, String)] = [
            ("bluesky", "https://bsky.app/intent/compose?text=hello%20there"),
            ("anisota", "https://anisota.net/intent/compose?text=hello%20there"),
            ("blacksky", "https://blacksky.community/intent/compose?text=hello%20there"),
            ("deer", "https://deer.social/intent/compose?text=hello%20there"),
            ("witchsky", "https://witchsky.app/intent/compose?text=hello%20there"),
            ("mu", "https://mu.social/intent/compose?text=hello%20there"),
            ("northsky", "https://northsky.app/intent/compose?text=hello%20there"),
        ]
        for (id, expected) in cases {
            XCTAssertEqual(WaypointCatalog.composeIntentUrl(waypoint(id), text: "hello there"), expected, id)
        }
    }

    func testDropsTheTextForAClientThatIgnoresIt() {
        let impro = waypoint("impro")
        XCTAssertTrue(WaypointCatalog.supportsComposeIntent(impro))
        XCTAssertEqual(WaypointCatalog.composeIntentUrl(impro, text: "hello there"), "https://impro.social/intent/compose")
        XCTAssertEqual(WaypointCatalog.describeComposeIntent(impro)?.prefillsText, false)
        XCTAssertNil(WaypointCatalog.describeComposeIntent(impro)?.textParam)
    }

    func testReturnsNilForClientsWithNoConfirmedIntentRoute() {
        for id in ["bluepy", "reddwarf", "pinksky", "pdsls", "leaflet"] {
            let waypoint = waypoint(id)
            XCTAssertFalse(WaypointCatalog.supportsComposeIntent(waypoint), id)
            XCTAssertNil(WaypointCatalog.composeIntentUrl(waypoint, text: "hi"), id)
            XCTAssertNil(WaypointCatalog.composeIntentAppUrl(waypoint, text: "hi"), id)
            XCTAssertNil(WaypointCatalog.composeIntentTemplate(waypoint), id)
            XCTAssertNil(WaypointCatalog.describeComposeIntent(waypoint), id)
        }
    }

    func testOmitsTheQueryStringWhenNoTextIsPassed() {
        XCTAssertEqual(WaypointCatalog.composeIntentUrl(waypoint("bluesky")), "https://bsky.app/intent/compose")
        XCTAssertEqual(WaypointCatalog.composeIntentUrl(waypoint("bluesky"), text: ""), "https://bsky.app/intent/compose")
    }

    func testUrlEncodesTheText() {
        let url = WaypointCatalog.composeIntentUrl(waypoint("bluesky"), text: "a & b?c=d #tag")
        XCTAssertEqual(url, "https://bsky.app/intent/compose?text=a%20%26%20b%3Fc%3Dd%20%23tag")
        let query = URLComponents(string: url ?? "")?.queryItems?.first { $0.name == "text" }?.value
        XCTAssertEqual(query, "a & b?c=d #tag")
        // encodeURIComponent keeps the unreserved marks and encodes non-ASCII as UTF-8.
        XCTAssertEqual(
            WaypointCatalog.composeIntentUrl(waypoint("deer"), text: "ok-_.!~*'() caf\u{e9}"),
            "https://deer.social/intent/compose?text=ok-_.!~*'()%20caf%C3%A9"
        )
    }

    func testExposesTheNativeDeepLinkOnlyWhereASchemeIsPublished() {
        XCTAssertEqual(WaypointCatalog.composeIntentAppUrl(waypoint("bluesky"), text: "hi"), "bluesky://intent/compose?text=hi")
        XCTAssertEqual(WaypointCatalog.composeIntentAppUrl(waypoint("bluesky")), "bluesky://intent/compose")
        XCTAssertNil(WaypointCatalog.composeIntentAppUrl(waypoint("deer"), text: "hi"))
    }

    func testTemplatesTheTextPlaceholder() {
        XCTAssertEqual(WaypointCatalog.composeIntentTextPlaceholder, "{text}")
        XCTAssertEqual(WaypointCatalog.composeIntentTemplate(waypoint("deer")), "https://deer.social/intent/compose?text={text}")
        XCTAssertEqual(WaypointCatalog.composeIntentTemplate(waypoint("impro")), "https://impro.social/intent/compose")
    }

    func testListsComposeCapableWaypointsInCatalogOrder() {
        XCTAssertEqual(
            WaypointCatalog.composeIntentWaypoints().map(\.id),
            ["anisota", "bluesky", "impro", "blacksky", "witchsky", "mu", "deer", "northsky"]
        )
    }

    func testNarrowsTheListToClientsThatAlsoRenderTheType() {
        let ids = WaypointCatalog.composeIntentWaypoints(for: .list).map(\.id)
        XCTAssertTrue(ids.contains("bluesky"))
        for id in ids {
            XCTAssertTrue(waypoint(id).supportedTypes.contains(.list), id)
        }
        XCTAssertTrue(WaypointCatalog.composeIntentWaypoints(for: .unknown).isEmpty)
    }

    func testOnlyClaimsComposeSupportForClientsInTheBlueskyFamily() {
        for waypoint in WaypointCatalog.composeIntentWaypoints() {
            XCTAssertTrue(waypoint.redirectCompat.contains(.blueskySocial), waypoint.id)
        }
    }

    func testPointsEveryIntentAtTheClientsOwnOrigin() {
        for waypoint in WaypointCatalog.composeIntentWaypoints() {
            let intentHost = WaypointCatalog.hostComponent(of: waypoint.composeIntent?.url ?? "")
            let profileHost = WaypointCatalog.hostComponent(of: waypoint.url(handle: "alice.bsky.social") ?? "")
            XCTAssertNotNil(intentHost, waypoint.id)
            XCTAssertEqual(intentHost, profileHost, waypoint.id)
            XCTAssertTrue(waypoint.composeIntent?.url.hasPrefix("https://") ?? false, waypoint.id)
        }
    }

    func testDescribeComposeIntentMatchesResolveOutput() {
        // From resolve.test.ts: the JSON-safe descriptor bluesky reports.
        let descriptor = WaypointCatalog.describeComposeIntent(waypoint("bluesky"), text: "look at this")
        XCTAssertEqual(descriptor, ComposeIntentDescriptor(
            url: "https://bsky.app/intent/compose?text=look%20at%20this",
            urlTemplate: "https://bsky.app/intent/compose?text={text}",
            textParam: "text",
            prefillsText: true,
            appUrl: "bluesky://intent/compose?text=look%20at%20this"
        ))
        XCTAssertNil(WaypointCatalog.describeComposeIntent(waypoint("pdsls"), text: "look at this"))
        let deer = WaypointCatalog.describeComposeIntent(waypoint("deer"))
        XCTAssertEqual(deer?.url, "https://deer.social/intent/compose")
        XCTAssertNil(deer?.appUrl)
    }

    // MARK: Redirect compat families

    /// The host a waypoint's links land on, probed rather than declared, the
    /// way the web test does it (with the extra site.standard probe).
    private func hostOf(_ waypoint: Waypoint) -> String? {
        let probes: [(String?, String?)] = [
            (nil, nil),
            ("app.bsky.feed.post", "probe"),
            ("site.standard.document", "probe"),
            ("com.example.probe", "probe"),
        ]
        for (collection, rkey) in probes {
            if let url = waypoint.url("probe.example", collection, rkey, "did:plc:probe") {
                return WaypointCatalog.hostComponent(of: url)
            }
        }
        return nil
    }

    func testGivesEachSiteOneEntryPerFamily() {
        // Two waypoints on the same host in the same family read as a
        // duplicate in the settings UI. A site that plays two roles splits
        // them by family (`anisota` vs `anisotaReader`).
        for family in WaypointCatalog.compatFamilyOrder {
            var byHost: [String: [String]] = [:]
            for waypoint in WaypointCatalog.all.values where waypoint.redirectCompat.contains(family) {
                guard let host = hostOf(waypoint) else { continue }
                byHost[host, default: []].append(waypoint.id)
            }
            let duplicates = byHost.filter { $0.value.count > 1 }
            XCTAssertTrue(duplicates.isEmpty, "\(family.rawValue): \(duplicates)")
        }
    }

    // MARK: waypointHost

    func testWaypointHostProbesTheCatalog() {
        XCTAssertEqual(WaypointCatalog.host(of: "aturiExplore"), "aturi.to")
        XCTAssertEqual(WaypointCatalog.host(of: "aturi"), "aturi.to")
        XCTAssertEqual(WaypointCatalog.host(of: "bluesky"), "bsky.app")
        XCTAssertEqual(WaypointCatalog.host(of: "pdsls"), "pdsls.dev")
        XCTAssertEqual(WaypointCatalog.host(of: "atptools"), "atp.tools")
        XCTAssertEqual(WaypointCatalog.host(of: "pinksky"), "pinkleap.app")
        XCTAssertEqual(WaypointCatalog.host(of: "standardReader"), "standard-reader.app")
        // Offprint and pckt only answer the record probes.
        XCTAssertEqual(WaypointCatalog.host(of: "offprint"), "offprint.app")
        XCTAssertEqual(WaypointCatalog.host(of: "pckt"), "pckt.blog")
        XCTAssertNil(WaypointCatalog.host(of: "nope"))
        for id in WaypointCatalog.order {
            XCTAssertNotNil(WaypointCatalog.host(of: id), id)
        }
    }

    func testHostComponentParsing() {
        XCTAssertEqual(WaypointCatalog.hostComponent(of: "https://pdsls.dev/at://did:plc:probe"), "pdsls.dev")
        XCTAssertEqual(WaypointCatalog.hostComponent(of: "https://Example.COM:8443/x"), "example.com:8443")
        XCTAssertEqual(WaypointCatalog.hostComponent(of: "https://user@example.com/x"), "example.com")
        XCTAssertEqual(WaypointCatalog.hostComponent(of: "bluesky://intent/compose"), "intent")
        XCTAssertNil(WaypointCatalog.hostComponent(of: "not a url"))
        XCTAssertNil(WaypointCatalog.hostComponent(of: "https:///x"))
    }

    // MARK: Universal-link agreement

    func testAgreesWithTheCatalogsOwnAturiWaypoint() {
        // The "Open in Aturi" link and the generated universal link have to be
        // the same string.
        let cases: [(String, String?, String?, String?)] = [
            ("alice.bsky.social", "app.bsky.feed.post", "3k7", nil),
            ("alice.bsky.social", "app.bsky.graph.list", "abc", nil),
            ("alice.bsky.social", "pub.leaflet.document", "xyz", "did:plc:abc"),
            ("did:plc:abc", "pub.leaflet.document", "xyz", "did:plc:abc"),
            ("alice.bsky.social", nil, nil, nil),
        ]
        let expected = [
            "https://aturi.to/profile/alice.bsky.social/post/3k7",
            "https://aturi.to/profile/alice.bsky.social/lists/abc",
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz",
            "https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz",
            "https://aturi.to/profile/alice.bsky.social",
        ]
        for (index, (handle, collection, rkey, did)) in cases.enumerated() {
            let url = waypoint("aturi").url(handle: handle, collection: collection, rkey: rkey, did: did)
            XCTAssertEqual(url, expected[index])
            // generateAturiLink addresses by whichever identifier it is given;
            // handing it the DID the catalog prefers for generic records
            // yields the same string.
            let components = AtUriComponents(identifier: did ?? handle, collection: collection, rkey: rkey)
            XCTAssertEqual(generateAturiLink(components), url)
        }
    }

    func testResolveStyleBlueskyUrlForADidAddressedPost() {
        // From resolve.test.ts: `resolveAtUri('at://did:plc:x/app.bsky.feed.post/abc')`.
        XCTAssertEqual(
            waypoint("bluesky").url(handle: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc", did: "did:plc:x"),
            "https://bsky.app/profile/did:plc:x/post/abc"
        )
        XCTAssertTrue(WaypointCatalog.recommended(for: .post, collection: "app.bsky.feed.post").waypoints.map(\.id).contains("bluesky"))
    }

    // MARK: Value semantics

    func testWaypointEqualityAndIdentity() {
        let a = waypoint("bluesky")
        let b = waypoint("bluesky")
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.hashValue, b.hashValue)
        XCTAssertNotEqual(a, waypoint("deer"))
        XCTAssertEqual(a.id, "bluesky")
        XCTAssertTrue(a.supports(.post))
        XCTAssertFalse(a.supports(.unknown))
        XCTAssertEqual(WaypointCatalog.ordered.map(\.id), WaypointCatalog.order)
        XCTAssertEqual(WaypointType(rawValue: "record"), .record)
    }
}
