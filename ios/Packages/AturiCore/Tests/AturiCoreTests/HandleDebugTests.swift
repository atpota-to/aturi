import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: the first route whose fragment appears in
/// the URL answers, the rest 404. Records every request, headers included,
/// so a test can see what was asked.
private final class HandleDebugFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = ["Content-Type": "application/json"]
    }

    private let lock = NSLock()
    private let routes: [(fragment: String, reply: Reply)]
    private var recorded: [URLRequest] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (fragment: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = route(request)
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (Data(reply.body.utf8), response)
    }

    private func route(_ request: URLRequest) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(request)
        let url = request.url?.absoluteString ?? ""
        return routes.first { url.contains($0.fragment) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
}

private let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
private let other = "did:plc:oky5czdrnfjpqslsw2a5iclo"
private let handle = "alice.example.com"

/// Port of src/lib/tools/__tests__/handle.test.ts.
final class HandleDebugTests: XCTestCase {
    private func probe(records: [String] = [], httpStatus: Int = 404, body: String = "", httpError: String? = nil) -> HandleDebug.Probe {
        let dns = TxtProbe(name: "_atproto.\(handle)", status: records.isEmpty ? .none : .found, records: records)
        let url = "https://\(handle)/.well-known/atproto-did"
        let http: HandleDebug.HTTPProbe
        if let httpError {
            http = HandleDebug.HTTPProbe(url: url, status: .error, error: httpError)
        } else {
            http = HandleDebug.HTTPProbe(url: url, status: .answered, httpStatus: httpStatus, body: body)
        }
        return HandleDebug.Probe(handle: handle, dns: dns, http: http)
    }

    private func statusOf(_ evidence: HandleDebug.Evidence, _ id: HandleDebug.CheckID) -> HandleDebug.CheckStatus? {
        HandleDebug.buildChecks(evidence).first { $0.id == id }?.status
    }

    private func document(aka: [String], pds: String? = nil, type: String = "AtprotoPersonalDataServer") -> DIDDocument {
        let services = pds.map { [DIDDocument.Service(id: "#atproto_pds", type: type, serviceEndpoint: $0)] } ?? []
        return DIDDocument(id: did, alsoKnownAs: aka, service: services)
    }

    func testNormalizeInputTidiesWhatPeoplePaste() {
        XCTAssertEqual(HandleDebug.normalizeInput(" @Alice.Example.com "), .valid("alice.example.com"))
        XCTAssertEqual(HandleDebug.normalizeInput("at://alice.example.com"), .valid("alice.example.com"))
        XCTAssertEqual(HandleDebug.normalizeInput("https://alice.example.com/profile"), .valid("alice.example.com"))
        XCTAssertEqual(HandleDebug.normalizeInput("alice.example.com."), .valid("alice.example.com"))
        XCTAssertNil(HandleDebug.normalizeInput("did:plc:abc").handle)
        XCTAssertNil(HandleDebug.normalizeInput("").handle)
        XCTAssertEqual(HandleDebug.normalizeInput(""), .invalid("Enter a handle."))
    }

