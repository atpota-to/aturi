import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the relay check: the first route whose
/// pattern the URL contains answers, after its delay; anything unrouted is
/// a 404. A route can also fail as a dropped connection would.
private final class RelayRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var delayNanoseconds: UInt64 = 0
        var fails = false
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        record(url.absoluteString)
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        if reply.delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: reply.delayNanoseconds)
        }
        if reply.fails {
            throw URLError(.networkConnectionLost)
        }
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

    private func record(_ url: String) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

/// Port of `src/lib/tools/__tests__/relay.test.ts`, plus the row reading
/// and the relays' account count the web keeps beside it.
final class RelayCheckTests: XCTestCase {
    private let host = "pds.example.com"
    private let did = "did:plc:relaychecktest00000000000"

    private let active: RelayCheck.Answer = .known(status: "active", accountCount: 12, seq: 3400)
    private let offline: RelayCheck.Answer = .known(status: "offline", accountCount: 0, seq: nil)
    private let unknown: RelayCheck.Answer = .unknown
    private let silent: RelayCheck.Answer = .error("no answer")

    private func results(_ answers: RelayCheck.Answer?...) -> [RelayCheck.RelayResult] {
        answers.enumerated().map { item in
            RelayCheck.RelayResult(relay: RelayCheck.relays[item.offset % RelayCheck.relays.count], answer: item.element)
        }
    }

    // MARK: The relays

