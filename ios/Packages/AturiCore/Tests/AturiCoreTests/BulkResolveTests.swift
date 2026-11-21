import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: the first route whose fragment appears in
/// the URL answers, the rest 404.
private final class BulkResolveFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let routes: [(fragment: String, status: Int, body: String)]
    private var recorded: [String] = []

    init(_ routes: [(String, Int, String)]) {
        self.routes = routes.map { (fragment: $0.0, status: $0.1, body: $0.2) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let (status, body) = route(url.absoluteString)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        return (Data(body.utf8), response)
    }

    private func route(_ url: String) -> (Int, String) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
        if let match = routes.first(where: { url.contains($0.fragment) }) {
            return (match.status, match.body)
        }
        return (404, #"{"error":"NotFound"}"#)
    }

    func count(containing fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.contains(fragment) }.count
    }
}

private let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
private let pds = "https://puffball.us-east.host.bsky.network"

private func handleEntry(_ value: String) -> BulkResolve.Entry {
    BulkResolve.Entry(input: value, kind: .handle, value: value)
}

private func didEntry(_ value: String) -> BulkResolve.Entry {
    BulkResolve.Entry(input: value, kind: .did, value: value)
}

/// Port of src/lib/tools/__tests__/resolve.test.ts.
final class BulkResolveTests: XCTestCase {
    func testReadIdentifierReadsEveryShapeAnAccountIsWrittenIn() {
        XCTAssertEqual(BulkResolve.readIdentifier("Alice.Example.com"), BulkResolve.Entry(input: "Alice.Example.com", kind: .handle, value: "alice.example.com"))
        XCTAssertEqual(BulkResolve.readIdentifier("@alice.example.com"), BulkResolve.Entry(input: "@alice.example.com", kind: .handle, value: "alice.example.com"))
        XCTAssertEqual(BulkResolve.readIdentifier(did), BulkResolve.Entry(input: did, kind: .did, value: did))
        XCTAssertEqual(BulkResolve.readIdentifier("at://\(did)/app.bsky.feed.post/3kabc").value, did)
        XCTAssertEqual(BulkResolve.readIdentifier("at://alice.example.com").value, "alice.example.com")
        XCTAssertEqual(BulkResolve.readIdentifier("https://bsky.app/profile/alice.example.com/post/3kabc").value, "alice.example.com")
        XCTAssertEqual(BulkResolve.readIdentifier("https://bsky.app/profile/\(did)").value, did)
        // A link that is not a profile names its own host.
        XCTAssertEqual(BulkResolve.readIdentifier("https://alice.example.com/about").value, "alice.example.com")
        XCTAssertEqual(BulkResolve.readIdentifier("did:web:example.com").kind, .did)
    }

    func testReadIdentifierShedsThePunctuationAListArrivesIn() {
        XCTAssertEqual(BulkResolve.readIdentifier("\"alice.example.com\"").value, "alice.example.com")
        XCTAssertEqual(BulkResolve.readIdentifier("(alice.example.com).").value, "alice.example.com")
        XCTAssertEqual(BulkResolve.readIdentifier("<@alice.example.com>").value, "alice.example.com")
    }

    func testReadIdentifierKeepsWhatItCannotReadWithAReason() {
        let word = BulkResolve.readIdentifier("alice")
        XCTAssertEqual(word.kind, .invalid)
        XCTAssertEqual(word.value, "alice")
        XCTAssertNotNil(word.reason)
        XCTAssertEqual(BulkResolve.readIdentifier("did:plc:short").kind, .invalid)
        XCTAssertEqual(BulkResolve.readIdentifier("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK").kind, .invalid)
        XCTAssertEqual(BulkResolve.readIdentifier("not_a_handle.com").kind, .invalid)
    }

    func testParseListSplitsOnLinesCommasAndSpacesAndKeepsTheOrder() {
        let list = BulkResolve.parseList("bsky.app, atproto.com\n\n\(did);  @jay.bsky.team\tpfrazee.com")
        XCTAssertEqual(list.entries.map(\.value), ["bsky.app", "atproto.com", did, "jay.bsky.team", "pfrazee.com"])
        XCTAssertEqual(list.duplicates, 0)
        XCTAssertEqual(list.dropped, 0)
    }