    func testSyntaxProblemFollowsTheHandleSpec() {
        XCTAssertNil(HandleDebug.syntaxProblem("alice.example.com"))
        XCTAssertNil(HandleDebug.syntaxProblem("xn--ls8h.test-1.io"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("alice"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("alice..com"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("-alice.com"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("alice_b.com"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("alice.123"))
        XCTAssertNotNil(HandleDebug.syntaxProblem("alice.local"))
        XCTAssertNotNil(HandleDebug.syntaxProblem(String(repeating: "a", count: 64) + ".com"))
    }

    func testIsDidTakesPlcAndWebOnly() {
        XCTAssertTrue(HandleDebug.isDid(did))
        XCTAssertTrue(HandleDebug.isDid("did:web:example.com"))
        XCTAssertFalse(HandleDebug.isDid("did:plc:short"))
        XCTAssertFalse(HandleDebug.isDid("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"))
        XCTAssertFalse(HandleDebug.isDid(did + "\n"))
    }

    func testReadDNSRecordsAcceptsOneClaimAndExplainsTheRest() {
        XCTAssertEqual(HandleDebug.readDNSRecords(["did=\(did)"]).did, did)
        XCTAssertEqual(HandleDebug.readDNSRecords(["v=spf1 -all", "did=\(did)"]).did, did)
        XCTAssertTrue(HandleDebug.readDNSRecords([]).absent)
        XCTAssertNil(HandleDebug.readDNSRecords([]).problem)
        // Other TXT values at the name, but nothing that reads as a claim.
        XCTAssertNotNil(HandleDebug.readDNSRecords(["hello"]).problem)
        XCTAssertTrue(HandleDebug.readDNSRecords(["hello"]).absent)
        XCTAssertTrue((HandleDebug.readDNSRecords(["did=\(did)", "did=\(other)"]).problem ?? "").contains("More than one"))
        XCTAssertTrue((HandleDebug.readDNSRecords(["did = \(did)"]).problem ?? "").contains("exactly"))
        XCTAssertTrue((HandleDebug.readDNSRecords(["did=alice.example.com"]).problem ?? "").contains("not a valid"))
    }

    func testReadWellKnownTellsAMissingFileFromAWrongOne() {
        XCTAssertEqual(HandleDebug.readWellKnown(probe(httpStatus: 200, body: "\(did)\n").http).did, did)
        XCTAssertTrue(HandleDebug.readWellKnown(probe(httpStatus: 404).http).absent)
        XCTAssertTrue(HandleDebug.readWellKnown(probe(httpError: "timed out").http).absent)
        XCTAssertTrue((HandleDebug.readWellKnown(probe(httpStatus: 200, body: "<!doctype html><html>").http).problem ?? "").contains("web page"))
        XCTAssertTrue((HandleDebug.readWellKnown(probe(httpStatus: 200, body: "did=\(did)").http).problem ?? "").contains("only the DID"))
        XCTAssertTrue((HandleDebug.readWellKnown(probe(httpStatus: 500).http).problem ?? "").contains("HTTP 500"))
    }

    func testAHandleThatResolvesAndIsClaimedBackPasses() {
        let evidence = HandleDebug.Evidence(
            handle: handle,
            probe: .done(probe(records: ["did=\(did)"])),
            document: .done(document(aka: ["at://alice.example.com"], pds: "https://pds.example.com")),
            pds: .done(HandleDebug.PDSState(endpoint: "https://pds.example.com", reachable: true, handle: handle, handleIsCorrect: true, active: true)),
            appview: .done(HandleDebug.AppViewState(handle: handle))
        )
        let checks = HandleDebug.buildChecks(evidence)
        XCTAssertEqual(checks.map { "\($0.id.rawValue):\($0.status.rawValue)" }, [
            "dns:pass",
            // No file is fine when the record answers.
            "http:info",
            "document:pass",
            "claim:pass",
            "pds:pass",
            "appview:pass",
        ])
        XCTAssertEqual(HandleDebug.verdict(evidence, checks: checks).tone, .pass)
        XCTAssertEqual(checks.first { $0.id == .document }?.summary, "Resolved. The account's PDS is pds.example.com.")
    }

    func testADomainThatPointsAtADidWhichDoesNotClaimItFails() {
        let evidence = HandleDebug.Evidence(
            handle: handle,
            probe: .done(probe(records: ["did=\(did)"])),
            document: .done(document(aka: ["at://alice.bsky.social"])),
            appview: .done(HandleDebug.AppViewState(handle: "alice.bsky.social"))
        )
        let checks = HandleDebug.buildChecks(evidence)
        XCTAssertEqual(statusOf(evidence, .claim), .fail)
        let verdict = HandleDebug.verdict(evidence, checks: checks)
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertEqual(verdict.did, did)
    }

    func testNeitherMethodSetUpFailsBothAndSkipsTheRest() {
        let evidence = HandleDebug.Evidence(handle: handle, probe: .done(probe()))
        let checks = HandleDebug.buildChecks(evidence)
        XCTAssertEqual(statusOf(evidence, .dns), .fail)
        XCTAssertEqual(statusOf(evidence, .http), .fail)
        XCTAssertEqual(statusOf(evidence, .claim), .skip)
        XCTAssertEqual(HandleDebug.verdict(evidence, checks: checks).tone, .fail)
    }

    func testTheTwoMethodsDisagreeingIsAWarningAndDNSWins() {
        let evidence = HandleDebug.Evidence(
            handle: handle,
            probe: .done(probe(records: ["did=\(did)"], httpStatus: 200, body: other)),
            document: .done(document(aka: ["at://alice.example.com"])),
            appview: .done(HandleDebug.AppViewState(handle: handle))
        )
        let checks = HandleDebug.buildChecks(evidence)
        XCTAssertEqual(statusOf(evidence, .agree), .warn)
        XCTAssertEqual(HandleDebug.verdict(evidence, checks: checks).did, did)
    }

    func testABrokenWellKnownFileBesideAWorkingRecordIsAWarningNotAFailure() {
        let evidence = HandleDebug.Evidence(
            handle: handle,
            probe: .done(probe(records: ["did=\(did)"], httpStatus: 200, body: "<html>site</html>"))
        )
        XCTAssertEqual(statusOf(evidence, .http), .warn)
    }

    func testStepsNotYetObservedArePendingAndSoIsTheVerdict() {
        let waiting = HandleDebug.Evidence(handle: handle)
        XCTAssertTrue(HandleDebug.buildChecks(waiting).allSatisfy { $0.status == .pending })
        let partial = HandleDebug.Evidence(handle: handle, probe: .done(probe(records: ["did=\(did)"])))
        let checks = HandleDebug.buildChecks(partial)
        XCTAssertEqual(statusOf(partial, .dns), .pass)
        XCTAssertEqual(statusOf(partial, .document), .pending)
        XCTAssertEqual(HandleDebug.verdict(partial, checks: checks).tone, .pending)
    }

    func testHandleInvalidOnTheAppViewIsALagWhenEverythingElseAgrees() {
        let evidence = HandleDebug.Evidence(
            handle: handle,
            probe: .done(probe(records: ["did=\(did)"])),
            document: .done(document(aka: ["at://alice.example.com"], pds: "https://pds.example.com", type: "")),
            pds: .done(HandleDebug.PDSState(endpoint: "https://pds.example.com", reachable: true, handleIsCorrect: true, active: true)),
            appview: .done(HandleDebug.AppViewState(handle: "handle.invalid"))
        )
        XCTAssertEqual(statusOf(evidence, .appview), .warn)
        XCTAssertEqual(HandleDebug.verdict(evidence, checks: HandleDebug.buildChecks(evidence)).tone, .warn)
    }

    func testADocumentThatCouldNotBeReadSaysWhy() {
        let evidence = HandleDebug.Evidence(handle: handle, probe: .done(probe(records: ["did=\(did)"])), document: .failed("HTTP 404"))
        let checks = HandleDebug.buildChecks(evidence)
        XCTAssertEqual(checks.first { $0.id == .document }?.summary, "\(did) could not be resolved: HTTP 404")
        XCTAssertEqual(statusOf(evidence, .claim), .skip)
        XCTAssertEqual(HandleDebug.verdict(evidence, checks: checks).title, "alice.example.com names a DID that cannot be resolved")
    }

    // MARK: src/lib/tools/didDocument.ts

    func testTheServiceEndpointIsFoundByFragmentWithoutItsTrailingSlash() {
        let doc = DIDDocument(id: did, service: [
            DIDDocument.Service(id: "#bsky_appview", type: "BskyAppView", serviceEndpoint: "https://api.example.com"),
            DIDDocument.Service(id: "\(did)#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com/"),
        ])
        XCTAssertEqual(HandleDebug.serviceEndpoint(doc, fragment: "#atproto_pds"), "https://pds.example.com")
        XCTAssertEqual(HandleDebug.pdsEndpoint(doc), "https://pds.example.com/")
        XCTAssertNil(HandleDebug.serviceEndpoint(doc, fragment: "#atproto_labeler"))
        XCTAssertNil(HandleDebug.serviceEndpoint(nil, fragment: "#atproto_pds"))
        XCTAssertEqual(HandleDebug.handles(fromAlsoKnownAs: ["https://example.com", "AT://Alice.Example.com"]), ["alice.example.com"])
    }
}

/// The lookups the web makes on its server, made on the device.
final class HandleDebugClientTests: XCTestCase {
    private static let wellKnown = "https://alice.example.com/.well-known/atproto-did"

    func testTheWellKnownFileFollowsHttpsRedirectsAndSaysWhereItEnded() async {
        let transport = HandleDebugFakeTransport([
            (Self.wellKnown, .init(status: 301, body: "", headers: ["Location": "https://www.alice.example.com/.well-known/atproto-did"])),
            ("https://www.alice.example.com/", .init(status: 200, body: "\(did)\n", headers: ["Content-Type": "text/plain"])),
        ])
        let probe = await HandleDebugClient(http: HTTPClient(transport: transport)).readWellKnown(handle)
        XCTAssertEqual(probe.status, .answered)
        XCTAssertEqual(probe.httpStatus, 200)
        XCTAssertEqual(probe.body, did)
        XCTAssertEqual(probe.contentType, "text/plain")
        XCTAssertEqual(probe.url, Self.wellKnown)
        XCTAssertEqual(probe.finalUrl, "https://www.alice.example.com/.well-known/atproto-did")
        XCTAssertEqual(HandleDebug.readWellKnown(probe).did, did)
        // Every hop is looked at before it is followed.
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.requests.first?.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1")
    }

    func testARedirectAwayFromHttpsIsNotFollowed() async {
        let transport = HandleDebugFakeTransport([
            (Self.wellKnown, .init(status: 302, body: "", headers: ["Location": "http://alice.example.com/did.txt"])),
        ])
        let probe = await HandleDebugClient(http: HTTPClient(transport: transport)).readWellKnown(handle)
        XCTAssertEqual(probe.status, .error)
        XCTAssertEqual(probe.error, "the address redirects to a URL that is not https")
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testARedirectLoopStopsAfterThreeHops() async {
        let transport = HandleDebugFakeTransport([
            (Self.wellKnown, .init(status: 307, body: "", headers: ["Location": Self.wellKnown])),
        ])
        let probe = await HandleDebugClient(http: HTTPClient(transport: transport)).readWellKnown(handle)
        XCTAssertEqual(probe.error, "the address redirects too many times")
        XCTAssertEqual(transport.requests.count, HandleDebugClient.maxRedirects + 1)
    }

    func testAMissingFileIsAnAnswerNotAnError() async {
        let transport = HandleDebugFakeTransport([
            (Self.wellKnown, .init(status: 404, body: "Not Found", headers: ["Content-Type": "text/html"])),
        ])
        let probe = await HandleDebugClient(http: HTTPClient(transport: transport)).readWellKnown(handle)
        XCTAssertEqual(probe.status, .answered)
        XCTAssertEqual(probe.httpStatus, 404)
        XCTAssertTrue(HandleDebug.readWellKnown(probe).absent)
    }

    func testTheProbeAsksDNSForTheAtprotoName() async {
        let transport = HandleDebugFakeTransport([
            ("dns.google/resolve", .init(status: 200, body: #"{"Status":0,"Answer":[{"type":16,"data":"\"did=\#(did)\""}]}"#)),
        ])
        let probe = await HandleDebugClient(http: HTTPClient(transport: transport)).probe(handle)
        XCTAssertEqual(probe.dns.name, "_atproto.alice.example.com")
        XCTAssertEqual(probe.dns.records, ["did=\(did)"])
        XCTAssertEqual(HandleDebug.resolvedDid(probe), did)
        XCTAssertTrue(transport.requests.contains { $0.url?.absoluteString == "https://dns.google/resolve?name=_atproto.alice.example.com&type=TXT" })
    }

    func testAnAppViewWithNoProfileSaysWhatItAnswered() async {
        let transport = HandleDebugFakeTransport([
            ("app.bsky.actor.getProfile", .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let state = await HandleDebugClient(http: HTTPClient(transport: transport)).appView(did)
        XCTAssertEqual(state, HandleDebug.AppViewState(handle: nil, error: "HTTP 400"))
    }
}

@MainActor
final class HandleDebugModelTests: XCTestCase {
    private nonisolated static func routes(appViewHandle: String = handle) -> [(String, HandleDebugFakeTransport.Reply)] {
        [
            ("dns.google/resolve", .init(status: 200, body: #"{"Status":0,"Answer":[{"type":16,"data":"\"did=\#(did)\""}]}"#)),
            ("/.well-known/atproto-did", .init(status: 404, body: "Not Found", headers: ["Content-Type": "text/plain"])),
            // Two hashes: the service id's `"#` would end a one-hash raw string.
            ("plc.directory/", .init(status: 200, body: ##"{"id":"\##(did)","alsoKnownAs":["at://alice.example.com"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example.com"}]}"##)),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"handle":"alice.example.com","did":"\#(did)","collections":[],"handleIsCorrect":true}"#)),
            ("com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":true}"#)),
            ("app.bsky.actor.getProfile", .init(status: 200, body: #"{"did":"\#(did)","handle":"\#(appViewHandle)"}"#)),
        ]
    }

    func testAFullCheckFillsInEveryStepAndPasses() async {
        let transport = HandleDebugFakeTransport(Self.routes())
        let model = HandleDebugModel(http: HTTPClient(transport: transport))
        let run = model.check(" @Alice.Example.com ")
        XCTAssertNotNil(run)
        XCTAssertTrue(model.isRunning)
        XCTAssertEqual(model.verdict?.tone, .pending)
        await run?.value

        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(model.handle, "alice.example.com")
        XCTAssertEqual(model.checks.map(\.status), [.pass, .info, .pass, .pass, .pass, .pass])
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertEqual(model.verdict?.did, did)
        XCTAssertEqual(model.pdsEndpoint, "https://pds.example.com")
    }

    func testALaggingAppViewIsAWarning() async {
        let transport = HandleDebugFakeTransport(Self.routes(appViewHandle: "handle.invalid"))
        let model = HandleDebugModel(http: HTTPClient(transport: transport))
        await model.check(handle)?.value
        XCTAssertEqual(model.verdict?.tone, .warn)
        XCTAssertEqual(model.verdict?.title, "alice.example.com verifies, with one thing to look at")
    }

    func testRefusedInputMakesNoRequest() {
        let transport = HandleDebugFakeTransport([])
        let model = HandleDebugModel(http: HTTPClient(transport: transport))
        XCTAssertNil(model.check("did:plc:abc"))
        XCTAssertEqual(model.input?.reason, "That is a DID. Enter the handle you expect it to have.")
        XCTAssertNil(model.evidence)
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertNil(model.check("   "))
        XCTAssertNil(model.input)
    }

    func testANewCheckReplacesTheOneInFlight() async {
        let transport = HandleDebugFakeTransport(Self.routes())
        let model = HandleDebugModel(http: HTTPClient(transport: transport))
        let first = model.check("first.example.com")
        let second = model.check(handle)
        await first?.value
        await second?.value
        XCTAssertEqual(model.evidence?.handle, handle)
        XCTAssertEqual(model.verdict?.tone, .pass)
    }
}
