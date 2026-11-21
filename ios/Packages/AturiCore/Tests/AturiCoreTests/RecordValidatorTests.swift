import Foundation
import XCTest
@testable import AturiCore

/// Port of src/lib/tools/__tests__/validate.test.ts, plus the input reader
/// (validateInput.ts), the schema-fetching run (validateRun.ts) and the
/// screen model, which the web has no tests for.
final class RecordValidatorTests: XCTestCase {
    private static func json(_ text: String) -> JSONValue {
        try! JSONValue.parse(Data(text.utf8))
    }

    /// A cut-down post lexicon with the parts worth exercising.
    private static let post = json(#"""
    {
      "id": "com.example.post",
      "defs": {
        "main": {
          "type": "record",
          "key": "tid",
          "record": {
            "type": "object",
            "required": ["text", "createdAt"],
            "nullable": ["note"],
            "properties": {
              "text": { "type": "string", "maxLength": 30, "maxGraphemes": 10 },
              "createdAt": { "type": "string", "format": "datetime" },
              "langs": { "type": "array", "maxLength": 2, "items": { "type": "string", "format": "language" } },
              "likes": { "type": "integer", "minimum": 0, "maximum": 100 },
              "visibility": { "type": "string", "knownValues": ["public", "followers"] },
              "kind": { "type": "string", "enum": ["note", "article"] },
              "note": { "type": "string" },
              "reply": { "type": "ref", "ref": "#replyRef" },
              "subject": { "type": "ref", "ref": "com.example.strongRef" },
              "embed": { "type": "union", "refs": ["com.example.embed.images", "com.example.embed.external#view"] },
              "strict": { "type": "union", "closed": true, "refs": ["#replyRef"] },
              "avatar": { "type": "blob", "accept": ["image/*"], "maxSize": 1000 },
              "hash": { "type": "cid-link" },
              "sig": { "type": "bytes", "maxLength": 4 }
            }
          }
        },
        "replyRef": {
          "type": "object",
          "required": ["parent"],
          "properties": { "parent": { "type": "string", "format": "at-uri" } }
        }
      }
    }
    """#)

    private static let strongRef = json(#"""
    {
      "id": "com.example.strongRef",
      "defs": {
        "main": {
          "type": "object",
          "required": ["uri", "cid"],
          "properties": { "uri": { "type": "string", "format": "at-uri" }, "cid": { "type": "string", "format": "cid" } }
        }
      }
    }
    """#)

    private static let images = json(#"""
    {
      "id": "com.example.embed.images",
      "defs": { "main": { "type": "object", "required": ["images"], "properties": { "images": { "type": "array", "items": { "type": "unknown" } } } } }
    }
    """#)

    private static let cid = "bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq"

    private static func docs(_ extra: JSONValue...) -> [String: JSONValue] {
        var map: [String: JSONValue] = [:]
        for doc in [post] + extra {
            if let id = doc["id"]?.stringValue { map[id] = doc }
        }
        return map
    }

    private static let base: [String: JSONValue] = [
        "$type": "com.example.post",
        "text": "hello",
        "createdAt": "2026-01-31T12:00:00.000Z",
    ]

    /// The base record with some fields changed or added.
    private static func record(_ changes: [String: JSONValue]) -> JSONValue {
        var members = base
        for (key, value) in changes { members[key] = value }
        return .object(members)
    }

    private static func problems(_ record: JSONValue, _ map: [String: JSONValue] = docs()) -> [String] {
        RecordValidator.validate(record: record, nsid: "com.example.post", docs: map).issues.map { "\($0.path): \($0.message)" }
    }

    private typealias V = RecordValidator

    func testARecordThatFitsItsSchemaHasNoIssues() {
        let result = V.validate(record: .object(Self.base), nsid: "com.example.post", docs: Self.docs())
        XCTAssertEqual(result.issues, [])
        XCTAssertEqual(result.unresolved, [])
        XCTAssertGreaterThan(result.checked, 0)
    }

    func testMissingRequiredFieldsAndWrongTypesAreNamedByPath() {
        let found = Self.problems(["$type": "com.example.post", "text": 5])
        XCTAssertTrue(found.contains { $0.hasPrefix("createdAt: is required") }, "\(found)")
        XCTAssertTrue(found.contains { $0.hasPrefix("text: must be a string, but is an integer") }, "\(found)")
    }

    func testTypeMustBePresentAndNameTheLexicon() {
        XCTAssertTrue(Self.problems(["text": "hi", "createdAt": "2026-01-31T12:00:00.000Z"]).contains { $0.hasPrefix("$type: is required") })
        XCTAssertTrue(Self.problems(Self.record(["$type": "com.example.other"])).contains { $0.hasPrefix(#"$type: is "com.example.other""#) })
    }

    func testStringLimitsCountBytesAndGraphemesSeparately() {
        // Ten family emoji: ten graphemes, far more than 30 bytes.
        let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"
        XCTAssertEqual(V.graphemeLength(family), 1)
        let found = Self.problems(Self.record(["text": .string(String(repeating: family, count: 10))]))
        XCTAssertTrue(found.contains { $0.hasPrefix("text: is ") && $0.hasSuffix("bytes long, over the limit of 30") }, "\(found)")
        XCTAssertFalse(found.contains { $0.contains("characters long") })
        XCTAssertTrue(Self.problems(Self.record(["text": "abcdefghijk"])).contains("text: is 11 characters long, over the limit of 10"))
    }

    func testFormatsAreChecked() {
        XCTAssertTrue(Self.problems(Self.record(["createdAt": "2026-01-31"])).contains { $0.hasPrefix("createdAt: must be a datetime") })
        XCTAssertTrue(Self.problems(Self.record(["langs": ["en", "not a tag"]])).contains { $0.hasPrefix("langs[1]: must be a language tag") })
        XCTAssertNil(V.formatProblem("datetime", "2026-01-31T12:00:00Z"))
        XCTAssertNil(V.formatProblem("datetime", "2026-01-31T12:00:00+01:00"))
        XCTAssertNotNil(V.formatProblem("datetime", "2026-01-31T12:00:00"))
        XCTAssertNotNil(V.formatProblem("datetime", "2026-01-31T12:00:00-00:00"))
        XCTAssertNil(V.formatProblem("at-uri", "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f"))
        XCTAssertNil(V.formatProblem("at-uri", "at://bsky.app"))
        XCTAssertNotNil(V.formatProblem("at-uri", "https://bsky.app"))
        XCTAssertNil(V.formatProblem("did", "did:web:example.com"))
        XCTAssertNotNil(V.formatProblem("did", "example.com"))
        XCTAssertNil(V.formatProblem("at-identifier", "bsky.app"))
        XCTAssertNil(V.formatProblem("nsid", "app.bsky.feed.post"))
        XCTAssertNotNil(V.formatProblem("nsid", "bsky.app"))
        XCTAssertNil(V.formatProblem("cid", Self.cid))
        XCTAssertNil(V.formatProblem("tid", "3n22yg6lg2k2f"))
        XCTAssertNotNil(V.formatProblem("tid", "self"))
        XCTAssertNil(V.formatProblem("uri", "https://example.com/a"))
        XCTAssertNotNil(V.formatProblem("uri", "not a uri"))
        // A format this does not know is not a failure.
        XCTAssertNil(V.formatProblem("made-up", "anything"))
    }

    func testIntegersEnumsAndKnownValues() {
        XCTAssertTrue(Self.problems(Self.record(["likes": 101])).contains("likes: is 101, over the maximum of 100"))
        XCTAssertTrue(Self.problems(Self.record(["likes": "3"])).contains { $0.hasPrefix("likes: must be an integer") })
        XCTAssertTrue(Self.problems(Self.record(["kind": "poem"])).contains { $0.hasPrefix("kind: must be one of") })
        let result = V.validate(record: Self.record(["visibility": "circle"]), nsid: "com.example.post", docs: Self.docs())
        XCTAssertEqual(result.issues.map(\.severity), [.warning])
    }

    func testDecimalNumbersAreRefusedWhereverTheyAre() {
        XCTAssertTrue(Self.problems(Self.record(["extra": ["ratio": 0.5]])).contains { $0.hasPrefix("extra.ratio: is 0.5") })
    }

    func testNullIsOnlyAllowedWhereTheSchemaSaysSo() {
        XCTAssertEqual(Self.problems(Self.record(["note": .null])), [])
        XCTAssertTrue(Self.problems(Self.record(["likes": .null])).contains { $0.hasPrefix("likes: is null") })
    }

    func testArraysAreBoundedAndTheirItemsChecked() {
        XCTAssertTrue(Self.problems(Self.record(["langs": ["en", "fr", "de"]])).contains("langs: has 3 items, over the limit of 2"))
        XCTAssertTrue(Self.problems(Self.record(["langs": "en"])).contains { $0.hasPrefix("langs: must be an array") })
    }

    func testALocalRefIsFollowed() {
        XCTAssertTrue(Self.problems(Self.record(["reply": .object([:])])).contains { $0.hasPrefix("reply.parent: is required") })
        XCTAssertTrue(Self.problems(Self.record(["reply": ["parent": "nope"]])).contains { $0.hasPrefix("reply.parent: must be an at:// URI") })
    }

    func testARefToAnotherLexiconIsCheckedWhenFoundAndListedWhenNot() {
        let subject = Self.record(["subject": ["uri": "at://bsky.app", "cid": "nope"]])
        let without = V.validate(record: subject, nsid: "com.example.post", docs: Self.docs())
        XCTAssertEqual(without.issues, [])
        XCTAssertEqual(without.unresolved, ["com.example.strongRef"])

        let withRef = V.validate(record: subject, nsid: "com.example.post", docs: Self.docs(Self.strongRef))
        XCTAssertEqual(withRef.unresolved, [])
        XCTAssertTrue(withRef.issues.contains { $0.path == "subject.cid" })

        // Looked for and not published: still unchecked, still said.
        var missing = Self.docs()
        missing["com.example.strongRef"] = .null
        XCTAssertEqual(V.validate(record: subject, nsid: "com.example.post", docs: missing).unresolved, ["com.example.strongRef"])
    }

    func testUnionsMatchOnTypeAndOnlyClosedOnesRefuseAStranger() {
        let map = Self.docs(Self.images)
        XCTAssertTrue(Self.problems(Self.record(["embed": ["$type": "com.example.embed.images"]]), map).contains { $0.hasPrefix("embed.images: is required") })
        // #main is the same type.
        XCTAssertTrue(Self.problems(Self.record(["embed": ["$type": "com.example.embed.images#main"]]), map).contains { $0.hasPrefix("embed.images: is required") })
        XCTAssertEqual(Self.problems(Self.record(["embed": ["$type": "com.other.thing"]]), map), [])
        XCTAssertTrue(Self.problems(Self.record(["embed": .object([:])]), map).contains { $0.hasPrefix("embed.$type: is required") })
        XCTAssertTrue(Self.problems(Self.record(["strict": ["$type": "com.other.thing"]]), map).contains { $0.hasPrefix(#"strict.$type: is "com.other.thing""#) })
        XCTAssertTrue(Self.problems(Self.record(["strict": ["$type": "com.example.post#replyRef"]]), map).contains { $0.hasPrefix("strict.parent: is required") })
    }

    func testBlobsCIDLinksAndBytes() {
        let cid = JSONValue.string(Self.cid)
        let blob: [String: JSONValue] = ["$type": "blob", "ref": ["$link": cid], "mimeType": "image/png", "size": 10]
        XCTAssertEqual(Self.problems(Self.record(["avatar": .object(blob), "hash": ["$link": cid], "sig": ["$bytes": "AAEC"]])), [])

        var video = blob
        video["mimeType"] = "video/mp4"
        XCTAssertTrue(Self.problems(Self.record(["avatar": .object(video)])).contains { $0.hasPrefix("avatar.mimeType: is video/mp4") })
        var large = blob
        large["size"] = 5000
        XCTAssertTrue(Self.problems(Self.record(["avatar": .object(large)])).contains { $0.hasPrefix("avatar.size: is 5000 bytes") })
        XCTAssertTrue(Self.problems(Self.record(["hash": cid])).contains { $0.hasPrefix("hash: must be a CID link") })
        XCTAssertTrue(Self.problems(Self.record(["sig": ["$bytes": "AAECAwQFBgc="]])).contains { $0.hasPrefix("sig: is 8 bytes") })
        let legacy = V.validate(record: Self.record(["avatar": ["cid": cid, "mimeType": "image/png"]]), nsid: "com.example.post", docs: Self.docs())
        XCTAssertEqual(legacy.issues.map(\.severity), [.warning])
    }

    func testALexiconThatIsNotThereOrIsNotARecordTypeIsSaidPlainly() {
        let none = V.validate(record: ["$type": "com.example.gone"], nsid: "com.example.gone", docs: [:])
        XCTAssertEqual(none.unresolved, ["com.example.gone"])
        let query: [String: JSONValue] = ["com.example.q": ["id": "com.example.q", "defs": ["main": ["type": "query"]]]]
        let asQuery = V.validate(record: ["$type": "com.example.q"], nsid: "com.example.q", docs: query)
        XCTAssertTrue(asQuery.issues.contains { $0.message.contains("defines a query") })
        XCTAssertEqual(V.validate(record: "text", nsid: "com.example.post", docs: Self.docs()).issues.count, 1)
    }

    func testTheRecordKeyIsHeldToTheKeyType() {
        XCTAssertNil(V.recordKeyProblem("tid", rkey: "3n22yg6lg2k2f"))
        XCTAssertNotNil(V.recordKeyProblem("tid", rkey: "self"))
        XCTAssertNil(V.recordKeyProblem("literal:self", rkey: "self"))
        XCTAssertNotNil(V.recordKeyProblem("literal:self", rkey: "3n22yg6lg2k2f"))
        XCTAssertNil(V.recordKeyProblem("any", rkey: "whatever"))
        let result = V.validate(record: .object(Self.base), nsid: "com.example.post", docs: Self.docs(), rkey: "self")
        XCTAssertTrue(result.issues.contains { $0.message.contains("TID record key") })
    }

    func testReferencedLexiconsListsOtherDocumentsOnceAndNotThisOne() {
        XCTAssertEqual(V.referencedLexicons(Self.post, id: "com.example.post").sorted(), [
            "com.example.embed.external",
            "com.example.embed.images",
            "com.example.strongRef",
        ])
    }

    func testASchemaThatRefersToItselfDoesNotLoop() {
        let tree = Self.json(#"""
        {
          "id": "com.example.tree",
          "defs": {
            "main": { "type": "record", "record": { "type": "object", "properties": { "child": { "type": "ref", "ref": "#node" } } } },
            "node": { "type": "object", "properties": { "child": { "type": "ref", "ref": "#node" } } }
          }
        }
        """#)
        var nested: JSONValue = .object([:])
        for _ in 0..<100 { nested = .object(["child": nested]) }
        let record: JSONValue = .object(["$type": "com.example.tree", "child": nested["child"] ?? .null])
        let result = V.validate(record: record, nsid: "com.example.tree", docs: ["com.example.tree": tree])
        XCTAssertEqual(result.issues, [])
    }

    func testParseLexiconRef() {
        XCTAssertEqual(V.parseLexiconRef("#replyRef", docId: "com.example.post"), .init(nsid: "com.example.post", def: "replyRef", local: true))
        XCTAssertEqual(V.parseLexiconRef("com.example.strongRef", docId: "com.example.post"), .init(nsid: "com.example.strongRef", def: "main", local: false))
        XCTAssertEqual(V.parseLexiconRef("com.example.embed.external#view", docId: "com.example.post"), .init(nsid: "com.example.embed.external", def: "view", local: false))
        XCTAssertEqual(V.parseLexiconRef("com.example.thing#", docId: "com.example.post").def, "main")
    }

    // MARK: Input (validateInput.ts)

    func testInputReadsJSONAndUnwrapsAGetRecordResponse() {
        XCTAssertEqual(
            V.parseInput(#"  {"$type":"com.example.post","text":"hi"}  "#),
            .json(record: ["$type": "com.example.post", "text": "hi"], nsid: "com.example.post")
        )
        XCTAssertEqual(
            V.parseInput(#"{"uri":"at://did:plc:x/com.example.post/1","cid":"bafy","value":{"$type":"com.example.post"}}"#),
            .json(record: ["$type": "com.example.post"], nsid: "com.example.post")
        )
    }

    func testInputSaysWhatIsWrongWithIt() {
        XCTAssertEqual(V.parseInput("   ").errorReason, "Paste a record as JSON, or the at:// URI of one.")
        XCTAssertTrue(V.parseInput(#"{"text":"hi"}"#).errorReason?.contains("no $type") ?? false)
        XCTAssertTrue(V.parseInput(#"{"$type":"#).errorReason?.hasPrefix("That is not valid JSON: ") ?? false)
        XCTAssertTrue(V.parseInput("at://bsky.app").errorReason?.hasPrefix("That does not point at one record.") ?? false)
    }

    func testInputReadsAddressesTheWayTheSearchBoxDoes() {
        let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
        XCTAssertEqual(
            V.parseInput("at://\(did)/app.bsky.actor.profile/self"),
            .uri(uri: "at://\(did)/app.bsky.actor.profile/self", repo: did, collection: "app.bsky.actor.profile", rkey: "self")
        )
        XCTAssertEqual(
            V.parseInput("https://bsky.app/profile/alice.example.com/post/3n22yg6lg2k2f"),
            .uri(
                uri: "at://alice.example.com/app.bsky.feed.post/3n22yg6lg2k2f",
                repo: "alice.example.com",
                collection: "app.bsky.feed.post",
                rkey: "3n22yg6lg2k2f"
            )
        )
    }

    // MARK: The run (validateRun.ts)

    private typealias F = SchemaLookupFixtures

    private static let postDocument = #"{"$type":"com.atproto.lexicon.schema","lexicon":1,"id":"com.example.post","defs":\#(post["defs"]!.compactString())}"#
    private static let strongRefDocument = #"{"$type":"com.atproto.lexicon.schema","lexicon":1,"id":"com.example.strongRef","defs":\#(strongRef["defs"]!.compactString())}"#

    private func runTransport() -> SchemaLookupFakeTransport {
        SchemaLookupFakeTransport([
            (["getRecordByUri", "3n22yg6lg2k2f"], .init(status: 200, body: #"{"uri":"at://\#(F.did)/com.example.post/3n22yg6lg2k2f","cid":"bafyreib","value":{"$type":"com.example.post","text":"networked","createdAt":"2026-01-31T12:00:00.000Z"}}"#)),
            (["dns.google", "_lexicon.example.com"], .init(status: 200, body: F.dnsFound(F.did))),
            (["getRecordByUri", "lexicon.schema", "com.example.strongRef"], .init(status: 200, body: F.record("com.example.strongRef", doc: Self.strongRefDocument))),
            (["getRecordByUri", "lexicon.schema", "com.example.post"], .init(status: 200, body: F.record("com.example.post", doc: Self.postDocument))),
        ])
    }

    func testTheRunOnlyFetchesTheLexiconsARecordNeeds() async {
        let transport = runTransport()
        let lookup = LexiconSchemaLookup(http: HTTPClient(transport: transport))
        let check = await V.check(record: .object(Self.base), nsid: "com.example.post", lookup: lookup)
        XCTAssertEqual(check.lookups.map(\.nsid), ["com.example.post"])
        XCTAssertEqual(check.verdict, .valid)
        XCTAssertEqual(transport.count(containing: "com.example.strongRef"), 0)
    }

    func testTheRunFollowsAReferenceIntoAnotherLexicon() async {
        let transport = runTransport()
        let lookup = LexiconSchemaLookup(http: HTTPClient(transport: transport))
        let record = Self.record(["subject": ["uri": "at://bsky.app", "cid": "nope"]])
        let check = await V.check(record: record, nsid: "com.example.post", lookup: lookup)
        XCTAssertEqual(check.lookups.map(\.nsid), ["com.example.post", "com.example.strongRef"])
        XCTAssertEqual(check.report.unresolved, [])
        XCTAssertTrue(check.report.issues.contains { $0.path == "subject.cid" })
        XCTAssertEqual(check.verdict, .invalid)
    }

    func testAReferenceThatCannotBeFoundIsListedNotPassed() async {
        let transport = runTransport()
        let lookup = LexiconSchemaLookup(http: HTTPClient(transport: transport))
        let record = Self.record(["embed": ["$type": "com.example.embed.images"]])
        let check = await V.check(record: record, nsid: "com.example.post", lookup: lookup)
        XCTAssertEqual(check.lookups.map(\.status), [.found, .noAuthority])
        XCTAssertEqual(check.report.unresolved, ["com.example.embed.images"])
        XCTAssertEqual(check.verdict, .valid)
    }

    func testVerdicts() async {
        let transport = runTransport()
        let lookup = LexiconSchemaLookup(http: HTTPClient(transport: transport))
        let warned = await V.check(record: Self.record(["visibility": "circle"]), nsid: "com.example.post", lookup: lookup)
        XCTAssertEqual(warned.verdict, .warnings)
        let unknown = await V.check(record: ["$type": "org.nobody.thing"], nsid: "org.nobody.thing", lookup: lookup)
        XCTAssertEqual(unknown.verdict, .noSchema)
        XCTAssertEqual(V.noSchemaReason(.unpublished(nsid: "x", authority: .init(did: F.did, via: .dns))),
                       "The namespace has an owner, but no schema record has been published for this type.")
        XCTAssertEqual(V.noSchemaReason(.invalid(nsid: "x")), "That type is not a valid NSID.")
    }

    // MARK: The screen

    @MainActor
    func testTheModelChecksAPastedRecordWithoutPuttingItInTheLink() async {
        let model = RecordValidatorModel(http: HTTPClient(transport: runTransport()), lookup: LexiconSchemaLookup(http: HTTPClient(transport: runTransport())))
        _ = await model.submit(#"{"$type":"com.example.post","text":5}"#)?.value
        XCTAssertEqual(model.state.value?.check.verdict, .invalid)
        XCTAssertNil(model.state.value?.uri)
        XCTAssertEqual(model.shareQuery, [:])
    }

    @MainActor
    func testTheModelFetchesARecordByAddress() async {
        let transport = runTransport()
        let model = RecordValidatorModel(http: HTTPClient(transport: transport), lookup: LexiconSchemaLookup(http: HTTPClient(transport: transport)))
        let address = "at://\(F.did)/com.example.post/3n22yg6lg2k2f"
        _ = await model.submit(address)?.value
        XCTAssertEqual(model.state.value?.uri, address)
        XCTAssertEqual(model.state.value?.record["text"]?.stringValue, "networked")
        XCTAssertEqual(model.state.value?.check.verdict, .valid)
        XCTAssertEqual(model.shareQuery, ["uri": address])
    }

    @MainActor
    func testTheModelSaysWhenTheRecordCannotBeRead() async {
        let transport = SchemaLookupFakeTransport([])
        let model = RecordValidatorModel(http: HTTPClient(transport: transport), lookup: LexiconSchemaLookup(http: HTTPClient(transport: transport)))
        _ = await model.submit("at://\(F.did)/com.example.post/3n22yg6lg2k2f")?.value
        XCTAssertEqual(model.state.errorMessage, "That record could not be read. It may have been deleted, or its repository may be unreachable.")

        XCTAssertNil(model.submit(""))
        XCTAssertEqual(model.inputProblem, "Paste a record as JSON, or the at:// URI of one.")
        XCTAssertTrue(model.state.isIdle)
    }
}