    func testParseListDropsRepeatsHoweverTheyAreSpelled() {
        let list = BulkResolve.parseList("bsky.app\n@BSKY.app\nhttps://bsky.app/profile/bsky.app\natproto.com")
        XCTAssertEqual(list.entries.map(\.value), ["bsky.app", "atproto.com"])
        // The first spelling is the one shown.
        XCTAssertEqual(list.entries.first?.input, "bsky.app")
        XCTAssertEqual(list.duplicates, 2)
    }

    func testParseListStopsAtTheCapAndCountsWhatItLeftOut() {
        let text = (0..<12).map { "user\($0).example.com" }.joined(separator: "\n")
        let list = BulkResolve.parseList(text, max: 10)
        XCTAssertEqual(list.entries.count, 10)
        XCTAssertEqual(list.dropped, 2)
        XCTAssertEqual(BulkResolve.parseList("   \n ,, ").entries, [])
    }

    func testListForQueryKeepsAShortListInTheLinkAndRefusesALongOne() {
        let entries = BulkResolve.parseList("@bsky.app\nnot_a_handle\ndid:plc:z72i7hdynmk6r22z27h6tvur").entries
        let query = BulkResolve.listForQuery(entries)
        XCTAssertEqual(query, "bsky.app,not_a_handle,\(did)")
        // And the link reads back to the same list.
        XCTAssertEqual(BulkResolve.parseList(query ?? "").entries.map(\.value), entries.map(\.value))

        let long = BulkResolve.parseList((0..<200).map { "user\($0).example.com" }.joined(separator: "\n")).entries
        XCTAssertGreaterThan(long.map(\.value).joined(separator: ",").count, BulkResolve.maxQueryLength)
        XCTAssertNil(BulkResolve.listForQuery(long))
    }

