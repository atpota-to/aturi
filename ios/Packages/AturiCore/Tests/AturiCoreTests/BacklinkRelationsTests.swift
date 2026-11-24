import XCTest
@testable import AturiCore

/// Port of src/utils/atproto/__tests__/backlinkRelations.test.ts.
final class BacklinkRelationsTests: XCTestCase {
    // Sources seen pointing at large accounts on the live index, by
    // collection and path, with the relationship each should land in.
    private static let accountCases: [(collection: String, path: String, relation: BacklinkRelation)] = [
        ("app.bsky.graph.follow", ".subject", .follow),
        ("so.sprk.graph.follow", ".subject", .follow),
        ("sh.tangled.graph.follow", ".subject", .follow),
        ("network.cosmik.follow", ".subject", .follow),
        ("app.bsky.feed.post", ".facets[app.bsky.richtext.facet].features[app.bsky.richtext.facet#mention].did", .mention),
        ("app.bsky.feed.post", ".facets[].features[com.atproto.richtext.facet#mention].did", .mention),
        ("app.bsky.feed.post", ".facets[].features[].did", .mention),
        (
            "site.standard.document",
            ".content.pages[pub.leaflet.pages.linearDocument].blocks[pub.leaflet.pages.linearDocument#block].block.facets[].features[pub.leaflet.richtext.facet#didMention].did",
            .mention
        ),
        ("app.bsky.graph.list", ".descriptionFacets[].features[app.bsky.richtext.facet#mention].did", .mention),
        ("app.bsky.graph.listitem", ".subject", .list),
        ("com.portal.channel", ".members[]", .list),
        ("place.stream.live.recommendations", ".streamers[]", .list),
        ("app.bsky.graph.block", ".subject", .block),
        ("app.bsky.feed.block", ".subject", .block),
        ("app.bsky.graph.verification", ".subject", .verify),
        ("app.bsky.graph.verification", ".issuer", .verify),
        ("app.witchsky.preferences", ".deerVerification.trusted[]", .verify),
        ("fund.at.graph.endorse", ".subject", .endorse),
        ("sh.tangled.graph.vouch", ".", .endorse),
        ("space.myspace.topFriends", ".friends[]", .endorse),
        ("computer.aetheros.people.contact", ".did", .endorse),
        ("app.bsky.graph.starterpack", ".feeds[].creator.did", .embed),
        ("app.bsky.graph.starterpack", ".feeds[].creator.verification.verifications[].issuer", .embed),
        ("app.bsky.feed.post", ".reply.parent.author.verification.verifications[].issuer", .embed),
        ("app.bsky.feed.post", ".embed.generator.uri", .embed),
        ("app.bsky.graph.cancellation", ".subject", .other),
        ("place.stream.chat.message", ".streamer", .other),
        ("org.hypercerts.claim.measurement", ".measurers[].did", .other),
    ]

    func testAccountSourcesLandInTheirRelationship() {
        for item in Self.accountCases {
            XCTAssertEqual(
                BacklinkRelations.relationOf(item.collection, item.path),
                item.relation,
                "\(item.collection) \(item.path)"
            )
        }
    }

    func testAFollowLexiconLinkingFromSomeOtherFieldIsNotAFollower() {
        XCTAssertEqual(BacklinkRelations.relationOf("app.example.graph.follow", ".via.did"), .other)
    }

    func testAppsWithAWaypointMarkKeepTheirName() {
        XCTAssertEqual(
            BacklinkRelations.appForCollection("app.bsky.graph.follow"),
            BacklinkApp(key: "bsky.app", name: "Bluesky", waypoint: "bluesky")
        )
        XCTAssertEqual(BacklinkRelations.appForCollection("sh.tangled.graph.follow").waypoint, "tangled")
    }

    func testOtherAppsAreNamedByTheirDomain() {
        XCTAssertEqual(
            BacklinkRelations.appForCollection("so.sprk.graph.follow"),
            BacklinkApp(key: "sprk.so", name: "sprk.so", waypoint: nil)
        )
        // Project hosts give each project its own subdomain.
        XCTAssertEqual(BacklinkRelations.appForCollection("io.github.someone.blog.post").key, "someone.github.io")
    }

