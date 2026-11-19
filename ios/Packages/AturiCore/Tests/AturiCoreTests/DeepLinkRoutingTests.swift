import XCTest
@testable import AturiCore

/// The app's deep-link grammar (`Aturi/DeepLinks.swift` maps these
/// destinations onto its routes and tabs), checked against the web's route
/// tree and the query its pages read.
final class DeepLinkRoutingTests: XCTestCase {
    private func destination(_ string: String) -> DeepLinkDestination? {
        DeepLinkRouting.destination(for: string)
    }

    // MARK: LinkParts

    func testLinkPartsSplitsSchemeHostPathAndQuery() throws {
        let parts = try XCTUnwrap(LinkParts("HTTPS://www.Aturi.to/explore/alice.test?tab=audit&q=a%20b#frag"))
        XCTAssertEqual(parts.scheme, "https")
        XCTAssertEqual(parts.host, "aturi.to")
        XCTAssertEqual(parts.path, "/explore/alice.test")
        XCTAssertEqual(parts.pathSegments, ["explore", "alice.test"])
        XCTAssertEqual(parts.query, ["tab": "audit", "q": "a b"])
        XCTAssertEqual(parts.fragment, "frag")
        XCTAssertEqual(LinkParts("https://aturi.to/links")?.fragment, "")
    }

    func testLinkPartsKeepsADidAuthorityWhole() throws {
        let parts = try XCTUnwrap(LinkParts("at://did:plc:abc/app.bsky.feed.post/3k7abc"))
        XCTAssertEqual(parts.scheme, "at")
        XCTAssertEqual(parts.host, "did:plc:abc")
        XCTAssertEqual(parts.pathSegments, ["app.bsky.feed.post", "3k7abc"])
    }

    func testLinkPartsKeepsTheFirstOfARepeatedKeyAndDropsUserinfo() throws {
        let parts = try XCTUnwrap(LinkParts("https://user@aturi.to/links?tab=audit&tab=identity&flag"))
        XCTAssertEqual(parts.host, "aturi.to")
        XCTAssertEqual(parts.query["tab"], "audit")
        XCTAssertEqual(parts.query["flag"], "")
    }

    func testLinkPartsReadsASchemeOnlyUrlWithNoHost() throws {
        let parts = try XCTUnwrap(LinkParts("to.aturi:/oauth/callback?code=x"))
        XCTAssertEqual(parts.scheme, "to.aturi")
        XCTAssertEqual(parts.host, "")
        XCTAssertEqual(parts.path, "/oauth/callback")
    }

    func testLinkPartsRefusesTextWithoutAScheme() {
        XCTAssertNil(LinkParts("not a link"))
        XCTAssertNil(LinkParts(""))
        XCTAssertNil(LinkParts("1http://aturi.to"))
    }

    // MARK: Sections

    func testTheSiteRootAndLinksOpenTheLinksSection() {
        XCTAssertEqual(destination("https://aturi.to"), .section(.links))
        XCTAssertEqual(destination("https://aturi.to/"), .section(.links))
        XCTAssertEqual(destination("https://aturi.to/links"), .section(.links))
        XCTAssertEqual(destination("https://www.aturi.to/links"), .section(.links))
    }

    func testAccountOpensSettingsAndItsHashNamesTheScreen() {
        XCTAssertEqual(destination("https://aturi.to/account"), .section(.settings))
        XCTAssertEqual(destination("https://aturi.to/account#redirects"), .section(.settings))
        XCTAssertEqual(DeepLinkRouting.settingsFragment(for: "https://aturi.to/account#Redirects"), "redirects")
        XCTAssertNil(DeepLinkRouting.settingsFragment(for: "https://aturi.to/account"))
        XCTAssertNil(DeepLinkRouting.settingsFragment(for: "https://aturi.to/account#"))
        XCTAssertNil(DeepLinkRouting.settingsFragment(for: "https://aturi.to/links#redirects"))
        XCTAssertNil(DeepLinkRouting.settingsFragment(for: "https://example.com/account#redirects"))
        let wrapped = "aturi://open?url=" + URIEncoding.encodeComponent("https://aturi.to/account#redirects")
        XCTAssertEqual(DeepLinkRouting.settingsFragment(for: wrapped), "redirects", "through the share extension's wrapper")
    }

