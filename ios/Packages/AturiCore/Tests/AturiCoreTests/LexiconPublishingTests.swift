import Foundation
import XCTest
@testable import AturiCore

/// Port of src/lib/tools/__tests__/lexicon.test.ts. The two TXT-reading
/// tests there (`readTxtAnswer`, `unquoteTxt`) are covered by
/// `DNSTXTTests` in ToolCatalogTests.swift, which ports txt.ts itself.
/// The client and the screen model, which the web has no tests for, follow.
final class LexiconPublishingTests: XCTestCase {
    private typealias L = LexiconPublishing

    private static let nsid = "com.example.blog.post"
    private static let did = "did:plc:4v4y5r3lwsbtmsxhile2ljac"
    private static let other = "did:plc:6msi3pj7krzih5qxqtryxlzw"
    private static let pds = "https://pds.example.com"

    private static let docText = #"""
    {
      "$type": "com.atproto.lexicon.schema",
      "lexicon": 1,
      "id": "com.example.blog.post",
      "defs": {
        "main": {
          "type": "record",
          "key": "tid",
          "record": {
            "type": "object",
            "required": ["text"],
            "properties": { "text": { "type": "string" }, "createdAt": { "type": "string", "format": "datetime" } }
          }
        },
        "reply": { "type": "object", "properties": { "parent": { "type": "string" } } }
      }
    }
    """#

    private static let doc = try! JSONValue.parse(Data(docText.utf8))

    /// The document with some top-level fields changed; `.null` stands for
    /// a field left out, as `undefined` does in the web's spreads.
    private static func docWith(_ changes: [String: JSONValue]) -> JSONValue {
        var members = doc.objectValue ?? [:]
        for (key, value) in changes {
            if value.isNull {
                members[key] = nil
            } else {
                members[key] = value
            }
        }
        return .object(members)
    }

    private static func dns(_ records: [String], _ status: TxtProbe.Status? = nil) -> TxtProbe {
        let resolved: TxtProbe.Status
        if let status {
            resolved = status
        } else {
            resolved = records.isEmpty ? TxtProbe.Status.none : TxtProbe.Status.found
        }
        return TxtProbe(name: "_lexicon.blog.example.com", status: resolved, records: records)
    }

    private static func found(_ value: JSONValue = doc) -> L.RecordProbe {
        .found(pds: pds, uri: L.schemaRecordUri(did: did, nsid: nsid), cid: "bafyreia", value: value)
    }

    private static let document = L.DocumentState.resolved(DIDDocument(
        id: did,
        alsoKnownAs: ["at://lexicons.example.com"],
        service: [DIDDocument.Service(id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pds)]
    ))

    private static func statuses(_ evidence: L.Evidence) -> [String] {
        L.buildChecks(evidence).map { "\($0.id.rawValue) \($0.status.rawValue)" }
    }

    private static func check(_ evidence: L.Evidence, _ id: L.CheckID) -> L.Check? {
        L.buildChecks(evidence).first { $0.id == id }
    }

    func testNormalizeNsidInputTidiesWhatPeoplePaste() {
        XCTAssertEqual(L.normalizeNsidInput(" app.bsky.feed.post "), .nsid("app.bsky.feed.post"))
        XCTAssertEqual(L.normalizeNsidInput("lex:app.bsky.feed.post#replyRef"), .nsid("app.bsky.feed.post"))
        XCTAssertEqual(L.normalizeNsidInput("at://\(Self.did)/com.atproto.lexicon.schema/app.bsky.feed.post"), .nsid("app.bsky.feed.post"))
        XCTAssertEqual(L.normalizeNsidInput("https://aturi.to/explore/lexicons/app.bsky.feed.post?view=files"), .nsid("app.bsky.feed.post"))
        XCTAssertNotNil(L.normalizeNsidInput("").reason)
        let namespace = L.normalizeNsidInput("app.bsky.*")
        XCTAssertTrue(namespace.reason?.contains("namespace") ?? false)
    }

    func testNsidProblemSaysWhatIsWrongWithAnNSID() {
        XCTAssertNil(L.nsidProblem("app.bsky.feed.post"))
        XCTAssertNil(L.nsidProblem("com.example.fooBar"))
        XCTAssertTrue(L.nsidProblem("bsky.app")?.contains("three parts") ?? false)
        XCTAssertTrue(L.nsidProblem("app.bsky.feed_post")?.contains("letters, digits") ?? false)
        XCTAssertTrue(L.nsidProblem("app.bsky.3d")?.contains("name") ?? false)
        XCTAssertTrue(L.nsidProblem("app..post")?.contains("empty part") ?? false)
    }

    func testTheAuthorityIsEveryPartButTheNameReversed() {
        XCTAssertEqual(L.nsidAuthority("app.bsky.feed.post"), .init(domain: "feed.bsky.app", name: "post"))
        // The spec's own example.
        XCTAssertEqual(
            L.nsidAuthority("edu.university.dept.lab.blogging.getBlogPost"),
            .init(domain: "blogging.lab.dept.university.edu", name: "getBlogPost")
        )
        XCTAssertEqual(L.nsidAuthority("app.toy.record"), .init(domain: "toy.app", name: "record"))
    }

    func testParentAuthoritiesStopAtTwoLabelsAndNeverNameATLD() {
        XCTAssertEqual(L.parentAuthorities("feed.bsky.app"), ["bsky.app"])
        XCTAssertEqual(L.parentAuthorities("bsky.app"), [])
        XCTAssertEqual(L.parentAuthorities("a.b.c.d.example.com"), ["b.c.d.example.com", "c.d.example.com", "d.example.com"])
    }

    func testConventionHandleIsTheFirstTwoPartsReversed() {
        XCTAssertEqual(L.conventionHandle("app.bsky.feed.post"), "bsky.app")
        XCTAssertEqual(L.conventionHandle("net.anisota.harvest.minigame"), "anisota.net")
    }

    func testReadLexiconRecordsAcceptsOneDidRecordAndExplainsTheRest() {
        XCTAssertEqual(L.readLexiconRecords(["did=\(Self.did)"]).did, Self.did)
        XCTAssertEqual(L.readLexiconRecords(["did=did:web:lex.example.com"]).did, "did:web:lex.example.com")
        XCTAssertTrue(L.readLexiconRecords([]).absent)
        XCTAssertNil(L.readLexiconRecords([]).problem)
        XCTAssertNotNil(L.readLexiconRecords(["v=spf1 -all"]).problem)
        XCTAssertTrue(L.readLexiconRecords(["did=\(Self.did)", "did=\(Self.other)"]).problem?.contains("More than one") ?? false)
        XCTAssertTrue(L.readLexiconRecords(["did = \(Self.did)"]).problem?.contains("exactly") ?? false)
        XCTAssertTrue(L.readLexiconRecords(["did=lexicons.example.com"]).problem?.contains("not a valid") ?? false)
    }

    func testReadSchemaDocumentPassesAWellFormedDocumentAndSummarisesIt() {
        let reading = L.readSchemaDocument(Self.nsid, Self.doc)
        XCTAssertEqual(reading.problems, [])
        XCTAssertEqual(reading.notes, [])
        XCTAssertEqual(reading.summary, "Defines a record keyed by tid with 2 fields, and 1 other definition.")
    }

    func testReadSchemaDocumentNamesEachThingWrongWithADocument() {
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, "nope").problems[0].contains("not a JSON object"))
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, Self.docWith(["lexicon": "1"])).problems[0].contains("must be the number 1"))
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, Self.docWith(["id": "com.example.blog.other"])).problems[0].contains("must match"))
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, Self.docWith(["defs": .null])).problems[0].contains("defs field is missing"))
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, Self.docWith(["defs": .object([:])])).problems[0].contains("empty"))
        let main = Self.doc["defs"]?["main"] ?? .null
        XCTAssertTrue(L.readSchemaDocument(Self.nsid, Self.docWith(["defs": ["#main": main]])).problems[0].contains("must not include a #"))
        // A missing $type is worth a word, not a failure.
        let untyped = L.readSchemaDocument(Self.nsid, Self.docWith(["$type": .null]))
        XCTAssertEqual(untyped.problems, [])
        XCTAssertEqual(untyped.notes.count, 1)
    }

    func testADocumentWithNoMainDefinitionIsStillALexicon() {
        let reading = L.readSchemaDocument("com.example.blog.defs", [
            "$type": "com.atproto.lexicon.schema",
            "lexicon": 1,
            "id": "com.example.blog.defs",
            "defs": ["a": ["type": "object", "properties": .object([:])], "b": ["type": "token"]],
        ])
        XCTAssertEqual(reading.problems, [])
        XCTAssertTrue(reading.summary?.contains("no main definition") ?? false)
    }

    func testAPublishedLexiconPassesEveryStep() {
        let evidence = L.Evidence(nsid: Self.nsid, dns: Self.dns(["did=\(Self.did)"]), document: Self.document, record: Self.found())
        XCTAssertEqual(Self.statuses(evidence), ["nsid pass", "dns pass", "authority pass", "record pass", "schema pass"])
        XCTAssertEqual(L.verdict(evidence, L.buildChecks(evidence)).tone, .pass)
        XCTAssertEqual(L.foundSchema(evidence)?.via, .dns)
        XCTAssertEqual(Self.check(evidence, .authority)?.summary, "The DID resolves. Its repository is on pds.example.com.")
    }

    func testNoDNSRecordFailsSkipsTheRestAndReportsTheConventionAsANote() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns([]),
            parents: [],
            convention: L.ConventionProbe(handle: "example.com", did: nil, record: nil)
        )
        XCTAssertEqual(Self.statuses(evidence), [
            "nsid pass", "dns fail", "authority skip", "record skip", "schema skip", "convention info",
        ])
        let verdict = L.verdict(evidence, L.buildChecks(evidence))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.text.contains("_lexicon.blog.example.com"))
    }

    func testARecordOneLevelTooHighIsNamedAndItsDidGoesIntoTheFix() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns([]),
            parents: [L.ParentRecord(name: "_lexicon.example.com", did: Self.did)],
            convention: L.ConventionProbe(handle: "example.com", did: Self.did, record: .missing(pds: Self.pds))
        )
        let check = Self.check(evidence, .dns)
        XCTAssertTrue(check?.summary.contains("_lexicon.example.com") ?? false)
        XCTAssertEqual(
            check?.fix?.first,
            "Add a TXT record at _lexicon.blog.example.com with the value did=\(Self.did)."
        )
    }

    func testTheFixOnlyNamesADidThereIsAReasonToTrust() {
        func fix(_ evidence: L.Evidence) -> String {
            Self.check(evidence, .dns)?.fix?.first ?? ""
        }
        // The handle resolves, but its repository has no such schema: no DID offered.
        XCTAssertTrue(fix(L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns([]),
            parents: [],
            convention: L.ConventionProbe(handle: "example.com", did: Self.other, record: .missing(pds: Self.pds))
        )).contains("did=<the DID"))
        // Its repository does hold the schema: that DID is the one to point at.
        XCTAssertTrue(fix(L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns([]),
            parents: [],
            convention: L.ConventionProbe(
                handle: "example.com",
                did: Self.other,
                record: .found(pds: Self.pds, uri: L.schemaRecordUri(did: Self.other, nsid: Self.nsid), cid: nil, value: Self.doc)
            )
        )).contains("did=\(Self.other)"))
    }

    func testASchemaFoundOnlyByTheHandleConventionIsAWarningNotAPass() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns([]),
            parents: [],
            convention: L.ConventionProbe(handle: "example.com", did: Self.did, record: Self.found())
        )
        let checks = L.buildChecks(evidence)
        XCTAssertEqual(checks.first { $0.id == .convention }?.status, .info)
        XCTAssertEqual(L.verdict(evidence, checks).tone, .warn)
        XCTAssertEqual(L.foundSchema(evidence)?.via, .convention)
    }

    func testADidWithNoSchemaRecordFailsAtTheRecord() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns(["did=\(Self.did)"]),
            document: Self.document,
            record: .missing(pds: Self.pds)
        )
        XCTAssertEqual(Array(Self.statuses(evidence).dropFirst(3)), ["record fail", "schema skip"])
        let verdict = L.verdict(evidence, L.buildChecks(evidence))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertTrue(verdict.title.contains("no schema"))
    }

    func testADidThatDoesNotResolveOrHasNoPDSFailsAtTheRepository() {
        let unresolved = L.Evidence(nsid: Self.nsid, dns: Self.dns(["did=\(Self.did)"]), document: .failed(nil))
        XCTAssertEqual(Self.check(unresolved, .authority)?.status, .fail)
        let hostless = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns(["did=\(Self.did)"]),
            document: .resolved(DIDDocument(id: Self.did, service: []))
        )
        let check = Self.check(hostless, .authority)
        XCTAssertEqual(check?.status, .fail)
        XCTAssertTrue(check?.summary.contains("names no PDS") ?? false)
    }

    func testAMalformedDocumentFailsTheLastStepAndTheVerdictSaysSo() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: Self.dns(["did=\(Self.did)"]),
            document: Self.document,
            record: Self.found(Self.docWith(["id": "com.example.blog.wrong", "lexicon": 2]))
        )
        let checks = L.buildChecks(evidence)
        let schema = checks.first { $0.id == .schema }
        XCTAssertEqual(schema?.status, .fail)
        XCTAssertEqual(schema?.detail?.count, 2)
        XCTAssertTrue(L.verdict(evidence, checks).title.contains("not valid"))
    }

    func testStepsNotYetObservedArePendingAndSoIsTheVerdict() {
        let waiting = L.Evidence(nsid: Self.nsid)
        XCTAssertEqual(Self.statuses(waiting), ["nsid pass", "dns pending", "authority pending", "record pending", "schema pending"])
        let partial = L.Evidence(nsid: Self.nsid, dns: Self.dns(["did=\(Self.did)"]), document: Self.document)
        XCTAssertEqual(Array(Self.statuses(partial).dropFirst(2)), ["authority pass", "record pending", "schema pending"])
        XCTAssertEqual(L.verdict(partial, L.buildChecks(partial)).tone, .pending)
    }

    func testAFailedDNSLookupIsAFailureOfTheLookupNotOfTheLexicon() {
        let evidence = L.Evidence(
            nsid: Self.nsid,
            dns: TxtProbe(name: "_lexicon.blog.example.com", status: .error, records: [], error: "the resolver did not answer"),
            parents: [],
            convention: L.ConventionProbe(handle: "example.com", did: nil, record: nil)
        )
        let check = Self.check(evidence, .dns)
        XCTAssertEqual(check?.status, .fail)
        XCTAssertTrue(check?.summary.contains("lookup failed") ?? false)
        XCTAssertNil(check?.fix)
    }

    func testPdsEndpointAcceptsAQualifiedServiceId() {
        let qualified = DIDDocument(
            id: Self.did,
            service: [DIDDocument.Service(id: "\(Self.did)#atproto_pds", type: "Other", serviceEndpoint: "https://pds.example.com/")]
        )
        XCTAssertEqual(L.pdsEndpoint(from: qualified), "https://pds.example.com/")
        XCTAssertEqual(L.displayHost("https://pds.example.com/"), "pds.example.com")
    }

    // MARK: The client

    /// `##` delimiters: the body holds `"#atproto_pds"`, which would close a `#"` string.
    private static let didDocBody = ##"{"id":"\##(did)","alsoKnownAs":["at://lexicons.example.com"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\##(pds)"}]}"##

    private static func recordBody(_ did: String) -> String {
        #"{"uri":"at://\#(did)/com.atproto.lexicon.schema/\#(nsid)","cid":"bafyreia","value":\#(docText)}"#
    }

    func testTheClientTellsAMissingRecordFromAnUnreachablePDS() async {
        let transport = SchemaLookupFakeTransport([
            (["rkey=com.example.found"], .init(status: 200, body: Self.recordBody(Self.did))),
            (["rkey=com.example.missing"], .init(status: 400, body: #"{"error":"RecordNotFound","message":"Could not locate record"}"#)),
            (["rkey=com.example.refused"], .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (["rkey=com.example.down"], .init(status: 502, body: "Bad Gateway")),
        ])
        let client = LexiconPublishingClient(http: HTTPClient(transport: transport))
        let found = await client.readSchemaRecord(pds: Self.pds + "/", did: Self.did, nsid: "com.example.found")
        if case .found(let pds, let uri, let cid, let value) = found {
            XCTAssertEqual(pds, Self.pds, "the trailing slash is dropped")
            XCTAssertEqual(uri, "at://\(Self.did)/com.atproto.lexicon.schema/\(Self.nsid)")
            XCTAssertEqual(cid, "bafyreia")
            XCTAssertEqual(value["id"]?.stringValue, Self.nsid)
        } else {
            XCTFail("expected the record, got \(found)")
        }
        let missing = await client.readSchemaRecord(pds: Self.pds, did: Self.did, nsid: "com.example.missing")
        XCTAssertEqual(missing, .missing(pds: Self.pds))
        let refused = await client.readSchemaRecord(pds: Self.pds, did: Self.did, nsid: "com.example.refused")
        XCTAssertEqual(refused, .error(pds: Self.pds, error: "InvalidRequest (HTTP 400)"))
        let down = await client.readSchemaRecord(pds: Self.pds, did: Self.did, nsid: "com.example.down")
        XCTAssertEqual(down, .error(pds: Self.pds, error: "HTTP 502"))
    }

    // MARK: The screen

    @MainActor
    func testTheModelFollowsThePublishedChainToTheEnd() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google", "name=_lexicon.blog.example.com"], .init(status: 200, body: SchemaLookupFixtures.dnsFound(Self.did))),
            (["plc.directory"], .init(status: 200, body: Self.didDocBody)),
            (["pds.example.com", "com.atproto.repo.getRecord"], .init(status: 200, body: Self.recordBody(Self.did))),
        ])
        let model = LexiconCheckerModel(http: HTTPClient(transport: transport))
        _ = await model.check("lex:\(Self.nsid)")?.value
        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(model.checks.map { $0.status }, [.pass, .pass, .pass, .pass, .pass])
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertEqual(model.schema?.did, Self.did)
        XCTAssertEqual(model.shareQuery, ["nsid": Self.nsid])
    }

    @MainActor
    func testTheModelLooksAboveTheAuthorityAndAtTheConventionWhenDNSHasNothing() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google", "name=_lexicon.blog.example.com"], .init(status: 200, body: SchemaLookupFixtures.dnsNone)),
            (["dns.google", "name=_lexicon.example.com"], .init(status: 200, body: SchemaLookupFixtures.dnsFound(Self.did))),
            (["resolveMiniDoc", "identifier=example.com"], .init(status: 200, body: SchemaLookupFixtures.miniDoc(Self.other))),
            (["pds.example.com", "com.atproto.repo.getRecord"], .init(status: 200, body: Self.recordBody(Self.other))),
        ])
        let model = LexiconCheckerModel(http: HTTPClient(transport: transport))
        _ = await model.check(Self.nsid)?.value
        XCTAssertEqual(model.evidence?.parents, [L.ParentRecord(name: "_lexicon.example.com", did: Self.did)])
        XCTAssertEqual(model.evidence?.convention?.did, Self.other)
        XCTAssertEqual(model.verdict?.tone, .warn)
        XCTAssertEqual(model.schema?.via, .convention)
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0)
    }

    @MainActor
    func testTheModelSaysWhyAnInputIsNotAnNSID() {
        let model = LexiconCheckerModel(http: HTTPClient(transport: SchemaLookupFakeTransport([])))
        XCTAssertNil(model.check("bsky.app"))
        XCTAssertTrue(model.inputProblem?.contains("three parts") ?? false)
        XCTAssertNil(model.evidence)
        XCTAssertEqual(model.shareQuery, [:])
    }
}
