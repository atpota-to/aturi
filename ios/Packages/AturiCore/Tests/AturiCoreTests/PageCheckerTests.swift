import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Port of src/lib/tools/__tests__/page.test.ts and
// src/utils/atproto/__tests__/atTags.test.ts, and of the page route's
// bounded fetch against a scripted transport.

private let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
private let pageRecord = "at://\(did)/site.standard.document/3kabc"
private let page = "https://blog.example.com/posts/hello"

private let full = """
<!doctype html><html><head>
  <title>Hello &amp; welcome | Example Blog</title>
  <meta name="description" content="A plain description.">
  <link rel="canonical" href="https://blog.example.com/posts/hello">
  <meta property="og:title" content="Hello &amp; welcome">
  <meta property="og:description" content="The first post, with &quot;quotes&quot;.">
  <meta property="og:image" content="https://blog.example.com/cards/hello.png">
  <meta property="og:image" content="https://blog.example.com/cards/second.png">
  <meta property="og:site_name" content="Example Blog">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="at:canonical" content="\(pageRecord)">
  <meta name="at:author" content="at://\(did)">
  <meta name="at:standard.site:comments" content="at://\(did)/app.bsky.feed.post/3kxyz">
</head><body><svg><title>icon</title></svg></body></html>
"""

private func report(_ html: String, url: String = page) -> ServiceStep<PageChecker.Report> {
    .done(.fetched(url: url, reading: PageChecker.readPage(html)))
}

private func statusOf(_ html: String, _ id: String) -> ServiceCheckStatus? {
    PageChecker.buildChecks(report(html)).first { $0.id == id }?.status
}

final class PageCheckerTests: XCTestCase {
    func testNormalizeUrlAcceptsWebAddressesAndNothingElse() {
        XCTAssertEqual(PageChecker.normalizeUrl(" example.com/post "), .ok(url: "https://example.com/post"))
        XCTAssertEqual(PageChecker.normalizeUrl("http://example.com"), .ok(url: "http://example.com/"))
        XCTAssertNotNil(PageChecker.normalizeUrl("").reason)
        XCTAssertNotNil(PageChecker.normalizeUrl("at://did:plc:abc/app.bsky.feed.post/1").reason)
        XCTAssertNotNil(PageChecker.normalizeUrl("ftp://example.com/file").reason)
        XCTAssertNotNil(PageChecker.normalizeUrl("localhost").reason)
    }

    func testReadPageReadsTheCardFieldsDecodedAndTheFirstOfARepeatedOne() {
        let meta = PageChecker.readPage(full).meta
        XCTAssertEqual(meta.title, "Hello & welcome | Example Blog")
        XCTAssertEqual(meta.description, "A plain description.")
        XCTAssertEqual(meta.canonical, "https://blog.example.com/posts/hello")
        XCTAssertEqual(meta.og.title, "Hello & welcome")
        XCTAssertEqual(meta.og.description, "The first post, with \"quotes\".")
        XCTAssertEqual(meta.og.image, "https://blog.example.com/cards/hello.png")
        XCTAssertEqual(meta.og.siteName, "Example Blog")
        XCTAssertEqual(meta.og.type, "article")
        XCTAssertEqual(meta.twitter.card, "summary_large_image")
    }