    func testTheExplorerIndexesOpenTheExploreSection() {
        XCTAssertEqual(destination("https://aturi.to/explore"), .section(.explore))
        XCTAssertEqual(destination("https://aturi.to/explore/"), .section(.explore))
        XCTAssertEqual(destination("https://aturi.to/explore/pds"), .section(.explore))
    }

    // MARK: Universal-link pages

    func testProfileLinksOpenThePreview() {
        XCTAssertEqual(destination("https://aturi.to/profile/alice.test"), .preview(AtUriComponents(identifier: "alice.test")))
        XCTAssertEqual(destination("https://aturi.to/profile/did:plc:abc"), .preview(AtUriComponents(identifier: "did:plc:abc")))
        XCTAssertEqual(
            destination("https://aturi.to/profile/alice.test/post/3k7abc"),
            .preview(AtUriComponents(identifier: "alice.test", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
        XCTAssertEqual(
            destination("https://aturi.to/profile/alice.test/lists/abc"),
            .preview(AtUriComponents(identifier: "alice.test", collection: "app.bsky.graph.list", rkey: "abc"))
        )
        XCTAssertEqual(
            destination("https://aturi.to/profile/alice.test/pub.leaflet.document/xyz"),
            .preview(AtUriComponents(identifier: "alice.test", collection: "pub.leaflet.document", rkey: "xyz"))
        )
        XCTAssertNil(destination("https://aturi.to/profile/alice.test/post"))
    }

    func testABareHandleIsAPreviewButAPageOrFileIsNot() {
        XCTAssertEqual(destination("https://aturi.to/alice.test"), .preview(AtUriComponents(identifier: "alice.test")))
        XCTAssertEqual(
            destination("https://aturi.to/did:plc:abc/app.bsky.feed.post/3k7abc"),
            .preview(AtUriComponents(identifier: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
        XCTAssertNil(destination("https://aturi.to/about"))
        XCTAssertNil(destination("https://aturi.to/llms.txt"))
        XCTAssertNil(destination("https://aturi.to/docs.md"))
        XCTAssertNil(destination("https://aturi.to/alice.test/post"))
    }

    func testAClientsOwnLinkOpensThePreview() {
        XCTAssertEqual(
            destination("https://bsky.app/profile/alice.bsky.social/post/abc"),
            .preview(AtUriComponents(identifier: "alice.bsky.social", collection: "app.bsky.feed.post", rkey: "abc"))
        )
        XCTAssertEqual(destination("https://bsky.app/profile/alice.bsky.social"), .preview(AtUriComponents(identifier: "alice.bsky.social")))
    }

    func testStayIsReadThroughTheShareExtensionsWrapper() {
        XCTAssertTrue(DeepLinkRouting.asksToStay("https://aturi.to/profile/alice.test?stay=1"))
        XCTAssertFalse(DeepLinkRouting.asksToStay("https://aturi.to/profile/alice.test?stay=0"))
        XCTAssertFalse(DeepLinkRouting.asksToStay("https://aturi.to/profile/alice.test"))
        XCTAssertTrue(DeepLinkRouting.asksToStay("aturi://open?url=https%3A%2F%2Faturi.to%2Fprofile%2Falice.test%3Fstay%3D1"))
    }

    // MARK: Explorer pages

    func testExplorerPathsOpenTheirPage() {
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test"), .explore(.repo("alice.test")))
        XCTAssertEqual(
            destination("https://aturi.to/explore/did:plc:abc/app.bsky.feed.post"),
            .explore(.collection(repo: "did:plc:abc", collection: "app.bsky.feed.post"))
        )
        XCTAssertEqual(
            destination("https://aturi.to/explore/did:plc:abc/app.bsky.feed.post/3k7abc"),
            .explore(.record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
        XCTAssertEqual(destination("https://aturi.to/explore/pds/pds.example.com"), .explore(.pds(host: "pds.example.com")))
    }

    func testSpacePagesAreLeftToSafari() {
        XCTAssertNil(destination("https://aturi.to/explore/spaces"))
        XCTAssertNil(destination("https://aturi.to/explore/did:plc:abc/space/self"))
        XCTAssertNil(destination("https://aturi.to/at/did:plc:abc/space/self"))
    }

    func testARepoLinksTabOpensThePageOnThatTab() {
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=audit"), .explore(.repo("alice.test"), repoTab: "audit"))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=identity"), .explore(.repo("alice.test"), repoTab: "identity"))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=backlinks"), .explore(.repo("alice.test"), repoTab: "backlinks"))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=labels"), .explore(.repo("alice.test"), repoTab: "labels"))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=visibility"), .explore(.repo("alice.test"), repoTab: "visibility"))
        XCTAssertEqual(
            destination("https://aturi.to/explore/did%3Aplc%3Aabc?tab=audit"),
            .explore(.repo("did:plc:abc"), repoTab: "audit")
        )
    }

    func testTheDefaultOrAnUnknownTabOpensCollections() {
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=collections"), .explore(.repo("alice.test")))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=nope"), .explore(.repo("alice.test")))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab=Audit"), .explore(.repo("alice.test")))
        XCTAssertEqual(destination("https://aturi.to/explore/alice.test?tab="), .explore(.repo("alice.test")))
    }

    func testOnlyARepoPageReadsTheTab() {
        XCTAssertEqual(
            destination("https://aturi.to/explore/alice.test/app.bsky.feed.post?tab=audit"),
            .explore(.collection(repo: "alice.test", collection: "app.bsky.feed.post"))
        )
        XCTAssertNil(DeepLinkRouting.repoTab(from: [:]))
        XCTAssertEqual(DeepLinkRouting.repoTab(from: ["tab": "audit"]), "audit")
    }

    func testATabIsReadThroughTheShareExtensionsWrapper() {
        XCTAssertEqual(
            destination("aturi://open?url=https%3A%2F%2Faturi.to%2Fexplore%2Falice.test%3Ftab%3Daudit"),
            .explore(.repo("alice.test"), repoTab: "audit")
        )
    }

    // MARK: Lexicons

    func testTheLexiconsIndexOpensTheLexiconsSection() {
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons"), .section(.lexicons))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=nope"), .section(.lexicons))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=%20"), .section(.lexicons))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons#pinned"), .section(.lexicons))
    }

    func testANamedListOpensTheLexiconsSectionOnIt() {
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=new"), .lexiconList("new"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=trending"), .lexiconList("trending"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=top"), .lexiconList("top"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=all&window=1d"), .lexiconList("all"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=New"), .section(.lexicons))
    }

    func testTheNewCardsAnchorOpensTheNewList() {
        // The landing's "All new lexicons" links here on the web.
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons#new"), .lexiconList("new"))
        // A named list or a search is what the page shows, anchor or not.
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=all#new"), .lexiconList("all"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=leaflet#new"), .explore(.lexiconGroup(prefix: "leaflet")))
    }

    func testALexiconsSearchOrNamespaceOpensTheGroupPage() {
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=leaflet"), .explore(.lexiconGroup(prefix: "leaflet")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=two+words"), .explore(.lexiconGroup(prefix: "two words")), "a plus is a space, as URLSearchParams writes it")
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=a%2Bb"), .explore(.lexiconGroup(prefix: "a+b")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?q=%20leaflet%20"), .explore(.lexiconGroup(prefix: "leaflet")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?ns=app.bsky"), .explore(.lexiconGroup(prefix: "app.bsky")))
        // An undotted `ns` is not a namespace; the web ignores it too.
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?ns=bsky"), .section(.lexicons))
    }

    func testTheLexiconsQueryIsReadInTheWebsOrder() {
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=new&q=leaflet"), .lexiconList("new"))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?list=nope&q=leaflet"), .explore(.lexiconGroup(prefix: "leaflet")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons?ns=app.bsky&q=leaflet"), .explore(.lexiconGroup(prefix: "app.bsky")))
    }

    func testALexiconLinkOpensTheLexiconWhateverItsQuery() {
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons/app.bsky.feed.post"), .explore(.lexicon(nsid: "app.bsky.feed.post")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons/app.bsky.feed.post?records=1"), .explore(.lexicon(nsid: "app.bsky.feed.post")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons/app.bsky.feed.post?list=new&records=1"), .explore(.lexicon(nsid: "app.bsky.feed.post")))
        XCTAssertEqual(destination("https://aturi.to/explore/lexicons/group/app.bsky"), .explore(.lexiconGroup(prefix: "app.bsky")))
    }

    // MARK: AT URIs

    func testTheAtSchemeOpensTheExplorer() {
        XCTAssertEqual(destination("at://did:plc:abc"), .explore(.repo("did:plc:abc")))
        XCTAssertEqual(destination("at://did:plc:abc/app.bsky.feed.post"), .explore(.collection(repo: "did:plc:abc", collection: "app.bsky.feed.post")))
        XCTAssertEqual(
            destination("at://did:plc:abc/app.bsky.feed.post/3k7abc"),
            .explore(.record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
    }

    func testAtPathsOnTheSiteOpenTheExplorer() {
        XCTAssertEqual(destination("https://aturi.to/at/did:plc:abc"), .explore(.repo("did:plc:abc")))
        XCTAssertEqual(
            destination("https://aturi.to/at/did:plc:abc/app.bsky.feed.post/3k7abc"),
            .explore(.record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
        XCTAssertEqual(
            destination("https://aturi.to/at://did:plc:abc/app.bsky.feed.post/3k7abc"),
            .explore(.record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k7abc"))
        )
    }

    // MARK: Refusals

    func testLinksThatAreNotPagesAreRefused() {
        XCTAssertNil(destination("to.aturi:/oauth/callback?code=x"))
        XCTAssertNil(destination("mailto:someone@example.com"))
        XCTAssertNil(destination("aturi://settings"))
        XCTAssertNil(destination("not a link"))
        XCTAssertNil(destination(""))
    }

    func testTheShareExtensionsWrapperNestsTwoDeepAndNoFurther() {
        let inner = "https://aturi.to/explore/alice.test"
        let once = "aturi://open?url=" + URIEncoding.encodeComponent(inner)
        let twice = "aturi://open?url=" + URIEncoding.encodeComponent(once)
        let thrice = "aturi://open?url=" + URIEncoding.encodeComponent(twice)
        XCTAssertEqual(destination(once), .explore(.repo("alice.test")))
        XCTAssertEqual(destination(twice), .explore(.repo("alice.test")))
        XCTAssertNil(destination(thrice))
    }

    // MARK: Tools

    func testToolLinksOpenTheHubOrATool() {
        XCTAssertEqual(DeepLinkRouting.destination(for: "https://aturi.to/tools"), .section(.tools))
        XCTAssertEqual(
            DeepLinkRouting.destination(for: "https://aturi.to/tools/handle?handle=alice.test"),
            .tool(slug: "handle", query: ["handle": "alice.test"])
        )
        XCTAssertEqual(DeepLinkRouting.destination(for: "https://aturi.to/tools/decode"), .tool(slug: "decode", query: [:]))
        XCTAssertNil(DeepLinkRouting.destination(for: "https://aturi.to/tools/nope"), "a slug the catalog does not list stays with Safari")
        XCTAssertNil(DeepLinkRouting.destination(for: "https://aturi.to/tools/handle/extra"))
    }
}