    func testTheRelayListStartsWithTheExplorersRelayAndNamesNoHostTwice() {
        XCTAssertEqual(RelayCheck.relays.first?.host, Endpoints.relay.host)
        XCTAssertEqual(Set(RelayCheck.relays.map(\.host)).count, RelayCheck.relays.count)
        for relay in RelayCheck.relays {
            XCTAssertNotNil(relay.host.wholeMatch(of: #/[a-z0-9.-]+/#), relay.host)
        }
        XCTAssertEqual(RelayCheck.relays.map(\.operatorName), ["Bluesky", "Bluesky", "microcosm", "microcosm"])
    }

    // MARK: Input

    func testNormalizeInputTellsAHostFromAnAccountAndLeavesABareDomainOpen() {
        XCTAssertEqual(RelayCheck.normalizeInput(" PDS.Example.com "), .either("pds.example.com"))
        XCTAssertEqual(RelayCheck.normalizeInput("https://pds.example.com/xrpc/_health"), .host("pds.example.com"))
        XCTAssertEqual(RelayCheck.normalizeInput("http://pds.example.com:2583"), .host("pds.example.com:2583"))
        XCTAssertEqual(RelayCheck.normalizeInput("@alice.example.com"), .account("alice.example.com"))
        XCTAssertEqual(RelayCheck.normalizeInput("at://alice.example.com/app.bsky.feed.post/abc"), .account("alice.example.com"))
        XCTAssertEqual(RelayCheck.normalizeInput(did), .account(did))
        XCTAssertEqual(RelayCheck.normalizeInput("at://\(did)"), .account(did))
        XCTAssertFalse(RelayCheck.normalizeInput("").isValid)
        XCTAssertFalse(RelayCheck.normalizeInput("localhost").isValid)
        XCTAssertFalse(RelayCheck.normalizeInput("not a host").isValid)
        XCTAssertFalse(RelayCheck.normalizeInput("did:key:z6Mk").isValid)
        XCTAssertEqual(RelayCheck.normalizeInput("").reason, "Enter a PDS hostname.")
        XCTAssertEqual(
            RelayCheck.normalizeInput("did:key:z6Mk").reason,
            "That DID could not be read. Only did:plc and did:web have a PDS to look up."
        )
        XCTAssertNil(RelayCheck.normalizeInput("pds.example.com").reason)
        XCTAssertEqual(RelayCheck.normalizeInput("pds.example.com.").key, "either:pds.example.com")
    }

    func testHostOfEndpointReadsTheHostOutOfAPDSEndpoint() {
        XCTAssertEqual(RelayCheck.hostOfEndpoint("https://PDS.example.com/"), "pds.example.com")
        XCTAssertEqual(RelayCheck.hostOfEndpoint("https://pds.example.com:443"), "pds.example.com")
        XCTAssertNil(RelayCheck.hostOfEndpoint("nonsense"))
    }

    // MARK: Answers

    func testReadHostStatusReadsAKnownHostAnUnknownOneAndAFailureApart() {
        XCTAssertEqual(
            RelayCheck.readHostStatus(httpStatus: 200, body: ["hostname": .string(host), "status": "active", "accountCount": 12, "seq": 3400]),
            active
        )
        // Only hostname is required of the response.
        XCTAssertEqual(
            RelayCheck.readHostStatus(httpStatus: 200, body: ["hostname": .string(host)]),
            .known(status: nil, accountCount: nil, seq: nil)
        )
        // -1 is the reference relay's "no cursor recorded yet".
        XCTAssertEqual(
            RelayCheck.readHostStatus(httpStatus: 200, body: ["hostname": .string(host), "seq": -1]),
            .known(status: nil, accountCount: nil, seq: nil)
        )
        XCTAssertEqual(
            RelayCheck.readHostStatus(httpStatus: 404, body: ["error": "HostNotFound", "message": "host not found"]),
            unknown
        )
        XCTAssertEqual(RelayCheck.readHostStatus(httpStatus: 500, body: nil), .error("HTTP 500"))
        XCTAssertEqual(RelayCheck.readHostStatus(httpStatus: 400, body: ["error": "InvalidRequest"]), .error("InvalidRequest (HTTP 400)"))
        // A 200 that is not a host status is not a known host.
        XCTAssertTrue(RelayCheck.readHostStatus(httpStatus: 200, body: [:]).isError)
    }

    func testReadStatusCoversEveryStatusTheLexiconNames() {
        XCTAssertEqual(RelayCheck.readStatus("active").tone, .pass)
        XCTAssertTrue(RelayCheck.readStatus("idle").recrawl)
        XCTAssertEqual(RelayCheck.readStatus("offline").tone, .fail)
        XCTAssertTrue(RelayCheck.readStatus("offline").recrawl)
        XCTAssertEqual(RelayCheck.readStatus("throttled").tone, .warn)
        XCTAssertEqual(RelayCheck.readStatus("banned").tone, .fail)
        XCTAssertFalse(RelayCheck.readStatus("banned").recrawl)
        XCTAssertEqual(RelayCheck.readStatus(nil).label, "Known")
        XCTAssertEqual(RelayCheck.readStatus("quarantined").label, "quarantined")
    }

    // MARK: The verdict

    func testTheVerdictIsPendingUntilEveryRelayHasAnswered() {
        XCTAssertEqual(RelayCheck.verdict(host: host, results: results(active, nil), pds: .init(reachable: true)).tone, .pending)
    }

    func testEveryRelayActiveIsAPass() {
        let verdict = RelayCheck.verdict(host: host, results: results(active, active, active), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .pass)
        XCTAssertTrue(verdict.title.contains("all 3 relays"))
        XCTAssertFalse(verdict.explainCrawl)
    }

    func testARelayThatDidNotAnswerIsLeftOutOfTheCountAndSaidSo() {
        let verdict = RelayCheck.verdict(host: host, results: results(active, active, silent), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .pass)
        XCTAssertTrue(verdict.title.contains("all 2 relays"))
        XCTAssertTrue(verdict.text.contains("One relay did not answer"))
    }

    func testSomeRelaysActiveIsAWarningThatExplainsHowToReachTheRest() {
        let verdict = RelayCheck.verdict(host: host, results: results(active, unknown, active, unknown), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .warn)
        XCTAssertTrue(verdict.title.contains("2 of 4"))
        XCTAssertTrue(verdict.explainCrawl)
    }

    func testNoRelayKnowingALivePDSFailsAndExplainsTheCrawlRequest() {
        let verdict = RelayCheck.verdict(host: host, results: results(unknown, unknown), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.title.contains("No relay knows"))
        XCTAssertTrue(verdict.explainCrawl)
    }

    func testNoRelayKnowingAHostThatIsNotAPDSPointsAtTheHostname() {
        let verdict = RelayCheck.verdict(host: host, results: results(unknown, unknown), pds: .init(reachable: false))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.text.contains("check the hostname"))
        XCTAssertFalse(verdict.explainCrawl)
    }

    func testRelaysThatKnowTheHostButDroppedItFailWithTheWayBack() {
        let verdict = RelayCheck.verdict(host: host, results: results(offline, offline), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.title.contains("none is reading it"))
        XCTAssertTrue(verdict.explainCrawl)
    }

    func testABanIsNotSomethingACrawlRequestFixes() {
        let banned: RelayCheck.Answer = .known(status: "banned", accountCount: 0, seq: nil)
        let verdict = RelayCheck.verdict(host: host, results: results(banned, banned), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.text.contains("operator"))
        XCTAssertFalse(verdict.explainCrawl)
    }

    func testNoRelayAnsweringAtAllSaysNothingAboutTheHost() {
        let verdict = RelayCheck.verdict(host: host, results: results(silent, silent), pds: .init(reachable: true))
        XCTAssertEqual(verdict.tone, .warn)
        XCTAssertTrue(verdict.title.contains("None of the relays answered"))
    }

    func testRequestCrawlCommandNamesTheRelayAndTheHost() {
        let command = RelayCheck.requestCrawlCommand(relayHost: "relay.example.net", host: host)
        XCTAssertTrue(command.contains("https://relay.example.net/xrpc/com.atproto.sync.requestCrawl"))
        XCTAssertTrue(command.contains(#"{"hostname":"pds.example.com"}"#))
        XCTAssertEqual(command.components(separatedBy: "\n").count, 3)
    }

    func testTheCrawlRequestGoesToTheFirstRelayThatDoesNotKnowTheHost() {
        XCTAssertEqual(RelayCheck.crawlRelay(results(active, unknown, unknown))?.host, RelayCheck.relays[1].host)
        XCTAssertEqual(RelayCheck.crawlRelay(results(active, active))?.host, RelayCheck.relays[0].host)
        XCTAssertEqual(RelayCheck.crawlRelay([])?.host, RelayCheck.relays[0].host)
    }

    // MARK: Rows

    func testARowReadsEachKindOfAnswer() {
        let pending = RelayCheck.readRow(nil)
        XCTAssertEqual(pending.mark, .pending)
        XCTAssertEqual(pending.pill, "Asking")
        XCTAssertTrue(pending.figures.isEmpty)

        let failed = RelayCheck.readRow(.error("no answer"))
        XCTAssertEqual(failed.mark, .skip)
        XCTAssertEqual(failed.pill, "No answer")
        XCTAssertEqual(failed.meaning, "Did not answer (no answer). That says nothing about the host.")

        let notKnown = RelayCheck.readRow(.unknown)
        XCTAssertEqual(notKnown.mark, .fail)
        XCTAssertEqual(notKnown.pillTone, .outline)
        XCTAssertEqual(notKnown.pill, "Not known")

        let crawling = RelayCheck.readRow(.known(status: "active", accountCount: 12_345, seq: 3_400_000))
        XCTAssertEqual(crawling.mark, .pass)
        XCTAssertEqual(crawling.pill, "Active")
        XCTAssertEqual(crawling.figures, ["12,345 accounts", "seq 3,400,000"])

        let one = RelayCheck.readRow(.known(status: "idle", accountCount: 1, seq: nil))
        XCTAssertEqual(one.mark, .warn)
        XCTAssertEqual(one.accounts, "1 account")
        XCTAssertEqual(one.sequence, "no events read yet")

        let bare = RelayCheck.readRow(.known(status: nil, accountCount: nil, seq: 7))
        XCTAssertEqual(bare.pill, "Known")
        XCTAssertEqual(bare.figures, ["seq 7"])
    }

    func testTheRelaysAccountCountIsTheMostAnyCountsAndNoneForZero() {
        let low: RelayCheck.Answer = .known(status: "active", accountCount: 10, seq: 1)
        let high: RelayCheck.Answer = .known(status: "active", accountCount: 40, seq: 1)
        XCTAssertEqual(RelayCheck.accountCount(results(low, high, unknown)), 40)
        XCTAssertNil(RelayCheck.accountCount(results(unknown, silent, nil)))
        XCTAssertNil(RelayCheck.accountCount(results(offline, offline)), "an entryway's zero says nothing")
    }

    // MARK: Asking

    private func client(_ transport: RelayRoutedTransport, timeout: TimeInterval = 2) -> RelayCheckClient {
        RelayCheckClient(http: HTTPClient(transport: transport), timeout: timeout)
    }

    private let relay = RelayCheck.Relay(host: "relay-a.test", operatorName: "Test", region: "Here")

    func testAskingARelayReadsEveryStatusAsAnAnswer() async {
        let known = RelayRoutedTransport([
            ("relay-a.test/xrpc/com.atproto.sync.getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com","status":"active","accountCount":12,"seq":3400}"#)),
        ])
        let answer = await client(known).ask(relay, about: host)
        XCTAssertEqual(answer, active)
        XCTAssertEqual(known.urls, ["https://relay-a.test/xrpc/com.atproto.sync.getHostStatus?hostname=pds.example.com"])

        let notFound = RelayRoutedTransport([
            ("getHostStatus", .init(status: 404, body: #"{"error":"HostNotFound","message":"host not found"}"#)),
        ])
        let missing = await client(notFound).ask(relay, about: host)
        XCTAssertEqual(missing, .unknown)

        let broken = RelayRoutedTransport([("getHostStatus", .init(status: 502, body: "bad gateway"))])
        let failure = await client(broken).ask(relay, about: host)
        XCTAssertEqual(failure, .error("HTTP 502"))
    }

    func testARelayThatDoesNotAnswerInTimeIsNoAnswer() async {
        let slow = RelayRoutedTransport([
            ("getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com"}"#, delayNanoseconds: 2_000_000_000)),
        ])
        let started = Date()
        let answer = await client(slow, timeout: 0.05).ask(relay, about: host)
        XCTAssertEqual(answer, .error("no answer"))
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.5)

        let dropped = RelayRoutedTransport([("getHostStatus", .init(status: 200, body: "", fails: true))])
        let lost = await client(dropped).ask(relay, about: host)
        XCTAssertEqual(lost, .error("no answer"))
    }

    func testProbingAHostAsksDescribeServerAndHealth() async {
        let up = RelayRoutedTransport([
            ("pds.example.com/xrpc/com.atproto.server.describeServer", .init(status: 200, body: #"{"did":"did:web:pds.example.com"}"#)),
            ("pds.example.com/xrpc/_health", .init(status: 200, body: #"{"version":"0.4.1"}"#)),
        ])
        let probe = await client(up).probe(host)
        XCTAssertEqual(probe, RelayCheck.Probe(reachable: true, did: "did:web:pds.example.com", version: "0.4.1"))

        let down = RelayRoutedTransport([])
        let missing = await client(down).probe(host)
        XCTAssertEqual(missing, RelayCheck.Probe(reachable: false))
    }

    // MARK: The model

    private let testRelays = [
        RelayCheck.Relay(host: "relay-a.test", operatorName: "Test", region: "A"),
        RelayCheck.Relay(host: "relay-b.test", operatorName: "Test", region: "B"),
    ]

    @MainActor
    private func model(_ transport: RelayRoutedTransport) -> RelayCheckModel {
        RelayCheckModel(http: HTTPClient(transport: transport), relays: testRelays, timeout: 2)
    }

    private func serverRoutes(_ host: String) -> [(String, RelayRoutedTransport.Reply)] {
        [
            ("\(host)/xrpc/com.atproto.server.describeServer", .init(status: 200, body: #"{"did":"did:web:\#(host)"}"#)),
            ("\(host)/xrpc/_health", .init(status: 200, body: #"{"version":"0.4.1"}"#)),
        ]
    }

    @MainActor
    func testAHostIsAskedOfEveryRelayAndForItself() async {
        var routes = serverRoutes(host)
        routes.append(("relay-a.test/xrpc/com.atproto.sync.getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com","status":"active","accountCount":12,"seq":3400}"#)))
        routes.append(("relay-b.test/xrpc/com.atproto.sync.getHostStatus", .init(status: 404, body: #"{"error":"HostNotFound"}"#)))
        let transport = RelayRoutedTransport(routes)
        let check = model(transport)
        XCTAssertTrue(check.showsIntro)
        XCTAssertNil(check.verdict)

        let run = check.run("https://pds.example.com/")
        XCTAssertNotNil(run)
        XCTAssertTrue(check.isResolving)
        XCTAssertEqual(check.shareQuery, ["host": "https://pds.example.com/"])
        await check.finish()

        XCTAssertEqual(check.target?.host, host)
        XCTAssertNil(check.target?.account)
        XCTAssertEqual(check.target?.pds, RelayCheck.Probe(reachable: true, did: "did:web:pds.example.com", version: "0.4.1"))
        XCTAssertFalse(check.isBusy)
        XCTAssertEqual(check.relays.hostname, host)
        XCTAssertEqual(check.relays.results.map(\.answer), [active, .unknown])
        XCTAssertEqual(check.verdict?.tone, .warn)
        XCTAssertEqual(check.verdict?.title, "pds.example.com is being crawled by 1 of 2 relays")
        XCTAssertEqual(check.verdict?.explainCrawl, true)
        XCTAssertEqual(check.crawlRelay?.host, "relay-b.test")
        XCTAssertTrue(check.crawlCommand?.contains("https://relay-b.test/xrpc/com.atproto.sync.requestCrawl") ?? false)
        XCTAssertEqual(transport.count(containing: "getHostStatus"), 2)
        XCTAssertEqual(transport.count(containing: "resolveMiniDoc"), 0, "a URL is a host, not an account")
    }

    @MainActor
    func testAnAccountIsLookedUpForItsPDS() async {
        var routes = serverRoutes(host)
        routes.append(("resolveMiniDoc?identifier=alice.example.com", .init(status: 200, body: #"{"did":"\#(did)","handle":"alice.example.com","pds":"https://PDS.example.com"}"#)))
        routes.append(("getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com","status":"active"}"#)))
        let transport = RelayRoutedTransport(routes)
        let check = model(transport)
        check.run("@alice.example.com")
        await check.finish()

        XCTAssertEqual(check.target?.host, host)
        XCTAssertEqual(check.target?.account, RelayCheckModel.Account(did: did, handle: "alice.example.com"))
        XCTAssertEqual(check.target?.account?.label, "@alice.example.com")
        XCTAssertEqual(check.target?.pds?.reachable, true)
        XCTAssertEqual(check.verdict?.tone, .pass)
        XCTAssertEqual(check.verdict?.title, "pds.example.com is being crawled by all 2 relays")
        XCTAssertTrue(transport.urls.contains { $0.contains("getHostStatus?hostname=pds.example.com") })
    }

    @MainActor
    func testABareDomainThatIsNotAPDSButIsAHandleUsesTheAccountsPDS() async {
        var routes = serverRoutes(host)
        routes.append(("resolveMiniDoc?identifier=alice.example.com", .init(status: 200, body: #"{"did":"\#(did)","handle":"alice.example.com","pds":"https://pds.example.com"}"#)))
        routes.append(("getHostStatus", .init(status: 404, body: #"{"error":"HostNotFound"}"#)))
        let transport = RelayRoutedTransport(routes)
        let check = model(transport)
        check.run("alice.example.com")
        await check.finish()

        XCTAssertEqual(check.target?.host, host)
        XCTAssertEqual(check.target?.account?.did, did)
        XCTAssertEqual(check.verdict?.tone, .fail)
        XCTAssertEqual(check.verdict?.explainCrawl, true)
        XCTAssertEqual(transport.count(containing: "getHostStatus?hostname=alice.example.com"), 0)
    }

    @MainActor
    func testABareDomainThatAnswersAsAPDSIsTheHost() async {
        var routes = serverRoutes(host)
        routes.append(("getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com","status":"offline"}"#)))
        let transport = RelayRoutedTransport(routes)
        let check = model(transport)
        check.run("pds.example.com")
        await check.finish()

        XCTAssertEqual(check.target?.host, host)
        XCTAssertNil(check.target?.account)
        XCTAssertEqual(check.verdict?.tone, .fail)
        XCTAssertEqual(check.verdict?.title, "Relays know pds.example.com, but none is reading it")
    }

    @MainActor
    func testADomainThatIsNeitherIsStillTakenAsAHost() async {
        let transport = RelayRoutedTransport([])
        let check = model(transport)
        check.run("down.example.com")
        await check.finish()

        XCTAssertEqual(check.target?.host, "down.example.com")
        XCTAssertEqual(check.target?.pds?.reachable, false)
        XCTAssertNil(check.error)
        XCTAssertEqual(check.verdict?.tone, .warn, "no relay answered either")
    }

    @MainActor
    func testAnAccountThatDoesNotResolveIsAnError() async {
        let transport = RelayRoutedTransport([])
        let check = model(transport)
        check.run("@nobody.example.com")
        await check.finish()

        XCTAssertNil(check.target)
        XCTAssertEqual(check.error, "nobody.example.com could not be resolved to an account with a PDS.")
        XCTAssertFalse(check.isBusy)
        XCTAssertEqual(transport.count(containing: "getHostStatus"), 0)
    }

    @MainActor
    func testAnInputThatCannotBeReadRunsNothing() async {
        let transport = RelayRoutedTransport([])
        let check = model(transport)
        XCTAssertNil(check.run("not a host"))
        XCTAssertEqual(
            check.invalidReason,
            "Enter a PDS hostname such as pds.example.com, or a handle or DID to look up its PDS."
        )
        XCTAssertEqual(check.shareQuery, [:])
        XCTAssertFalse(check.showsIntro)
        XCTAssertNil(check.run("   "))
        XCTAssertTrue(check.showsIntro)
        XCTAssertNil(check.invalidReason)
        XCTAssertTrue(transport.urls.isEmpty)
    }

    @MainActor
    func testAskingAgainAsksTheSameHost() async {
        var routes = serverRoutes(host)
        routes.append(("getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example.com","status":"active"}"#)))
        let transport = RelayRoutedTransport(routes)
        let check = model(transport)
        check.run(host)
        await check.finish()
        XCTAssertEqual(transport.count(containing: "getHostStatus"), 2)

        let again = check.relays.rerun()
        XCTAssertTrue(check.relays.isLoading)
        XCTAssertEqual(check.verdict?.tone, .pending)
        await again?.value
        XCTAssertEqual(transport.count(containing: "getHostStatus"), 4)
        XCTAssertEqual(check.verdict?.tone, .pass)
    }
}