    func testReadPageToleratesAttributeOrderQuotingAndTheNamePropertyMixUp() {
        let meta = PageChecker.readPage(#"<meta content='Single quoted' property='og:title' /><meta name="og:description" content=Unquoted>"#).meta
        XCTAssertEqual(meta.og.title, "Single quoted")
        XCTAssertEqual(meta.og.description, "Unquoted")
    }

    func testTheDeclaredRecordsComeBackGroupedInOrderWithThePrimaryOneNamed() {
        let reading = PageChecker.readPage(full)
        XCTAssertEqual(reading.tags.canonical, [pageRecord])
        XCTAssertEqual(reading.tags.author, ["at://\(did)"])
        XCTAssertEqual(reading.tags.namespaceMap, ["standard.site": ["comments": ["at://\(did)/app.bsky.feed.post/3kxyz"]]])
        XCTAssertEqual(reading.primary, pageRecord)
        XCTAssertEqual(reading.ignored, [])
        XCTAssertEqual(PageChecker.declaredRecords(reading).map(\.name), ["at:canonical", "at:author", "at:standard.site:comments"])
    }

    func testAtTagsTheParserDropsAreReportedWithTheReason() {
        let reading = PageChecker.readPage("""
            <meta name="at:canonical" content="https://example.com/not-an-at-uri">
            <meta name="at:related" content="\(pageRecord)">
            <meta name="at:alternate" content="\(pageRecord)">
            """)
        XCTAssertEqual(reading.tags.alternate, [pageRecord])
        XCTAssertEqual(reading.ignored.count, 2)
        XCTAssertTrue(reading.ignored.first?.reason.contains("not a valid at:// URI") ?? false)
        XCTAssertNotNil(reading.ignored.last?.reason.range(of: "not namespaced", options: .caseInsensitive))
        XCTAssertEqual(statusOf(#"<meta property="og:title" content="T"><meta name="at:canonical" content="nope">"#, "tags"), .warn)
    }

    func testTheOlderLinkElementIsFoundAndNotListedTwice() {
        let reading = PageChecker.readPage(#"<link rel="alternate" href="\#(pageRecord)"><link rel="alternate" href="\#(pageRecord)"><link rel="stylesheet" href="/a.css">"#)
        XCTAssertEqual(reading.headLinks, [PageChecker.HeadLink(rel: "alternate", href: pageRecord)])
        XCTAssertEqual(PageChecker.declaredRecords(reading).count, 1)
        let withBoth = PageChecker.readPage(#"<meta name="at:canonical" content="\#(pageRecord)"><link rel="alternate" href="\#(pageRecord)">"#)
        XCTAssertEqual(PageChecker.declaredRecords(withBoth).count, 1)
    }

    func testTheLinkCardPrefersOpenGraphAndFallsBack() {
        XCTAssertEqual(
            PageChecker.linkCard(PageChecker.readPage(full), pageUrl: page),
            PageChecker.LinkCard(
                title: "Hello & welcome",
                description: "The first post, with \"quotes\".",
                image: "https://blog.example.com/cards/hello.png",
                host: "blog.example.com"
            )
        )
        let fallback = PageChecker.linkCard(
            PageChecker.readPage(#"<title>Only a title</title><meta name="description" content="Plain."><meta name="twitter:image" content="/t.png">"#),
            pageUrl: "https://www.example.com/a/b"
        )
        XCTAssertEqual(fallback, PageChecker.LinkCard(title: "Only a title", description: "Plain.", image: "https://www.example.com/t.png", host: "example.com"))
        XCTAssertNil(PageChecker.absoluteImage("data:image/png;base64,AAAA", pageUrl: page))
        XCTAssertNil(PageChecker.absoluteImage(nil, pageUrl: page))
    }

    func testACompletePagePassesAndSaysHowManyRecordsItDeclares() {
        let checks = PageChecker.buildChecks(report(full))
        XCTAssertEqual(checks.map { "\($0.id):\($0.status.rawValue)" }, ["fetch:pass", "title:pass", "description:pass", "image:pass", "tags:pass"])
        let verdict = PageChecker.verdict(report(full), checks: checks)
        XCTAssertEqual(verdict.tone, .pass)
        XCTAssertTrue(verdict.text.contains("3 at:// URIs"))
    }

    func testMissingAndWeakCardFieldsAreGraded() {
        XCTAssertEqual(statusOf("<title>Only a title</title>", "title"), .warn)
        XCTAssertEqual(statusOf("<p>nothing</p>", "title"), .fail)
        XCTAssertEqual(statusOf(#"<meta name="description" content="Plain.">"#, "description"), .warn)
        XCTAssertEqual(statusOf("<p>nothing</p>", "description"), .warn)
        XCTAssertEqual(statusOf("<p>nothing</p>", "image"), .info)
        XCTAssertEqual(statusOf(#"<meta property="og:image" content="/card.png">"#, "image"), .warn)
        XCTAssertEqual(statusOf(#"<meta property="og:image" content="http://example.com/card.png">"#, "image"), .warn)
        XCTAssertEqual(statusOf(#"<meta name="twitter:image" content="https://example.com/card.png">"#, "image"), .warn)
        XCTAssertEqual(statusOf("<p>nothing</p>", "tags"), .info)
        let nothing = report("<p>nothing</p>")
        XCTAssertEqual(PageChecker.verdict(nothing, checks: PageChecker.buildChecks(nothing)).tone, .fail)
    }

    func testAPageThatCouldNotBeReadFailsOnceAndSkipsTheRest() {
        let unread: ServiceStep<PageChecker.Report> = .done(.unread(url: page))
        let checks = PageChecker.buildChecks(unread)
        XCTAssertEqual(checks.first?.status, .fail)
        XCTAssertTrue(checks.dropFirst().allSatisfy { $0.status == .skip })
        XCTAssertEqual(PageChecker.verdict(unread, checks: checks).tone, .fail)
        XCTAssertTrue(PageChecker.buildChecks(.pending).allSatisfy { $0.status == .pending })
        XCTAssertEqual(PageChecker.verdict(.pending, checks: PageChecker.buildChecks(.pending)).tone, .pending)
        XCTAssertEqual(PageChecker.buildChecks(.failed).first?.status, .fail)
    }

    func testAPageOfUnclosedTagsIsScannedInBoundedTime() {
        let hostile = String(repeating: "<meta ", count: 100_000)
        let started = Date()
        let reading = PageChecker.readPage(hostile)
        XCTAssertNil(reading.meta.og.title)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testEntitiesDecodeInTheWebsOrder() {
        XCTAssertEqual(PageCheckerHTML.decodeEntities("&amp;quot;"), "&quot;")
        XCTAssertEqual(PageCheckerHTML.decodeEntities("&#65;&#x42;&#X43;&#1114112;"), "ABC")
        XCTAssertEqual(PageCheckerHTML.decodeEntities("a&nbsp;b", nbsp: true), "a b")
        XCTAssertEqual(PageCheckerHTML.decodeEntities("a&nbsp;b"), "a&nbsp;b")
    }
}

// MARK: - AT Tags

private let oneMegabyte = 1024 * 1024

final class PageCheckerAtTagsTests: XCTestCase {
    /// These scanners run over a page fetched from an address someone typed,
    /// so their cost is chosen by whoever wrote the page. Both tag patterns
    /// were once quadratic on the web.
    func testAnUnclosedTagPageIsScannedInLinearTime() {
        let hostile = String(repeating: "<meta ", count: oneMegabyte / 6)
        let started = Date()
        let result = PageCheckerAtTags.parse(html: hostile)
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(result.canonical, [])
        XCTAssertLessThan(elapsed, 5, "the tag body bound is gone")
    }

    func testUnclosedTagsThatAlsoOpenAnAttributeStayLinear() {
        let hostile = String(repeating: #"<meta name="at:canonical" content="at://x "#, count: 25_000)
        let started = Date()
        _ = PageCheckerAtTags.parse(html: hostile)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testARealDeclarationIsStillReadQuotesEitherWay() {
        let charsets = String(repeating: #"<meta charset="utf-8">"#, count: 200)
        let page = "<html><head>" + charsets + #"<meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/xyz"></head>"#
        let result = PageCheckerAtTags.parse(html: page)
        XCTAssertEqual(result.canonical, ["at://did:plc:abc/app.bsky.feed.post/xyz"])
        XCTAssertEqual(PageCheckerAtTags.primaryRecord(result), "at://did:plc:abc/app.bsky.feed.post/xyz")

        let single = PageCheckerAtTags.parse(html: "<meta name='at:canonical' content='at://did:plc:abc/app.bsky.feed.post/single'>")
        XCTAssertEqual(single.canonical, ["at://did:plc:abc/app.bsky.feed.post/single"])
    }

    func testAPageDeclaringNothingIsAnEmptyResultNotAnError() {
        let result = PageCheckerAtTags.parse(html: "<html><head><title>hi</title></head><body>no tags</body></html>")
        XCTAssertEqual(result.canonical, [])
        XCTAssertNil(PageCheckerAtTags.primaryRecord(result))
    }

    func testTagNamesAndURIs() {
        XCTAssertEqual(PageCheckerAtTags.parseTagName("AT:Canonical"), .standard(.canonical))
        XCTAssertEqual(PageCheckerAtTags.parseTagName("at:standard.site:syndicatedBy"), .namespaced(namespace: "standard.site", property: "syndicatedBy"))
        XCTAssertNil(PageCheckerAtTags.parseTagName("at:related"))
        XCTAssertNil(PageCheckerAtTags.parseTagName("og:title"))
        XCTAssertTrue(PageCheckerAtTags.isValidAtUri(" at://alice.example.com/app.bsky.feed.post/1 "))
        XCTAssertFalse(PageCheckerAtTags.isValidAtUri("at://x"))
        XCTAssertFalse(PageCheckerAtTags.isValidAtUri("https://example.com"))
    }
}

// MARK: - The read

private final class PageFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String]
    }

    private let replies: [String: Reply]
    private let lock = NSLock()
    private var agents: [String] = []

    init(_ replies: [String: Reply]) {
        self.replies = replies
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        agents.append(request.value(forHTTPHeaderField: "User-Agent") ?? "")
        lock.unlock()
        let url = request.url!.absoluteString
        guard let reply = replies[url] else { throw URLError(.timedOut) }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (Data(reply.body.utf8), response)
    }

    var userAgents: [String] {
        lock.lock(); defer { lock.unlock() }
        return agents
    }
}

final class PageCheckerClientTests: XCTestCase {
    func testAPageIsFollowedThroughARedirectAndRead() async {
        let transport = PageFakeTransport([
            "https://blog.example.com/p": .init(status: 302, body: "", headers: ["Location": "/posts/hello"]),
            page: .init(status: 200, body: full, headers: ["Content-Type": "text/html; charset=utf-8"]),
        ])
        let client = PageCheckerClient(fetcher: ServiceFetcher(transport: transport))
        let read = await client.read("https://blog.example.com/p")
        XCTAssertEqual(read.url, "https://blog.example.com/p")
        XCTAssertEqual(read.reading?.primary, pageRecord)
        XCTAssertTrue(transport.userAgents.allSatisfy { $0.contains("aturi.to") })
    }

    func testWhatIsNotAnHTMLPageIsUnread() async {
        let transport = PageFakeTransport([
            "https://example.com/data.json": .init(status: 200, body: "{}", headers: ["Content-Type": "application/json"]),
            "https://example.com/gone": .init(status: 404, body: "<p>no</p>", headers: ["Content-Type": "text/html"]),
        ])
        let client = PageCheckerClient(fetcher: ServiceFetcher(transport: transport))
        let json = await client.read("https://example.com/data.json")
        XCTAssertEqual(json, .unread(url: "https://example.com/data.json"))
        let gone = await client.read("https://example.com/gone")
        XCTAssertNil(gone.reading)
        let slow = await client.read("https://example.com/slow")
        XCTAssertNil(slow.reading)
        let local = await client.read("http://192.168.1.1/")
        XCTAssertNil(local.reading)
    }

    func testAPageCutAtTheCapIsStillRead() async {
        let padding = String(repeating: "x", count: PageCheckerClient.maxBytes)
        let html = #"<meta property="og:title" content="Early">"# + padding + #"<meta property="og:description" content="Late">"#
        let transport = PageFakeTransport(["https://example.com/big": .init(status: 200, body: html, headers: ["Content-Type": "text/html"])])
        let read = await PageCheckerClient(fetcher: ServiceFetcher(transport: transport)).read("https://example.com/big")
        XCTAssertEqual(read.reading?.meta.og.title, "Early")
        XCTAssertNil(read.reading?.meta.og.description)
    }
}

@MainActor
final class PageCheckerModelTests: XCTestCase {
    func testARunReadsThePageAndThenItsRecord() async {
        let recordJSON = #"{"uri":"\#(pageRecord)","cid":"bafy","value":{"$type":"site.standard.document","title":"Hello"}}"#
        let transport = PageFakeTransport([
            page: .init(status: 200, body: full, headers: ["Content-Type": "text/html"]),
            "https://slingshot.microcosm.blue/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=\(URIEncoding.encodeComponent(pageRecord))":
                .init(status: 200, body: recordJSON, headers: ["Content-Type": "application/json"]),
        ])
        let client = PageCheckerClient(fetcher: ServiceFetcher(transport: transport), http: HTTPClient(transport: transport))
        let model = PageCheckerModel(client: client)
        XCTAssertEqual(model.verdict, nil)
        await model.run(page)?.value
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertEqual(model.linkCard?.title, "Hello & welcome")
        XCTAssertEqual(model.records.count, 3)
        XCTAssertEqual(model.primaryRecord?.value?.value["title"], "Hello")
        XCTAssertEqual(model.shareQuery, ["url": page])
        XCTAssertEqual(model.fields.first?.label, "og:title")
    }

    func testAnInputThatIsNotAPageSaysWhy() {
        let model = PageCheckerModel(client: PageCheckerClient(fetcher: ServiceFetcher(transport: PageFakeTransport([:]))))
        XCTAssertNil(model.run("at://did:plc:abc"))
        XCTAssertEqual(model.input?.reason, "That is an atproto identifier. Enter the address of a web page.")
        XCTAssertNil(model.verdict)
    }
}