    func testAHandleThatResolvesAndIsClaimedBackIsResolvedWithNothingFlagged() {
        let row = BulkResolve.classifyRow(handleEntry("bsky.app"), outcome: BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds))
        XCTAssertEqual(row.state, .resolved)
        XCTAssertEqual(row.flags, [])
        XCTAssertEqual(BulkResolve.rowStatus(row), BulkResolve.RowStatus(tone: .pass, label: "Resolved"))
    }

    func testWhatIsOffAboutAResolvedRowIsFlagged() {
        let invalid = BulkResolve.classifyRow(didEntry(did), outcome: BulkResolve.Outcome(did: did, handle: "handle.invalid", pds: pds))
        XCTAssertEqual(invalid.flags, [.handleInvalid])
        // The placeholder is not a handle, so it is not shown as one.
        XCTAssertNil(invalid.handle)
        XCTAssertEqual(BulkResolve.rowStatus(invalid).label, "Handle not verified")

        let bare = BulkResolve.classifyRow(didEntry(did), outcome: BulkResolve.Outcome(did: did, handle: nil, pds: pds))
        XCTAssertEqual(bare.flags, [.noHandle])
        XCTAssertEqual(BulkResolve.rowStatus(bare).tone, .warn)

        let moved = BulkResolve.classifyRow(handleEntry("old.example.com"), outcome: BulkResolve.Outcome(did: did, handle: "New.example.com", pds: pds))
        XCTAssertEqual(moved.flags, [.handleDiffers])
        XCTAssertTrue(BulkResolve.rowStatus(moved).note?.contains("new.example.com") == true)

        let hostless = BulkResolve.classifyRow(handleEntry("bsky.app"), outcome: BulkResolve.Outcome(did: did, handle: "bsky.app", pds: nil))
        XCTAssertEqual(hostless.flags, [.noPds])
    }

    func testARowThatFoundNothingSaysWhichKindOfNothing() {
        XCTAssertEqual(BulkResolve.rowStatus(BulkResolve.classifyRow(handleEntry("nobody.example.com"), outcome: nil)).label, "Does not resolve")
        XCTAssertEqual(BulkResolve.rowStatus(BulkResolve.classifyRow(didEntry(did), outcome: nil)).label, "DID not found")
        let junk = BulkResolve.pendingRow(BulkResolve.readIdentifier("alice"))
        XCTAssertEqual(junk.state, .invalid)
        XCTAssertEqual(BulkResolve.rowStatus(junk).tone, .fail)
        XCTAssertEqual(BulkResolve.rowStatus(BulkResolve.pendingRow(handleEntry("bsky.app"))).label, "Resolving")
    }

    func testCountRowsTalliesATableInProgress() {
        let rows = [
            BulkResolve.classifyRow(handleEntry("bsky.app"), outcome: BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds)),
            BulkResolve.classifyRow(didEntry(did), outcome: BulkResolve.Outcome(did: did, handle: nil, pds: pds)),
            BulkResolve.classifyRow(handleEntry("nobody.example.com"), outcome: nil),
            BulkResolve.pendingRow(BulkResolve.readIdentifier("alice")),
            BulkResolve.pendingRow(handleEntry("atproto.com")),
        ]
        XCTAssertEqual(BulkResolve.countRows(rows), BulkResolve.Counts(total: 5, settled: 4, resolved: 2, failed: 2, flagged: 1))
    }

    func testPdsHostReadsTheHostOutOfAnEndpoint() {
        XCTAssertEqual(BulkResolve.pdsHost(pds), "puffball.us-east.host.bsky.network")
        XCTAssertEqual(BulkResolve.pdsHost("https://pds.example.com:2583/"), "pds.example.com:2583")
        XCTAssertNil(BulkResolve.pdsHost(nil))
    }

    func testRowsToCsvQuotesWhatNeedsItAndKeepsFormulasAsText() {
        let rows = [
            BulkResolve.classifyRow(
                BulkResolve.Entry(input: "@bsky.app", kind: .handle, value: "bsky.app"),
                outcome: BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds)
            ),
            BulkResolve.pendingRow(BulkResolve.Entry(input: "=cmd|\"x\",1", kind: .invalid, value: "=cmd|\"x\",1", reason: "no")),
        ]
        XCTAssertEqual(BulkResolve.rowsToCsv(rows), [
            "input,did,handle,pds,status",
            "'@bsky.app,\(did),bsky.app,\(pds),Resolved",
            #""'=cmd|""x"",1",,,,Not an identifier"#,
            "",
        ].joined(separator: "\r\n"))
    }

    func testRowsToJsonGivesTheSameColumns() throws {
        let rows = [BulkResolve.classifyRow(handleEntry("bsky.app"), outcome: BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds))]
        let json = BulkResolve.rowsToJson(rows)
        let parsed = try JSONValue.parse(Data(json.utf8))
        XCTAssertEqual(parsed, .array([.object([
            "input": "bsky.app",
            "did": .string(did),
            "handle": "bsky.app",
            "pds": .string(pds),
            "status": "Resolved",
        ])]))
        // Written as JSON.stringify(rows, null, 2) writes it, columns in order.
        XCTAssertEqual(json, """
        [
          {
            "input": "bsky.app",
            "did": "\(did)",
            "handle": "bsky.app",
            "pds": "\(pds)",
            "status": "Resolved"
          }
        ]
        """)
        let unresolved = BulkResolve.rowsToJson([BulkResolve.classifyRow(didEntry(did), outcome: nil)])
        XCTAssertTrue(unresolved.contains("\"handle\": null"))
        XCTAssertEqual(BulkResolve.rowsToJson([]), "[]")
    }
}