    func testShortPathsDropTheNsidsInsideTypeQualifiers() {
        XCTAssertEqual(
            BacklinkRelations.shortBacklinkPath(".facets[app.bsky.richtext.facet].features[app.bsky.richtext.facet#mention].did"),
            ".facets[facet].features[#mention].did"
        )
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath(".subject"), ".subject")
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath("."), "(record root)")
    }

    /// Brackets that are not a type qualifier stay as they are, as the
    /// web's replace leaves anything its pattern does not match.
    func testBracketsThatAreNotQualifiersAreKept() {
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath(".feeds[].creator.did"), ".feeds[].creator.did")
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath(".a[x#y-z].b[c.d]"), ".a[x#y-z].b[d]")
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath(".a[b[c.d]"), ".a[b[d]")
        XCTAssertEqual(BacklinkRelations.shortBacklinkPath(".a[c.d"), ".a[c.d")
    }

    func testPathLabelsKeepTheNamespaceWhereTwoWouldReadTheSame() {
        let a = ".facets[].features[app.bsky.richtext.facet#mention].did"
        let b = ".facets[].features[com.atproto.richtext.facet#mention].did"
        let c = ".embed.generator.uri"
        let labels = BacklinkRelations.backlinkPathLabels([a, b, c])
        XCTAssertEqual(labels[a], ".facets[].features[app.bsky\u{2026}#mention].did")
        XCTAssertEqual(labels[b], ".facets[].features[com.atproto\u{2026}#mention].did")
        XCTAssertEqual(labels[c], ".embed.generator.uri")
    }

    private func source(_ collection: String, _ path: String, _ count: Int, _ distinctDids: Int?) -> BacklinkSource {
        let trimmed = path.hasPrefix(".") ? String(path.dropFirst()) : path
        return BacklinkSource(collection: collection, path: path, source: "\(collection):\(trimmed)", count: count, distinctDids: distinctDids)
    }

    func testBucketsFollowTheTileOrderSumCountsAndRankApps() {
        let buckets = BacklinkRelations.bucketSources([
            source("app.bsky.graph.follow", ".subject", 1000, 990),
            source("app.bsky.graph.block", ".subject", 40, 40),
            source("so.sprk.graph.follow", ".subject", 12, nil),
            source("app.bsky.feed.post", ".facets[].features[app.bsky.richtext.facet#mention].did", 30, 9),
            source("sh.tangled.graph.follow", ".subject", 20, 20),
        ])
        XCTAssertEqual(buckets.map(\.relation), [.follow, .mention, .block])
        let follow = buckets[0]
        XCTAssertEqual(follow.count, 1032)
        XCTAssertEqual(follow.accounts, 1010)
        XCTAssertEqual(follow.sources.count, 3)
        XCTAssertEqual(follow.apps.map(\.app.name), ["Bluesky", "Tangled", "sprk.so"])
        XCTAssertEqual(follow.apps.map(\.count), [1000, 20, 12])
    }

    func testAppsWithTheSameCountKeepTheOrderTheyWereFirstSeenIn() {
        let buckets = BacklinkRelations.bucketSources([
            source("so.sprk.graph.follow", ".subject", 5, nil),
            source("sh.tangled.graph.follow", ".subject", 5, nil),
            source("app.bsky.graph.follow", ".subject", 5, nil),
        ])
        XCTAssertEqual(buckets.first?.apps.map(\.app.key), ["sprk.so", "tangled.sh", "bsky.app"])
    }

    func testNoSourcesNoBuckets() {
        XCTAssertTrue(BacklinkRelations.bucketSources([]).isEmpty)
    }

    // Sources seen pointing at records on the live index (a post, a feed, a
    // list, a starter pack, publications and their documents), by the
    // linking collection and path, the target's collection, and the
    // relationship.
    private static let recordCases: [(collection: String, path: String, target: String, relation: RecordBacklinkRelation)] = [
        ("app.bsky.feed.like", ".subject.uri", "app.bsky.feed.post", .like),
        ("site.standard.graph.recommend", ".document", "site.standard.document", .like),
        ("app.bsky.feed.repost", ".subject.uri", "app.bsky.feed.post", .repost),
        ("app.bsky.feed.post", ".reply.parent.uri", "app.bsky.feed.post", .reply),
        ("pub.leaflet.comment", ".subject", "pub.leaflet.document", .reply),
        ("app.bsky.feed.post", ".reply.root.uri", "app.bsky.feed.post", .thread),
        ("app.bsky.feed.post", ".embed.record.uri", "app.bsky.feed.post", .quote),
        ("app.bsky.feed.post", ".embed.record.record.uri", "app.bsky.feed.post", .quote),
        ("app.bsky.feed.post", ".embed.generator.uri", "app.bsky.feed.generator", .quote),
        (
            "app.bsky.feed.post",
            ".embed.external.associatedRefs[com.atproto.repo.strongRef].uri",
            "site.standard.publication",
            .quote
        ),
        (
            "pub.leaflet.comment",
            ".facets[].features[pub.leaflet.richtext.facet#atMention].atURI",
            "pub.leaflet.publication",
            .mention
        ),
        ("app.bsky.graph.listitem", ".list", "app.bsky.graph.list", .item),
        ("pub.leaflet.document", ".publication", "pub.leaflet.publication", .item),
        ("site.standard.document", ".site", "site.standard.publication", .item),
        ("pub.leaflet.graph.subscription", ".publication", "pub.leaflet.publication", .subscribe),
        ("site.standard.graph.subscription", ".publication", "site.standard.publication", .subscribe),
        ("app.bsky.graph.follow", ".via.uri", "app.bsky.graph.starterpack", .via),
        ("app.bsky.actor.profile", ".joinedViaStarterPack.uri", "app.bsky.graph.starterpack", .via),
        ("app.bsky.graph.starterpack", ".feeds[].uri", "app.bsky.feed.generator", .other),
        ("app.bsky.graph.referencelistoptout", ".subject", "app.bsky.graph.list", .other),
        ("app.standard-reader.read", ".subject", "site.standard.document", .other),
        ("app.bsky.feed.threadgate", ".post", "app.bsky.feed.post", .other),
        ("app.bsky.feed.postgate", ".post", "app.bsky.feed.post", .other),
    ]

    func testRecordSourcesLandInTheirRelationship() {
        for item in Self.recordCases {
            XCTAssertEqual(
                BacklinkRelations.recordRelationOf(item.collection, item.path, targetCollection: item.target),
                item.relation,
                "\(item.collection) \(item.path) to a \(item.target)"
            )
        }
    }

    func testAFieldIsOnlyAnOwnerFieldOnARecordOfTheTypeItNames() {
        XCTAssertEqual(BacklinkRelations.recordRelationOf("pub.leaflet.document", ".publication", targetCollection: "app.bsky.feed.post"), .other)
        XCTAssertEqual(BacklinkRelations.recordRelationOf("pub.leaflet.document", ".publication"), .other)
    }

    func testARecordsBucketsPutWhatWasWrittenFirstAndKeepDirectRepliesApartFromTheThread() {
        let buckets = BacklinkRelations.bucketRecordSources(
            [
                source("app.bsky.feed.like", ".subject.uri", 116, 116),
                source("app.bsky.feed.post", ".reply.root.uri", 9, 7),
                source("app.bsky.feed.post", ".reply.parent.uri", 6, 6),
                source("app.bsky.feed.repost", ".subject.uri", 4, 4),
                source("app.bsky.feed.post", ".embed.record.uri", 1, 1),
            ],
            targetCollection: "app.bsky.feed.post"
        )
        XCTAssertEqual(buckets.map(\.relation), [.reply, .thread, .quote, .repost, .like])
        XCTAssertEqual(buckets.map(\.count), [6, 9, 1, 4, 116])
    }
}
