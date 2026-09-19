import Foundation
import XCTest
@testable import AturiCore

/// Port of packages/waypoints/src/__tests__/reverseParsers.test.ts and
/// extension/lib/__tests__/reverseParsers.test.ts, plus the URL-normalisation
/// and drift checks the Swift port needs on its own.
final class ReverseParsersTests: XCTestCase {
    private func match(_ string: String, file: StaticString = #filePath, line: UInt = #line) throws -> ReverseMatch? {
        let url = try XCTUnwrap(URL(string: string), "not a URL: \(string)", file: file, line: line)
        return matchSupportedUrl(url)
    }

    // MARK: matchSupportedUrl: Bluesky family

    func testParsesABskyAppProfile() throws {
        let m = try match("https://bsky.app/profile/alice.bsky.social")
        XCTAssertEqual(m?.source, .bluesky)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertEqual(m?.parsed.handle, "alice.bsky.social")
        XCTAssertEqual(m?.parsed.uri, "at://alice.bsky.social")
        XCTAssertNil(m?.parsed.did)
        XCTAssertNil(m?.parsed.collection)
        XCTAssertNil(m?.parsed.rkey)
        XCTAssertNil(m?.parsed.error)
    }

    func testParsesABskyAppPost() throws {
        let m = try match("https://bsky.app/profile/alice.bsky.social/post/abc")
        XCTAssertEqual(m?.source, .bluesky)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.rkey, "abc")
        XCTAssertEqual(m?.parsed.collection, "app.bsky.feed.post")
        XCTAssertEqual(m?.parsed.uri, "at://alice.bsky.social/app.bsky.feed.post/abc")
    }

    func testParsesABskyAppPostWithATidRkey() throws {
        let m = try match("https://bsky.app/profile/alice.bsky.social/post/3k7abc")
        XCTAssertEqual(m?.source, .bluesky)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.rkey, "3k7abc")
        XCTAssertEqual(m?.parsed.collection, "app.bsky.feed.post")
    }

    func testParsesABskyAppList() throws {
        let m = try match("https://bsky.app/profile/alice.bsky.social/lists/abc")
        XCTAssertEqual(m?.parsed.type, .list)
        XCTAssertEqual(m?.parsed.collection, "app.bsky.graph.list")
        XCTAssertEqual(m?.parsed.uri, "at://alice.bsky.social/app.bsky.graph.list/abc")
    }

    func testAcceptsTheSingularListSpelling() throws {
        let m = try match("https://bsky.app/profile/alice.bsky.social/list/abc")
        XCTAssertEqual(m?.parsed.type, .list)
        XCTAssertEqual(m?.parsed.collection, "app.bsky.graph.list")
    }

    func testParsesAnAnisotaSubdomainTheSameAsAnisotaNet() throws {
        let m = try match("https://eclose.anisota.net/profile/alice.bsky.social/post/abc")
        XCTAssertEqual(m?.source, .anisota)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.rkey, "abc")
        XCTAssertEqual(m?.parsed.collection, "app.bsky.feed.post")
        // Nested subdomains count too.
        XCTAssertEqual(try match("https://sub.eclose.anisota.net/profile/alice.bsky.social")?.source, .anisota)
    }

    func testDoesNotTreatALookalikeHostAsAnAnisotaSubdomain() throws {
        // Must be a real subdomain of anisota.net, not just a suffix match.
        XCTAssertNil(try match("https://notanisota.net/profile/alice.bsky.social"))
        XCTAssertNil(try match("https://anisota.net.evil.com/profile/alice"))
    }

    func testParsesBlacksky() throws {
        let m = try match("https://blacksky.community/profile/alice.bsky.social/post/abc")
        XCTAssertEqual(m?.source, .blacksky)
        XCTAssertEqual(m?.parsed.type, .post)
    }

    func testParsesBlackskyPostWithATidRkey() throws {
        let m = try match("https://blacksky.community/profile/alice.bsky.social/post/3k7abc")
        XCTAssertEqual(m?.source, .blacksky)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.rkey, "3k7abc")
    }

    func testParsesEachBlueskyFamilyProfile() throws {
        let cases: [(host: String, source: SourceApp)] = [
            ("reddwarf.app", .reddwarf),
            ("impro.social", .impro),
            ("lea.ac", .lea),
            ("witchsky.app", .witchsky),
            ("deer.social", .deer),
            ("northsky.app", .northsky),
            ("anisota.net", .anisota),
            ("mu.social", .mu),
            ("bsky.app", .bluesky),
            ("blacksky.community", .blacksky),
        ]
        for (host, source) in cases {
            let m = try match("https://\(host)/profile/alice.bsky.social")
            XCTAssertEqual(m?.source, source, host)
            XCTAssertEqual(m?.parsed.type, .profile, host)
            XCTAssertEqual(m?.parsed.handle, "alice.bsky.social", host)
        }
    }

    func testBlueskyFamilySubpagesFallBackToTheProfile() throws {
        // `/profile/:handle/followers`, or `/post` without an rkey, still name
        // the account.
        let followers = try match("https://bsky.app/profile/did:plc:x/followers")
        XCTAssertEqual(followers?.parsed.type, .profile)
        XCTAssertEqual(followers?.parsed.did, "did:plc:x")
        XCTAssertEqual(try match("https://bsky.app/profile/alice.bsky.social/post")?.parsed.type, .profile)
        // Anything that is not `/profile/...` is not an account page.
        XCTAssertNil(try match("https://bsky.app/"))
        XCTAssertNil(try match("https://bsky.app/profile"))
        XCTAssertNil(try match("https://bsky.app/settings"))
    }

    // MARK: matchSupportedUrl: other apps

    func testParsesPdslsAtUri() throws {
        let m = try match("https://pdsls.dev/at://did:plc:xyz/app.bsky.feed.post/rk123")
        XCTAssertEqual(m?.source, .pdsls)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.did, "did:plc:xyz")
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:xyz/app.bsky.feed.post/rk123")
        // Repo-level and collection-level pages are profile-level matches.
        XCTAssertEqual(try match("https://pdsls.dev/at://did:plc:xyz")?.parsed.type, .profile)
        XCTAssertEqual(try match("https://pdsls.dev/at://did:plc:xyz/app.bsky.feed.post")?.parsed.type, .profile)
        XCTAssertNil(try match("https://pdsls.dev/"))
        XCTAssertNil(try match("https://pdsls.dev/jetstream"))
    }

    func testParsesAtpToolsSingleSlashForm() throws {
        let m = try match("https://atp.tools/at:/did:plc:xyz/app.bsky.feed.post/rk")
        XCTAssertEqual(m?.source, .atptools)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:xyz/app.bsky.feed.post/rk")
        // The double-slash spelling is accepted as well.
        XCTAssertEqual(try match("https://atp.tools/at://did:plc:xyz/app.bsky.feed.post/rk")?.source, .atptools)
        XCTAssertEqual(try match("https://atp.tools/at:/alice.test")?.parsed.type, .profile)
    }

    func testParsesBluepyRoutes() throws {
        // Linking the profile record itself is the profile, not a record view.
        let profileRecord = try match("https://bluepy.social/at://did:plc:xyz/app.bsky.actor.profile/self")
        XCTAssertEqual(profileRecord?.source, .bluepy)
        XCTAssertEqual(profileRecord?.parsed.type, .profile)
        XCTAssertEqual(profileRecord?.parsed.uri, "at://did:plc:xyz")
        XCTAssertNil(profileRecord?.parsed.collection)

        let post = try match("https://bluepy.social/at://did:plc:xyz/app.bsky.feed.post/rk")
        XCTAssertEqual(post?.source, .bluepy)
        XCTAssertEqual(post?.parsed.type, .post)
        XCTAssertEqual(post?.parsed.rkey, "rk")

        XCTAssertEqual(try match("https://bluepy.social/at:/alice.test")?.parsed.type, .profile)
        XCTAssertNil(try match("https://bluepy.social/about"))
    }

    func testParsesPinkleapFeedUrl() throws {
        let uri = URIEncoding.encodeComponent("at://did:plc:x/app.bsky.feed.post/r")
        let m = try match("https://pinkleap.app/feed?uri=\(uri)&src=profile")
        XCTAssertEqual(m?.source, .pinksky)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:x/app.bsky.feed.post/r")
        XCTAssertEqual(m?.parsed.did, "did:plc:x")
        XCTAssertEqual(m?.parsed.rkey, "r")
    }

    func testPinkleapFeedAndProfileEdges() throws {
        // A profile-only AT URI in the query is a profile match.
        let profileUri = try match("https://pinkleap.app/feed?uri=at%3A%2F%2Falice.test")
        XCTAssertEqual(profileUri?.source, .pinksky)
        XCTAssertEqual(profileUri?.parsed.type, .profile)
        XCTAssertEqual(profileUri?.parsed.handle, "alice.test")
        // The `uri` value must be an AT URI; anything else is not a match.
        XCTAssertNil(try match("https://pinkleap.app/feed?uri=https%3A%2F%2Fexample.com"))
        XCTAssertNil(try match("https://pinkleap.app/feed"))
        // `/profile/:handle` works without a query.
        let profile = try match("https://pinkleap.app/profile/did:plc:x")
        XCTAssertEqual(profile?.source, .pinksky)
        XCTAssertEqual(profile?.parsed.type, .profile)
        XCTAssertEqual(profile?.parsed.did, "did:plc:x")
        XCTAssertNil(try match("https://pinkleap.app/explore"))
    }

    func testParsesLeafletProfile() throws {
        let m = try match("https://leaflet.pub/p/alice.bsky.social")
        XCTAssertEqual(m?.source, .leaflet)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertNil(try match("https://leaflet.pub/alice.bsky.social"))
        XCTAssertNil(try match("https://leaflet.pub/p"))
    }

    func testParsesTangledProfile() throws {
        let m = try match("https://tangled.org/alice.bsky.social")
        XCTAssertEqual(m?.source, .tangled)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertEqual(m?.parsed.handle, "alice.bsky.social")
        XCTAssertNil(try match("https://tangled.org/"))
    }

    func testParsesMarginAnnotation() throws {
        let m = try match("https://margin.at/alice.bsky.social/annotation/abc")
        XCTAssertEqual(m?.source, .margin)
        XCTAssertEqual(m?.parsed.collection, "at.margin.annotation")
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.uri, "at://alice.bsky.social/at.margin.annotation/abc")
    }

    func testMarginRecordTypesAndProfile() throws {
        XCTAssertEqual(try match("https://margin.at/alice.test/highlight/abc")?.parsed.collection, "at.margin.highlight")
        XCTAssertEqual(try match("https://margin.at/alice.test/bookmark/abc")?.parsed.collection, "at.margin.bookmark")
        // Only the three record types the site exposes at this path.
        XCTAssertNil(try match("https://margin.at/alice.test/collection/abc"))
        XCTAssertNil(try match("https://margin.at/alice.test/annotation"))
        let profile = try match("https://margin.at/profile/alice.test")
        XCTAssertEqual(profile?.source, .margin)
        XCTAssertEqual(profile?.parsed.type, .profile)
        // Unlike the link generator, the reverse parser does not treat a bare
        // `/handle` as a profile.
        XCTAssertNil(try match("https://margin.at/alice.test"))
    }

    func testParsesSembleProfile() throws {
        let m = try match("https://semble.so/profile/alice.bsky.social")
        XCTAssertEqual(m?.source, .semble)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertNil(try match("https://semble.so/alice.bsky.social"))
    }

    func testParsesStreamplacePopfeedSifaAndBlentoProfiles() throws {
        let streamplace = try match("https://stream.place/alice.test")
        XCTAssertEqual(streamplace?.source, .streamplace)
        XCTAssertEqual(streamplace?.parsed.type, .profile)
        XCTAssertNil(try match("https://stream.place/"))

        let popfeed = try match("https://popfeed.social/profile/did:plc:x")
        XCTAssertEqual(popfeed?.source, .popfeed)
        XCTAssertEqual(popfeed?.parsed.did, "did:plc:x")
        XCTAssertNil(try match("https://popfeed.social/did:plc:x"))

        let sifa = try match("https://sifa.id/p/alice.test")
        XCTAssertEqual(sifa?.source, .sifa)
        XCTAssertEqual(sifa?.parsed.handle, "alice.test")
        XCTAssertNil(try match("https://sifa.id/alice.test"))

        let blento = try match("https://blento.app/alice.test")
        XCTAssertEqual(blento?.source, .blento)
        XCTAssertEqual(blento?.parsed.type, .profile)
        XCTAssertNil(try match("https://blento.app/"))
    }

    func testParsesGrainGalleryAndProfile() throws {
        let gallery = try match("https://grain.social/profile/alice.test/gallery/abc")
        XCTAssertEqual(gallery?.source, .grain)
        XCTAssertEqual(gallery?.parsed.type, .record)
        XCTAssertEqual(gallery?.parsed.collection, "social.grain.gallery")
        XCTAssertEqual(gallery?.parsed.uri, "at://alice.test/social.grain.gallery/abc")

        let profile = try match("https://grain.social/profile/alice.test")
        XCTAssertEqual(profile?.parsed.type, .profile)
        // An unknown subpage still names the account.
        XCTAssertEqual(try match("https://grain.social/profile/alice.test/favs")?.parsed.type, .profile)
        XCTAssertNil(try match("https://grain.social/explore"))
    }

    func testParsesAStandardReaderDocumentIntoASiteStandardDocumentUri() throws {
        let m = try match("https://standard-reader.app/a/did:plc:ofrbh253gwicbkc5nktqepol/3mnzim6jkqs24")
        XCTAssertEqual(m?.source, .standardReader)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "site.standard.document")
        XCTAssertEqual(m?.parsed.rkey, "3mnzim6jkqs24")
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:ofrbh253gwicbkc5nktqepol/site.standard.document/3mnzim6jkqs24")
    }

    func testParsesAStandardReaderProfile() throws {
        let m = try match("https://standard-reader.app/u/did:plc:ofrbh253gwicbkc5nktqepol")
        XCTAssertEqual(m?.source, .standardReader)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertNil(try match("https://standard-reader.app/a/did:plc:x"))
        XCTAssertNil(try match("https://standard-reader.app/settings"))
    }

    func testParsesAnAnisotaReaderDocumentIntoASiteStandardDocumentUri() throws {
        let m = try match("https://anisota.net/profile/did:plc:xyz/document/rk123")
        XCTAssertEqual(m?.source, .anisota)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "site.standard.document")
        XCTAssertEqual(m?.parsed.rkey, "rk123")
        XCTAssertEqual(m?.parsed.did, "did:plc:xyz")
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:xyz/site.standard.document/rk123")
    }

    func testParsesAnOffprintRecord() throws {
        let m = try match("https://offprint.app/did:plc:xyz/site.standard.document/rk123")
        XCTAssertEqual(m?.source, .offprint)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "site.standard.document")
        XCTAssertEqual(m?.parsed.rkey, "rk123")
        XCTAssertEqual(m?.parsed.did, "did:plc:xyz")
    }

    func testParsesAPcktRecord() throws {
        let m = try match("https://pckt.blog/did:plc:xyz/pub.leaflet.document/rk123")
        XCTAssertEqual(m?.source, .pckt)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "pub.leaflet.document")
        XCTAssertEqual(m?.parsed.rkey, "rk123")
    }

    func testDoesNotTreatNonRecordOffprintPcktPathsAsRecords() throws {
        // No NSID collection segment -> not a record link.
        XCTAssertNil(try match("https://offprint.app/settings"))
        XCTAssertNil(try match("https://pckt.blog/alice.bsky.social/notacollection/rk"))
        // Both only expose record-level URLs, so a profile-only path has no match.
        XCTAssertNil(try match("https://offprint.app/did:plc:xyz"))
    }

    func testParsesTaprootRecordAndProfile() throws {
        let record = try match("https://atproto.at/uri/at://did:plc:x/app.bsky.feed.post/abc")
        XCTAssertEqual(record?.source, .taproot)
        XCTAssertEqual(record?.parsed.type, .post)
        XCTAssertEqual(record?.parsed.uri, "at://did:plc:x/app.bsky.feed.post/abc")

        let profile = try match("https://atproto.at/uri/at:/alice.test")
        XCTAssertEqual(profile?.source, .taproot)
        XCTAssertEqual(profile?.parsed.type, .profile)
        // The AT URI must sit under `/uri/`; the bare universal form belongs
        // to other explorers.
        XCTAssertNil(try match("https://atproto.at/at://did:plc:x"))
        XCTAssertNil(try match("https://atproto.at/uri/"))
        XCTAssertNil(try match("https://atproto.at/"))
    }

    func testIgnoresUnsupportedHosts() throws {
        XCTAssertNil(try match("https://example.com/profile/alice"))
        XCTAssertNil(try match("https://example.com/at://did:plc:x/app.bsky.feed.post/abc"))
    }

    // MARK: matchSupportedUrl: aturi.to itself

    func testParsesAnExploreRecordUrl() throws {
        let m = try match("https://aturi.to/explore/dame.is/is.dame.arena.mirror.block/38397630")
        XCTAssertEqual(m?.source, .aturiExplore)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.handle, "dame.is")
        XCTAssertEqual(m?.parsed.collection, "is.dame.arena.mirror.block")
        XCTAssertEqual(m?.parsed.rkey, "38397630")
        XCTAssertEqual(m?.parsed.uri, "at://dame.is/is.dame.arena.mirror.block/38397630")
        XCTAssertNil(m?.parsed.did)
    }

    func testParsesAnExploreRecordUrlKeyedByDid() throws {
        let m = try match("https://aturi.to/explore/did:plc:xyz/app.bsky.feed.post/rk123")
        XCTAssertEqual(m?.source, .aturiExplore)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.did, "did:plc:xyz")
    }

    func testParsesAnExploreProfileRepoBrowseUrl() throws {
        let m = try match("https://aturi.to/explore/dame.is")
        XCTAssertEqual(m?.source, .aturiExplore)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertEqual(m?.parsed.handle, "dame.is")
        XCTAssertNil(m?.parsed.collection)
    }

    func testTreatsAnExploreCollectionListingAsProfileLevel() throws {
        let m = try match("https://aturi.to/explore/dame.is/is.dame.arena.mirror.block")
        XCTAssertEqual(m?.source, .aturiExplore)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertEqual(m?.parsed.uri, "at://dame.is")
    }

    func testParsesAProfilePostUrlAsTheAturiUniversalLinkSource() throws {
        let m = try match("https://aturi.to/profile/alice.bsky.social/post/3k7abc")
        XCTAssertEqual(m?.source, .aturi)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.collection, "app.bsky.feed.post")
        XCTAssertEqual(m?.parsed.rkey, "3k7abc")
    }

    func testParsesAProfileListsUrl() throws {
        let m = try match("https://aturi.to/profile/alice.bsky.social/lists/abc")
        XCTAssertEqual(m?.source, .aturi)
        XCTAssertEqual(m?.parsed.type, .list)
        XCTAssertEqual(m?.parsed.collection, "app.bsky.graph.list")
    }

    func testParsesAGenericProfileRecordUrl() throws {
        let m = try match("https://aturi.to/profile/dame.is/is.dame.arena.mirror.block/38397630")
        XCTAssertEqual(m?.source, .aturi)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "is.dame.arena.mirror.block")
    }

    func testParsesABareProfileUrlAsAProfile() throws {
        let m = try match("https://aturi.to/profile/alice.bsky.social")
        XCTAssertEqual(m?.source, .aturi)
        XCTAssertEqual(m?.parsed.type, .profile)
        // A dotless subpage is not a record collection, so it stays a profile.
        XCTAssertEqual(try match("https://aturi.to/profile/alice.bsky.social/followers/x")?.parsed.type, .profile)
    }

    func testIgnoresTheExplorerSubToolsAndNonAccountRoutes() throws {
        // Bare-word first segments are not accounts, so these must not
        // falsely resolve to a profile on a fake "lexicons" / "pds" /
        // "settings" handle.
        XCTAssertNil(try match("https://aturi.to/"))
        XCTAssertNil(try match("https://aturi.to"))
        XCTAssertNil(try match("https://aturi.to/explore/lexicons"))
        XCTAssertNil(try match("https://aturi.to/explore/lexicons/app.bsky.feed.post"))
        XCTAssertNil(try match("https://aturi.to/explore/pds"))
        XCTAssertNil(try match("https://aturi.to/explore/pds/example.com"))
        XCTAssertNil(try match("https://aturi.to/docs"))
        XCTAssertNil(try match("https://aturi.to/settings"))
        XCTAssertNil(try match("https://aturi.to/profile/settings"))
    }

    // MARK: space addresses are never reverse-matched

    // Permissioned space addresses are private. Reverse-parsing one would
    // offer it to every public explorer in the waypoint list, so each
    // detector returns nil and the URL reads as unrecognised instead.

    func testRefusesAnAturiExplorerSpacePath() throws {
        XCTAssertNil(try match("https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1"))
        XCTAssertNil(try match("https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc"))
    }

    func testStillMatchesAPublicCollectionWhoseNsidStartsWithSpace() throws {
        let m = try match("https://aturi.to/explore/did:plc:x/space.example.thing/abc")
        XCTAssertEqual(m?.source, .aturiExplore)
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "space.example.thing")
        XCTAssertEqual(m?.parsed.rkey, "abc")
    }

    func testRefusesATaprootSpaceUrl() throws {
        XCTAssertNil(try match("https://atproto.at/uri/at://did:plc:x/space/com.example.forum/skey1"))
    }

    func testRefusesAPdslsAndAtpToolsSpaceUrl() throws {
        // These share the AT URI path parser, so the guard lives there rather
        // than in each matcher. Without it the address is read as a record
        // in a collection literally named `space`, with the space type in the
        // rkey slot.
        XCTAssertNil(try match("https://pdsls.dev/at://did:plc:x/space/com.example.forum/skey1"))
        XCTAssertNil(try match("https://pdsls.dev/at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc"))
        XCTAssertNil(try match("https://atp.tools/at:/did:plc:x/space/com.example.forum/skey1"))
        XCTAssertNil(try match("https://bluepy.social/at://did:plc:x/space/com.example.forum/skey1"))
    }

    func testStillMatchesAPdslsRecordWhoseCollectionStartsWithSpace() throws {
        let m = try match("https://pdsls.dev/at://did:plc:x/space.example.thing/abc")
        XCTAssertEqual(m?.source, .pdsls)
        XCTAssertEqual(m?.parsed.collection, "space.example.thing")
    }

    func testRefusesASpaceAtUriFoundInALinkTag() {
        XCTAssertNil(reverseParseAtUri("at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc"))
        XCTAssertNil(reverseParseAtUri("at://did:plc:x/space/com.example.forum/skey1"))
    }

    func testStillParsesAnAtUriWhoseCollectionMerelyStartsWithSpace() {
        let m = reverseParseAtUri("at://did:plc:x/space.example.thing/abc")
        XCTAssertEqual(m?.parsed.type, .record)
        XCTAssertEqual(m?.parsed.collection, "space.example.thing")
    }

    // MARK: isSupportedHost

    func testRecognizesExactHostsAndStripsWww() {
        XCTAssertTrue(isSupportedHost("bsky.app"))
        XCTAssertTrue(isSupportedHost("www.anisota.net"))
        XCTAssertTrue(isSupportedHost("offprint.app"))
        XCTAssertTrue(isSupportedHost("ANISOTA.NET"))
        XCTAssertTrue(isSupportedHost("aturi.to"))
        XCTAssertTrue(isSupportedHost("WWW.PDSLS.DEV"))
    }

    func testRecognizesAnisotaSubdomains() {
        XCTAssertTrue(isSupportedHost("eclose.anisota.net"))
        XCTAssertTrue(isSupportedHost("sub.eclose.anisota.net"))
    }

    func testRejectsLookalikesAndNonSubdomainHosts() {
        XCTAssertFalse(isSupportedHost("notanisota.net"))
        XCTAssertFalse(isSupportedHost("anisota.net.evil.com"))
        XCTAssertFalse(isSupportedHost("bsky.app.evil.com"))
        XCTAssertFalse(isSupportedHost("example.com"))
        // Only opted-in hosts match subdomains; bsky.app does not.
        XCTAssertFalse(isSupportedHost("foo.bsky.app"))
        XCTAssertFalse(isSupportedHost(""))
    }

    func testSupportedHostsMatchesTheWebList() {
        XCTAssertEqual(supportedHosts, [
            "aturi.to",
            "bsky.app",
            "blacksky.community",
            "reddwarf.app",
            "impro.social",
            "lea.ac",
            "witchsky.app",
            "deer.social",
            "northsky.app",
            "mu.social",
            "anisota.net",
            "pinkleap.app",
            "leaflet.pub",
            "tangled.org",
            "margin.at",
            "pdsls.dev",
            "atp.tools",
            "bluepy.social",
            "semble.so",
            "stream.place",
            "grain.social",
            "popfeed.social",
            "sifa.id",
            "blento.app",
            "standard-reader.app",
            "offprint.app",
            "pckt.blog",
            "atproto.at",
        ])
        XCTAssertEqual(Set(supportedHosts).count, supportedHosts.count, "no duplicate hosts")
        for host in supportedHosts {
            XCTAssertTrue(isSupportedHost(host), host)
        }
    }

    // MARK: reverseParseAtUri

    func testParsesARecordAtUri() {
        let m = reverseParseAtUri("at://did:plc:x/app.bsky.feed.post/abc")
        XCTAssertEqual(m?.source, .headDetected)
        XCTAssertEqual(m?.parsed.type, .post)
        XCTAssertEqual(m?.parsed.did, "did:plc:x")
        XCTAssertEqual(m?.parsed.collection, "app.bsky.feed.post")
        XCTAssertEqual(m?.parsed.rkey, "abc")
        XCTAssertEqual(m?.parsed.uri, "at://did:plc:x/app.bsky.feed.post/abc")
        XCTAssertEqual(reverseParseAtUri("at://did:plc:x/app.bsky.graph.list/abc")?.parsed.type, .list)
        XCTAssertEqual(reverseParseAtUri("at://did:plc:x/com.example.thing/abc")?.parsed.type, .record)
    }

    func testParsesAProfileAtUri() {
        let m = reverseParseAtUri("at://alice.bsky.social")
        XCTAssertEqual(m?.source, .headDetected)
        XCTAssertEqual(m?.parsed.type, .profile)
        XCTAssertEqual(m?.parsed.handle, "alice.bsky.social")
        XCTAssertEqual(m?.parsed.uri, "at://alice.bsky.social")
        XCTAssertNil(m?.parsed.did)
        // A collection without an rkey is still profile-level, like the web.
        XCTAssertEqual(reverseParseAtUri("at://alice.bsky.social/app.bsky.feed.post")?.parsed.type, .profile)
    }

    func testRejectsNonAtUris() {
        XCTAssertNil(reverseParseAtUri("https://bsky.app/profile/alice"))
        XCTAssertNil(reverseParseAtUri("at://"))
        XCTAssertNil(reverseParseAtUri("at:///"))
        XCTAssertNil(reverseParseAtUri(""))
        XCTAssertNil(reverseParseAtUri("AT://alice.test"))
    }

    // MARK: Swift-specific: URL normalisation

    func testNormalisesHostCaseWwwPortTrailingSlashAndFragment() throws {
        XCTAssertEqual(try match("https://WWW.BSKY.APP/profile/alice.bsky.social")?.source, .bluesky)
        XCTAssertEqual(try match("https://www.anisota.net/profile/alice.bsky.social")?.source, .anisota)
        let withPort = try match("https://bsky.app:443/profile/alice.bsky.social/post/abc/")
        XCTAssertEqual(withPort?.parsed.type, .post)
        XCTAssertEqual(withPort?.parsed.rkey, "abc")
        XCTAssertEqual(try match("https://margin.at/alice.bsky.social/annotation/abc#top")?.source, .margin)
        XCTAssertEqual(try match("http://tangled.org/alice.test?tab=repos")?.source, .tangled)
        // Doubled slashes are empty segments and are skipped.
        XCTAssertEqual(try match("https://bsky.app//profile//alice.bsky.social")?.parsed.handle, "alice.bsky.social")
        // A URL without a host is nothing.
        XCTAssertNil(try match("/profile/alice.bsky.social"))
        XCTAssertNil(try match("mailto:alice@example.com"))
    }

    func testKeepsThePathPercentEncodedLikeTheBrowser() throws {
        // `pathname` in the browser stays encoded, so the handle segment is
        // reported exactly as it appeared in the address bar.
        XCTAssertEqual(try match("https://bsky.app/profile/alice%20b")?.parsed.handle, "alice%20b")
        XCTAssertEqual(try match("https://bsky.app/profile/alice.test/post/a%2Fb")?.parsed.rkey, "a%2Fb")
    }

    func testMatchesFromAString() {
        let m = matchSupportedUrl(string: "  https://bsky.app/profile/alice.bsky.social/post/abc \n")
        XCTAssertEqual(m?.source, .bluesky)
        XCTAssertEqual(m?.parsed.rkey, "abc")
        XCTAssertNil(matchSupportedUrl(string: "not a url"))
        XCTAssertNil(matchSupportedUrl(string: ""))
        XCTAssertNil(matchSupportedUrl(string: "bsky.app/profile/alice.bsky.social"))
        XCTAssertNil(matchSupportedUrl(string: "https://example.com/profile/alice"))
    }

    // MARK: Swift-specific: sources and the catalog

    func testEverySourceExceptHeadDetectedIsACatalogWaypoint() {
        for source in SourceApp.allCases {
            if source == .headDetected {
                XCTAssertNil(source.waypointId)
                continue
            }
            XCTAssertEqual(source.waypointId, source.rawValue)
            XCTAssertNotNil(WaypointCatalog.all[source.rawValue], "\(source.rawValue) is not a WaypointCatalog id")
        }
        XCTAssertEqual(SourceApp.allCases.count, 30)
    }

    func testReverseMatchEquality() throws {
        let a = try XCTUnwrap(reverseParseAtUri("at://did:plc:x/app.bsky.feed.post/abc"))
        let b = ReverseMatch(
            source: .headDetected,
            parsed: ParsedURI(
                type: .post,
                uri: "at://did:plc:x/app.bsky.feed.post/abc",
                handle: "did:plc:x",
                did: "did:plc:x",
                collection: "app.bsky.feed.post",
                rkey: "abc"
            )
        )
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.hashValue, b.hashValue)
    }

    // MARK: drift guard against src/utils/reverseParsers.ts

    /// `ios/Packages/AturiCore/Tests/AturiCoreTests/<this file>` is five
    /// levels below the repository root.
    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AturiCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AturiCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
    }

    private func webReverseParsersSource() throws -> String {
        let file = repoRoot.appendingPathComponent("src/utils/reverseParsers.ts")
        guard let source = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("web reverse parsers not available at \(file.path)")
        }
        return source
    }

    private func singleQuotedLiterals(in text: Substring) -> [String] {
        text.matches(of: #/'([^']+)'/#).map { String($0.1) }
    }

    func testSourceAppMatchesTheWebUnion() throws {
        let source = try webReverseParsersSource()
        guard let union = source.firstMatch(of: #/export type SourceApp =([^;]*);/#) else {
            XCTFail("SourceApp union not found in reverseParsers.ts")
            return
        }
        let web = Set(singleQuotedLiterals(in: union.1))
        XCTAssertFalse(web.isEmpty)
        XCTAssertEqual(Set(SourceApp.allCases.map { $0.rawValue }), web, "SourceApp must list the same ids as the web union")
    }

    func testSupportedHostsMatchTheWebTables() throws {
        let source = try webReverseParsersSource()
        guard let family = source.firstMatch(of: #/const BLUESKY_FAMILY: HostConfig\[\] = \[([^;]*)\];/#),
              let list = source.firstMatch(of: #/SUPPORTED_HOSTS: string\[\] = \[([^;]*)\];/#)
        else {
            XCTFail("BLUESKY_FAMILY or SUPPORTED_HOSTS not found in reverseParsers.ts")
            return
        }
        var web: [String] = []
        for entry in family.1.matches(of: #/hosts: \[([^\]]*)\]/#) {
            web += singleQuotedLiterals(in: entry.1)
        }
        web += singleQuotedLiterals(in: list.1)
        XCTAssertFalse(web.isEmpty)
        XCTAssertEqual(Set(supportedHosts), Set(web), "supportedHosts must list the same hosts as the web")

        // Every host the web matches on by name must be a supported host, or
        // the popup would never reach that matcher.
        for literal in source.matches(of: #/host (?:!==|===) '([^']+)'/#) {
            XCTAssertTrue(supportedHosts.contains(String(literal.1)), "\(literal.1) is matched on the web but not in supportedHosts")
        }
        for literal in source.matches(of: #/host: '([^']+)'/#) {
            XCTAssertTrue(supportedHosts.contains(String(literal.1)), "\(literal.1) is matched on the web but not in supportedHosts")
        }
    }
}