/// `resolveOne` against canned answers: Slingshot first, then the sources.
final class BulkResolveClientTests: XCTestCase {
    func testSlingshotAnswersFirst() async {
        let transport = BulkResolveFakeTransport([
            ("resolveMiniDoc?identifier=bsky.app", 200, #"{"did":"\#(did)","handle":"bsky.app","pds":"\#(pds)"}"#),
        ])
        let outcome = await BulkResolveClient(http: HTTPClient(transport: transport)).resolve(handleEntry("bsky.app"))
        XCTAssertEqual(outcome, BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds))
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0)
    }

    func testASlingshotMissIsPutToTheDIDDocument() async {
        let transport = BulkResolveFakeTransport([
            // Two hashes: the service id's `"#` would end a one-hash raw string.
            ("plc.directory/", 200, ##"{"id":"\##(did)","alsoKnownAs":["at://Bsky.App"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\##(pds)/"}]}"##),
        ])
        let outcome = await BulkResolveClient(http: HTTPClient(transport: transport)).resolve(didEntry(did))
        XCTAssertEqual(outcome, BulkResolve.Outcome(did: did, handle: "bsky.app", pds: pds))
    }

    func testAHandleNobodyResolvesIsNil() async {
        let transport = BulkResolveFakeTransport([])
        let outcome = await BulkResolveClient(http: HTTPClient(transport: transport)).resolve(handleEntry("nobody.example.com"))
        XCTAssertNil(outcome)
        // Slingshot, then the AppView and bsky.social.
        XCTAssertEqual(transport.count(containing: "resolveMiniDoc"), 1)
        XCTAssertEqual(transport.count(containing: "com.atproto.identity.resolveHandle"), 2)
    }

    func testAHandleWhoseDIDHasNoDocumentStillResolvedAsFarAsItGoes() async {
        let transport = BulkResolveFakeTransport([
            ("public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle", 200, #"{"did":"\#(did)"}"#),
        ])
        let outcome = await BulkResolveClient(http: HTTPClient(transport: transport)).resolve(handleEntry("ghost.example.com"))
        XCTAssertEqual(outcome, BulkResolve.Outcome(did: did))
    }
}

@MainActor
final class BulkResolveModelTests: XCTestCase {
    func testAListResolvesIntoATableInItsOrder() async {
        let transport = BulkResolveFakeTransport([
            ("resolveMiniDoc?identifier=bsky.app", 200, #"{"did":"\#(did)","handle":"bsky.app","pds":"\#(pds)"}"#),
        ])
        let model = BulkResolveModel(http: HTTPClient(transport: transport))
        let run = model.submit("@bsky.app, not_a_handle\nnobody.example.com\n@BSKY.app")
        XCTAssertNotNil(run)
        XCTAssertTrue(model.isRunning)
        XCTAssertEqual(model.rows.map(\.state), [.pending, .invalid, .pending])
        await run?.value

        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(model.rows.map(\.state), [.resolved, .invalid, .unresolved])
        XCTAssertEqual(model.list.duplicates, 1)
        XCTAssertEqual(model.counts, BulkResolve.Counts(total: 3, settled: 3, resolved: 1, failed: 2, flagged: 0))
        XCTAssertEqual(model.queryList, "bsky.app,not_a_handle,nobody.example.com")
        XCTAssertFalse(model.isTooLongToShare)
        XCTAssertEqual(model.editorText, "@bsky.app\nnot_a_handle\nnobody.example.com")
        XCTAssertTrue(model.csv.hasPrefix("input,did,handle,pds,status\r\n'@bsky.app,\(did),bsky.app,\(pds),Resolved\r\n"))
    }

    func testAListOfNothingButJunkMakesNoRequest() {
        let transport = BulkResolveFakeTransport([])
        let model = BulkResolveModel(http: HTTPClient(transport: transport))
        XCTAssertNil(model.submit("alice, bob"))
        XCTAssertEqual(model.rows.map(\.state), [.invalid, .invalid])
        XCTAssertEqual(transport.count(containing: "https://"), 0)
        XCTAssertNil(model.submit(""))
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNil(model.queryList)
    }

    func testALongListIsResolvedButNotKeptInTheLink() {
        let transport = BulkResolveFakeTransport([])
        let model = BulkResolveModel(http: HTTPClient(transport: transport))
        model.submit((0..<200).map { "user\($0).example.com" }.joined(separator: "\n"))
        XCTAssertNil(model.queryList)
        XCTAssertTrue(model.isTooLongToShare)
        model.cancel()
        XCTAssertFalse(model.isRunning)
    }
}
