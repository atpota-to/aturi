import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Port of src/lib/tools/__tests__/xrpc.test.ts. The web's tests run over
/// every query in its API manifest; the app carries a subset
/// (`XrpcMethodIndex`), so they run over that, and a drift test checks the
/// subset against the manifest in the checkout.
final class XrpcConsoleTests: XCTestCase {
    static let queries = XrpcConsole.queries(from: XrpcMethodIndex.methods)

    /// A published lexicon record, as com.atproto.lexicon.schema holds one:
    /// keys sorted, so `required` is the only thing that says what comes first.
    static let authorFeedJSON = #"""
    {
      "$type": "com.atproto.lexicon.schema",
      "lexicon": 1,
      "id": "app.bsky.feed.getAuthorFeed",
      "defs": {
        "main": {
          "type": "query",
          "description": "Get a view of an actor's 'author feed'.",
          "parameters": {
            "type": "params",
            "required": ["actor"],
            "properties": {
              "actor": { "type": "string", "format": "at-identifier" },
              "cursor": { "type": "string" },
              "filter": {
                "type": "string",
                "default": "posts_with_replies",
                "description": "Combinations of post/repost types to include in response.",
                "knownValues": ["posts_with_replies", "posts_no_replies"]
              },
              "includePins": { "type": "boolean", "default": false },
              "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 50 }
            }
          },
          "output": { "encoding": "application/json" },
          "errors": [{ "name": "BlockedActor" }, { "name": "BlockedByActor" }]
        }
      }
    }
    """#

    static let getPostsJSON = #"""
    {
      "defs": {
        "main": {
          "type": "query",
          "parameters": {
            "type": "params",
            "required": ["uris"],
            "properties": { "uris": { "type": "array", "items": { "type": "string", "format": "at-uri" }, "maxLength": 25 } }
          }
        }
      }
    }
    """#

    static func json(_ text: String) -> JSONValue {
        (try? JSONValue.parse(Data(text.utf8))) ?? .null
    }

    private var authorFeed: JSONValue { Self.json(Self.authorFeedJSON) }
    private var getPosts: JSONValue { Self.json(Self.getPostsJSON) }

    // MARK: The method list

    func testTheListIsQueriesAndNothingElse() {
        let queries = Self.queries
        XCTAssertGreaterThan(queries.count, 40)
        XCTAssertTrue(queries.allSatisfy { $0.type == "query" })
        XCTAssertTrue(queries.contains { $0.nsid == "app.bsky.actor.getProfile" })
        XCTAssertFalse(queries.contains { $0.nsid == "com.atproto.repo.createRecord" })
        XCTAssertTrue(queries.allSatisfy { XrpcConsole.looksLikeMethodNsid($0.nsid) }, "every listed NSID is well formed")
        XCTAssertEqual(Set(queries.map(\.nsid)).count, queries.count)
        XCTAssertEqual(queries.first?.raw?.absoluteString, "https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/actor/getProfile.json")
    }

    func testMethodsGroupByNamespaceAndFamiliesNameTheFilter() {
        let groups = XrpcConsole.groupMethods(Self.queries)
        let feed = groups.first { $0.namespace == "app.bsky.feed" }
        XCTAssertTrue(feed?.methods.contains { $0.nsid == "app.bsky.feed.getAuthorFeed" } ?? false)
        XCTAssertEqual(groups.reduce(0) { $0 + $1.methods.count }, Self.queries.count)
        let families = XrpcConsole.familiesOf(Self.queries)
        XCTAssertTrue(families.contains("app.bsky") && families.contains("com.atproto"))
    }

    func testSearchRanksTheMethodNameFirstAndFindsAMethodByWhatItDoes() {
        let queries = Self.queries
        XCTAssertEqual(XrpcConsole.searchMethods(queries, query: "getProfile").first?.nsid, "app.bsky.actor.getProfile")
        XCTAssertEqual(XrpcConsole.searchMethods(queries, query: "com.atproto.repo.listRecords").first?.nsid, "com.atproto.repo.listRecords")
        XCTAssertTrue(XrpcConsole.searchMethods(queries, query: "list records").contains { $0.nsid == "com.atproto.repo.listRecords" })
        XCTAssertTrue(XrpcConsole.searchMethods(queries, query: "followers").contains { $0.nsid == "app.bsky.graph.getFollowers" })
        XCTAssertEqual(XrpcConsole.searchMethods(queries, query: "zzzznotamethod"), [])
        XCTAssertEqual(XrpcConsole.searchMethods(queries, query: "", limit: 5).count, 5)
    }

    func testLooksLikeMethodNsidAcceptsMethodNamesAndRejectsTheRest() {
        XCTAssertTrue(XrpcConsole.looksLikeMethodNsid("app.bsky.actor.getProfile"))
        XCTAssertTrue(XrpcConsole.looksLikeMethodNsid("blue.microcosm.identity.resolveMiniDoc"))
        XCTAssertFalse(XrpcConsole.looksLikeMethodNsid("getProfile"))
        XCTAssertFalse(XrpcConsole.looksLikeMethodNsid("bsky.app"))
        XCTAssertFalse(XrpcConsole.looksLikeMethodNsid("app.bsky.actor.get-profile"))
        XCTAssertFalse(XrpcConsole.looksLikeMethodNsid("app..getProfile"))
        XCTAssertFalse(XrpcConsole.looksLikeMethodNsid("https://bsky.app/xrpc/app.bsky.actor.getProfile"))
    }

    func testATypedNSIDTheListLacksCanStillBeOpened() {
        let unlisted = XrpcConsole.unlistedMethod(Self.queries, query: " blue.microcosm.identity.resolveMiniDoc ")
        XCTAssertEqual(unlisted?.nsid, "blue.microcosm.identity.resolveMiniDoc")
        XCTAssertEqual(unlisted?.listed, false)
        XCTAssertNil(unlisted?.raw)
        XCTAssertNil(XrpcConsole.unlistedMethod(Self.queries, query: "app.bsky.actor.getProfile"), "a listed method is not unlisted")
        XCTAssertNil(XrpcConsole.unlistedMethod(Self.queries, query: "getProfile"))
    }

    // MARK: Parameters

    func testParametersComeFromTheLexiconRequiredOnesFirst() {
        let set = XrpcConsole.paramSet(fromLexicon: authorFeed, fallbackNames: ["actor"])
        XCTAssertEqual(set.source, .lexicon)
        XCTAssertEqual(set.specs.map(\.name), ["actor", "cursor", "filter", "includePins", "limit"])
        let actor = set.specs[0]
        let filter = set.specs[2]
        let includePins = set.specs[3]
        let limit = set.specs[4]
        XCTAssertEqual(actor.kind, .string)
        XCTAssertTrue(actor.required)
        XCTAssertEqual(actor.format, "at-identifier")
        XCTAssertEqual(filter.knownValues, ["posts_with_replies", "posts_no_replies"])
        XCTAssertEqual(filter.defaultValue, "posts_with_replies")
        XCTAssertEqual(includePins.kind, .boolean)
        XCTAssertEqual(includePins.defaultValue, "false")
        XCTAssertEqual(limit.kind, .integer)
        XCTAssertEqual(limit.minimum, 1)
        XCTAssertEqual(limit.maximum, 100)
        XCTAssertEqual(limit.defaultValue, "50")
        XCTAssertEqual(limit.typeLine(lexiconKnown: true), "integer, 1 to 100")
        XCTAssertEqual(actor.typeLine(lexiconKnown: true), "string, at-identifier")
    }

    func testAnArrayParameterKnowsWhatItsItemsAre() {
        let uris = XrpcConsole.paramSet(fromLexicon: getPosts, fallbackNames: []).specs[0]
        XCTAssertEqual(uris.kind, .array)
        XCTAssertEqual(uris.itemKind, .string)
        XCTAssertEqual(uris.format, "at-uri")
        XCTAssertTrue(uris.required)
        XCTAssertEqual(uris.maxLength, 25)
        XCTAssertEqual(uris.typeLine(lexiconKnown: true), "list of string, at-uri, up to 25")
    }

    func testWithoutALexiconTheNamesAloneMakeTextFields() {
        let set = XrpcConsole.paramSet(fromLexicon: nil, fallbackNames: ["limit", "cursor"])
        XCTAssertEqual(set.source, .names)
        XCTAssertEqual(set.specs.map(\.name), ["limit", "cursor"])
        XCTAssertTrue(set.specs.allSatisfy { $0.kind == .unknown && !$0.required })
        // A lexicon with no parameters at all is still a lexicon: nothing to fill in.
        XCTAssertEqual(
            XrpcConsole.paramSet(fromLexicon: Self.json(#"{"defs":{"main":{"type":"query"}}}"#), fallbackNames: ["x"]),
            XrpcParamSet(specs: [], source: .lexicon)
        )
    }

    func testSummarizeMethodLexiconReadsTheTypeTheOutputAndTheNamedErrors() {
        XCTAssertEqual(XrpcConsole.summarizeMethodLexicon(authorFeed), XrpcLexiconSummary(
            type: "query",
            description: "Get a view of an actor's 'author feed'.",
            outputEncoding: "application/json",
            errors: [
                XrpcLexiconSummary.NamedError(name: "BlockedActor"),
                XrpcLexiconSummary.NamedError(name: "BlockedByActor"),
            ]
        ))
        XCTAssertNil(XrpcConsole.summarizeMethodLexicon(Self.json("{}")).type)
    }

    func testCleanValuesAndMissingRequiredIgnoreBlanks() {
        XCTAssertEqual(XrpcConsole.cleanValues(["a": [" x ", ""], "b": ["  "], "c": []]), ["a": ["x"]])
        let specs = XrpcConsole.paramSet(fromLexicon: authorFeed, fallbackNames: []).specs
        XCTAssertEqual(XrpcConsole.missingRequired(specs, values: [:]), ["actor"])
        XCTAssertEqual(XrpcConsole.missingRequired(specs, values: ["actor": ["  "]]), ["actor"])
        XCTAssertEqual(XrpcConsole.missingRequired(specs, values: ["actor": ["bsky.app"]]), [])
    }

    func testAParameterTheLexiconDoesNotListStillGetsAField() {
        let specs = XrpcConsole.paramSet(fromLexicon: authorFeed, fallbackNames: []).specs
        XCTAssertEqual(XrpcConsole.withExtraParams(specs, values: ["actor": ["bsky.app"]]), specs)
        let fields = XrpcConsole.withExtraParams(specs, values: ["actor": ["bsky.app"], "zeta": ["1"], "alpha": [""]])
        let extras = Array(fields.dropFirst(specs.count))
        XCTAssertEqual(extras.map(\.name), ["alpha", "zeta"])
        XCTAssertTrue(extras.allSatisfy { $0.kind == .unknown && $0.extra })
        XCTAssertEqual(extras[0].typeLine(lexiconKnown: true), "not in the lexicon")
        XCTAssertTrue(XrpcConsole.isParamName("includePins"))
        XCTAssertTrue(XrpcConsole.isParamName("wanted_dids"))
        XCTAssertFalse(XrpcConsole.isParamName(""))
        XCTAssertFalse(XrpcConsole.isParamName("p.actor"))
        XCTAssertFalse(XrpcConsole.isParamName("a b"))
        XCTAssertFalse(XrpcConsole.isParamName("1st"))
    }

    // MARK: Hosts

    func testEachNamespaceHasASensibleDefaultHost() {
        XCTAssertEqual(XrpcConsole.defaultHost(for: "app.bsky.actor.getProfile"), .appview)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.identity.resolveHandle"), .appview)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.repo.listRecords"), .pds)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.sync.getRepoStatus"), .pds)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.server.describeServer"), .pds)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.sync.getHostStatus"), .relay)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.sync.listReposByCollection"), .relay)
        // Served by whoever runs the feed, the labeler or the Ozone instance.
        XCTAssertEqual(XrpcConsole.defaultHost(for: "app.bsky.feed.getFeedSkeleton"), .other)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "com.atproto.label.queryLabels"), .other)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "tools.ozone.moderation.queryEvents"), .other)
        XCTAssertEqual(XrpcConsole.defaultHost(for: "blue.microcosm.identity.resolveMiniDoc"), .other)
        XCTAssertEqual(XrpcConsole.fixedOrigin(for: .appview), "https://public.api.bsky.app")
        XCTAssertEqual(XrpcConsole.fixedOrigin(for: .relay), "https://relay1.us-east.bsky.network")
        XCTAssertNil(XrpcConsole.fixedOrigin(for: .pds))
        // The three relay methods are real queries in the index, not guesses.
        for nsid in ["com.atproto.sync.getHostStatus", "com.atproto.sync.listHosts", "com.atproto.sync.listReposByCollection"] {
            XCTAssertTrue(Self.queries.contains { $0.nsid == nsid }, "\(nsid) is not in the index")
        }
    }

    func testNormalizeHostURLTurnsATypedHostIntoAnOrigin() {
        XCTAssertEqual(XrpcConsole.normalizeHostURL("pds.example.com"), .ok(origin: "https://pds.example.com"))
        XCTAssertEqual(XrpcConsole.normalizeHostURL(" https://pds.example.com/xrpc/x?y=1 "), .ok(origin: "https://pds.example.com"))
        XCTAssertEqual(XrpcConsole.normalizeHostURL("http://localhost:2583"), .ok(origin: "http://localhost:2583"))
        XCTAssertEqual(XrpcConsole.normalizeHostURL("HTTPS://PDS.Example.com:443/"), .ok(origin: "https://pds.example.com"))
        XCTAssertFalse(XrpcConsole.normalizeHostURL("http://pds.example.com").isOK)
        XCTAssertEqual(XrpcConsole.normalizeHostURL("ftp://pds.example.com"), .invalid(reason: "XRPC is served over https."))
        XCTAssertEqual(XrpcConsole.normalizeHostURL("https://user:pw@pds.example.com"), .invalid(reason: "Leave credentials out of the host."))
        XCTAssertFalse(XrpcConsole.normalizeHostURL("").isOK)
        XCTAssertEqual(XrpcConsole.normalizeHostURL("not a host"), .invalid(reason: "That is not a host name or URL."))
        XCTAssertFalse(XrpcConsole.normalizeHostURL("pds.example.com:99999").isOK)
    }

    // MARK: The link

    private func request(_ search: String) -> XrpcConsoleRequest {
        XrpcConsole.request(from: NetworkToolQuery.decode(search))
    }

    func testARequestSurvivesTheTripThroughTheQueryString() {
        let original = XrpcConsoleRequest(
            method: "app.bsky.feed.getPosts",
            host: .appview,
            params: ["uris": ["at://did:plc:a/app.bsky.feed.post/1", "at://did:plc:a/app.bsky.feed.post/2"]]
        )
        let search = XrpcConsole.search(for: original)
        // The default host is left out, and a list repeats its key.
        XCTAssertEqual(
            search,
            "method=app.bsky.feed.getPosts&p.uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F1&p.uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F2"
        )
        XCTAssertEqual(request(search), original)
    }

    func testHostAcctAndUrlAreWrittenOnlyWhereTheyMeanSomething() {
        let params: XrpcParamValues = ["repo": ["bsky.app"], "collection": ["app.bsky.feed.post"]]
        let method = "com.atproto.repo.listRecords"
        XCTAssertEqual(
            XrpcConsole.search(for: XrpcConsoleRequest(method: method, host: .pds, url: "https://ignored.example", params: params)),
            "method=com.atproto.repo.listRecords&p.collection=app.bsky.feed.post&p.repo=bsky.app"
        )
        XCTAssertTrue(XrpcConsole.search(for: XrpcConsoleRequest(method: method, host: .pds, acct: "jay.bsky.team", params: params)).contains("&acct=jay.bsky.team&"))
        let other = XrpcConsole.search(for: XrpcConsoleRequest(method: method, host: .other, acct: "ignored", url: "https://pds.example.com", params: params))
        XCTAssertTrue(other.contains("host=other&url=https%3A%2F%2Fpds.example.com"))
        XCTAssertFalse(other.contains("acct="))
        XCTAssertEqual(XrpcConsole.search(for: .empty), "")
    }

    func testALinkWithNoHostGetsTheMethodsDefaultAndAMethodsOwnNamesCannotCollide() {
        let linked = request("method=com.atproto.sync.getHostStatus&p.hostname=bsky.social&host=nonsense&p.host=x&p.=y")
        XCTAssertEqual(linked.host, .relay)
        XCTAssertEqual(linked.params, ["hostname": ["bsky.social"], "host": ["x"]])
    }

    func testAPDSRequestGoesToTheNamedAccountOrTheRepoItIsAbout() {
        XCTAssertEqual(XrpcConsole.pdsAccount(acct: "@jay.bsky.team", params: ["repo": ["bsky.app"]]), "jay.bsky.team")
        XCTAssertEqual(XrpcConsole.pdsAccount(acct: "", params: ["repo": ["bsky.app"]]), "bsky.app")
        XCTAssertEqual(XrpcConsole.pdsAccount(acct: "", params: ["did": ["did:plc:abc"]]), "did:plc:abc")
        XCTAssertNil(XrpcConsole.pdsAccount(acct: "", params: ["limit": ["5"]]))
    }

    func testALinkedRequestIsSentOnItsOwnOnlyWhenNothingIsMissing() {
        let set = XrpcConsole.paramSet(fromLexicon: authorFeed, fallbackNames: [])
        func make(method: String = "app.bsky.feed.getAuthorFeed", host: XrpcHostChoice = .appview, url: String = "", params: XrpcParamValues = ["actor": ["bsky.app"]]) -> XrpcConsoleRequest {
            XrpcConsoleRequest(method: method, host: host, url: url, params: params)
        }
        XCTAssertTrue(XrpcConsole.isComplete(make(), paramSet: set))
        XCTAssertFalse(XrpcConsole.isComplete(make(params: [:]), paramSet: set))
        XCTAssertFalse(XrpcConsole.isComplete(make(method: ""), paramSet: set))
        // The lexicon has not arrived, or never will: nothing is known to be optional.
        XCTAssertFalse(XrpcConsole.isComplete(make(), paramSet: nil))
        XCTAssertFalse(XrpcConsole.isComplete(make(), paramSet: XrpcConsole.paramSet(fromLexicon: nil, fallbackNames: ["actor"])))
        // A host that has to be resolved or typed needs something to go on.
        XCTAssertTrue(XrpcConsole.isComplete(make(host: .pds), paramSet: set))
        XCTAssertFalse(XrpcConsole.isComplete(make(host: .pds, params: ["actor": [""]]), paramSet: set))
        XCTAssertFalse(XrpcConsole.isComplete(make(host: .other), paramSet: set))
        XCTAssertTrue(XrpcConsole.isComplete(make(host: .other, url: "pds.example.com"), paramSet: set))
    }

    // MARK: The request and the response

    func testBuildRequestURLOrdersParametersByTheLexiconAndRepeatsAList() {
        let specs = XrpcConsole.paramSet(fromLexicon: authorFeed, fallbackNames: []).specs
        XCTAssertEqual(
            XrpcConsole.buildRequestURL(
                origin: "https://public.api.bsky.app/",
                nsid: "app.bsky.feed.getAuthorFeed",
                values: ["limit": ["5"], "actor": [" bsky.app "], "cursor": [""], "zz": ["1"]],
                specs: specs
            ),
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=5&zz=1"
        )
        XCTAssertEqual(
            XrpcConsole.buildRequestURL(origin: "https://public.api.bsky.app", nsid: "app.bsky.feed.getPosts", values: ["uris": ["at://a/b/c", "at://d/e/f"]]),
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fa%2Fb%2Fc&uris=at%3A%2F%2Fd%2Fe%2Ff"
        )
        XCTAssertEqual(
            XrpcConsole.buildRequestURL(origin: "https://pds.example.com", nsid: "com.atproto.server.describeServer", values: [:]),
            "https://pds.example.com/xrpc/com.atproto.server.describeServer"
        )
    }

    func testCurlQuotesTheURLForAShell() {
        XCTAssertEqual(XrpcConsole.curl(for: "https://h.example/xrpc/a.b.c?x=1&y=2"), "curl 'https://h.example/xrpc/a.b.c?x=1&y=2'")
        XCTAssertEqual(XrpcConsole.curl(for: "https://h.example/xrpc/a.b.c?q=it's"), "curl 'https://h.example/xrpc/a.b.c?q=it'\\''s'")
    }

    func testResponsesAreReadForFailuresCursorsAndWhatCanBeShown() {
        XCTAssertEqual(XrpcConsole.readXrpcFailure(Self.json(#"{"error":"InvalidRequest","message":"Profile not found"}"#)), XrpcFailure(error: "InvalidRequest", message: "Profile not found"))
        XCTAssertEqual(XrpcConsole.readXrpcFailure(Self.json(#"{"error":"AuthMissing"}"#)), XrpcFailure(error: "AuthMissing", message: nil))
        XCTAssertNil(XrpcConsole.readXrpcFailure(Self.json(#"{"records":[]}"#)))
        XCTAssertNil(XrpcConsole.readXrpcFailure(.string("nope")))
        XCTAssertEqual(XrpcConsole.nextCursor(Self.json(#"{"cursor":"abc","records":[]}"#)), "abc")
        XCTAssertNil(XrpcConsole.nextCursor(Self.json(#"{"cursor":""}"#)))
        XCTAssertNil(XrpcConsole.nextCursor(Self.json("[]")))
        XCTAssertTrue(XrpcConsole.isTextual("application/json; charset=utf-8"))
        XCTAssertTrue(XrpcConsole.isTextual("text/plain"))
        XCTAssertTrue(XrpcConsole.isTextual(nil))
        XCTAssertFalse(XrpcConsole.isTextual("application/vnd.ipld.car"))
        XCTAssertFalse(XrpcConsole.isTextual("image/jpeg"))
    }

    func testSizesAndTimesReadAtAGlance() {
        XCTAssertEqual(XrpcConsole.formatBytes(512), "512 B")
        XCTAssertEqual(XrpcConsole.formatBytes(3276), "3.2 KB")
        XCTAssertEqual(XrpcConsole.formatBytes(48 * 1024), "48 KB")
        XCTAssertEqual(XrpcConsole.formatBytes(3 * 1024 * 1024), "3.0 MB")
        XCTAssertEqual(XrpcConsole.formatDuration(142.4), "142 ms")
        XCTAssertEqual(XrpcConsole.formatDuration(2345), "2.35 s")
        XCTAssertEqual(XrpcConsole.statusLine(404), "404 Not Found")
        XCTAssertEqual(XrpcConsole.statusLine(418), "418")
        XCTAssertEqual(XrpcConsole.sentence("Profile not found"), "Profile not found. ")
        XCTAssertEqual(XrpcConsole.sentence("Done!"), "Done! ")
    }

    // MARK: Drift

    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AturiCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AturiCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
    }

    /// Every method the app lists is a query in the web's manifest, with the
    /// same description and parameter names.
    func testTheIndexMatchesTheWebManifest() throws {
        let file = repoRoot.appendingPathComponent("src/lib/mcp/apiManifest.ts")
        guard let source = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("web API manifest not available at \(file.path)")
        }
        let marker = "export const API_METHODS: ApiMethod[] = "
        guard let start = source.range(of: marker) else {
            return XCTFail("the manifest no longer declares API_METHODS")
        }
        var body = String(source[start.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if body.hasSuffix(";") { body.removeLast() }
        let manifest = try JSONValue.parse(Data(body.utf8))
        var byNsid: [String: JSONValue] = [:]
        for entry in manifest.arrayValue ?? [] {
            if let nsid = entry["nsid"]?.stringValue { byNsid[nsid] = entry }
        }
        XCTAssertGreaterThan(byNsid.count, 100)
        for method in XrpcMethodIndex.methods {
            guard let entry = byNsid[method.nsid] else {
                XCTFail("\(method.nsid) is not in the web manifest")
                continue
            }
            XCTAssertEqual(entry["type"]?.stringValue, "query", method.nsid)
            XCTAssertEqual(entry["description"]?.stringValue, method.description, method.nsid)
            XCTAssertEqual((entry["params"]?.arrayValue ?? []).compactMap(\.stringValue), method.params, method.nsid)
            XCTAssertEqual(entry["raw"]?.stringValue, method.raw?.absoluteString, method.nsid)
        }
    }
}

// MARK: - The model

/// Substring-routed transport: a route matches when every one of its
/// fragments appears in the URL; the first match wins, the rest 404.
private final class XrpcFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var contentType = "application/json"
    }

    private let lock = NSLock()
    private let routes: [(patterns: [String], reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [([String], Reply)]) {
        self.routes = routes.map { (patterns: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = route(for: url.absoluteString)
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": reply.contentType, "RateLimit-Remaining": "2999"]
        )!
        return (Data(reply.body.utf8), response)
    }

    private func route(for url: String) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
        return routes.first { $0.patterns.allSatisfy(url.contains) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
}

@MainActor
final class XrpcConsoleModelTests: XCTestCase {
    private let profileLexicon = #"{"lexicon":1,"id":"app.bsky.actor.getProfile","defs":{"main":{"type":"query","description":"Get detailed profile view of an actor.","parameters":{"type":"params","required":["actor"],"properties":{"actor":{"type":"string","format":"at-identifier"}}},"errors":[{"name":"ProfileGone","description":"The profile is gone."}]}}}"#

    private func makeModel(_ query: [String: String], _ routes: [([String], XrpcFakeTransport.Reply)]) -> (XrpcConsoleModel, XrpcFakeTransport) {
        let transport = XrpcFakeTransport(routes)
        let request = XrpcConsole.request(from: NetworkToolQuery.items(from: query))
        let model = XrpcConsoleModel(request: request, http: HTTPClient(transport: transport), cachesLexicons: false)
        return (model, transport)
    }

    /// Wait for the model's own tasks (a lexicon, a request) to land.
    private func waitUntil(_ condition: () -> Bool) async {
        var tries = 0
        while !condition() && tries < 300 {
            tries += 1
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    /// The published lexicon: `_lexicon.actor.bsky.app` names a DID, and
    /// Slingshot has the schema record.
    private var publishedRoutes: [([String], XrpcFakeTransport.Reply)] {
        [
            (["dns.google", "_lexicon.actor.bsky.app"], .init(status: 200, body: #"{"Status":0,"Answer":[{"type":16,"data":"\"did=did:plc:lexicons\""}]}"#)),
            (["getRecordByUri", "did%3Aplc%3Alexicons", "app.bsky.actor.getProfile"], .init(status: 200, body: #"{"uri":"at://did:plc:lexicons/com.atproto.lexicon.schema/app.bsky.actor.getProfile","cid":"bafy","value":\#(profileLexicon)}"#)),
        ]
    }

    func testAWholeLinkedRequestIsSentOnItsOwn() async {
        let (model, transport) = makeModel(
            ["method": "app.bsky.actor.getProfile", "p.actor": "bsky.app"],
            publishedRoutes + [
                (["public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app"], .init(status: 200, body: #"{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app"}"#)),
            ]
        )
        model.start()
        await waitUntil { model.run.value != nil }
        XCTAssertEqual(model.lexicon.value?.source, .published)
        XCTAssertEqual(model.lexicon.value?.description, "Get detailed profile view of an actor.")
        let result = model.run.value
        XCTAssertEqual(result?.kind, .text)
        XCTAssertEqual(result?.status, 200)
        XCTAssertEqual(result?.title, "200 OK")
        XCTAssertEqual(result?.json?["handle"]?.stringValue, "bsky.app")
        XCTAssertEqual(result?.rateRemaining, "2999")
        XCTAssertTrue(result?.facts.contains("application/json") ?? false)
        XCTAssertEqual(model.previewURL, "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app")
        XCTAssertTrue(transport.urls.contains { $0.contains("_lexicon.actor.bsky.app") })
    }

    func testAnErrorStatusIsAResultThatExplainsItself() async {
        let (model, _) = makeModel(
            ["method": "app.bsky.actor.getProfile", "p.actor": "gone.example"],
            publishedRoutes + [
                (["app.bsky.actor.getProfile?actor=gone.example"], .init(status: 400, body: #"{"error":"ProfileGone","message":"Profile not found"}"#)),
            ]
        )
        model.start()
        await waitUntil { model.run.value != nil }
        let result = model.run.value
        XCTAssertEqual(result?.title, "400 Bad Request: ProfileGone")
        XCTAssertEqual(result?.explanation(summary: model.lexicon.value?.summary), "Profile not found. The profile is gone.")
    }

    func testAPickedMethodIsNotSentUntilAsked() async {
        let (model, transport) = makeModel([:], [
            (["raw.githubusercontent.com", "com/atproto/server/describeServer.json"], .init(status: 200, body: #"{"defs":{"main":{"type":"query","description":"Describes the server."}}}"#)),
        ])
        model.start()
        XCTAssertFalse(model.methodValid)
        model.pick("com.atproto.server.describeServer")
        XCTAssertEqual(model.request.host, .pds)
        await waitUntil { model.lexicon.value != nil }
        XCTAssertEqual(model.lexicon.value?.source, .repository, "nothing published, so the copy in the atproto repository")
        XCTAssertEqual(model.lexicon.value?.paramSet.specs, [])
        XCTAssertTrue(model.run.isIdle, "choosing a method is not a request to send it")
        XCTAssertFalse(transport.urls.contains { $0.contains("/xrpc/com.atproto.server.describeServer") })

        model.submit()
        await waitUntil { !model.run.isLoading }
        XCTAssertEqual(model.run.errorMessage, "Name the account whose PDS should answer, or send the request somewhere else.")
    }

    func testAPDSRequestGoesToTheHostOfTheRepoItIsAbout() async {
        let (model, transport) = makeModel([:], [
            (["resolveMiniDoc", "identifier=alice.example.com"], .init(status: 200, body: #"{"did":"did:plc:alice","handle":"alice.example.com","pds":"https://pds.example.com/"}"#)),
            (["pds.example.com/xrpc/com.atproto.repo.listRecords"], .init(status: 200, body: #"{"records":[],"cursor":"next1"}"#)),
        ])
        model.start()
        model.send(XrpcConsoleRequest(method: "com.atproto.repo.listRecords", host: .pds, params: ["repo": ["alice.example.com"], "collection": ["app.bsky.feed.post"]]))
        await waitUntil { model.run.value != nil }
        XCTAssertEqual(model.run.value?.origin, "https://pds.example.com")
        // Sent before the lexicon arrived, so the parameters go by name.
        XCTAssertTrue(transport.urls.contains("https://pds.example.com/xrpc/com.atproto.repo.listRecords?collection=app.bsky.feed.post&repo=alice.example.com"))
        XCTAssertEqual(model.previewOrigin, "https://pds.example.com", "the resolved PDS fills in the preview")
        XCTAssertEqual(XrpcConsole.nextCursor(model.run.value?.json), "next1")
    }

    func testABinaryResponseIsNotRead() async {
        let (model, _) = makeModel([:], [
            (["pds.example.com/xrpc/com.atproto.sync.getBlob"], .init(status: 200, body: "JFIF", contentType: "image/jpeg")),
        ])
        model.start()
        model.send(XrpcConsoleRequest(method: "com.atproto.sync.getBlob", host: .other, url: "pds.example.com", params: ["did": ["did:plc:a"], "cid": ["bafk"]]))
        await waitUntil { model.run.value != nil }
        XCTAssertEqual(model.run.value?.kind, .binary)
        XCTAssertEqual(model.run.value?.contentType, "image/jpeg")
        XCTAssertEqual(model.run.value?.bytes, 4)
        XCTAssertEqual(model.run.value?.text, "")
    }

    func testANextPageSendsTheCursor() async {
        let (model, transport) = makeModel([:], [
            (["listHosts", "cursor=c2"], .init(status: 200, body: #"{"hosts":[]}"#)),
            (["relay1.us-east.bsky.network/xrpc/com.atproto.sync.listHosts"], .init(status: 200, body: #"{"hosts":[],"cursor":"c2"}"#)),
        ])
        model.start()
        model.runExample(XrpcConsoleModel.examples[3])
        await waitUntil { model.run.value != nil }
        XCTAssertEqual(model.request.method, "com.atproto.sync.listHosts")
        XCTAssertEqual(XrpcConsole.nextCursor(model.run.value?.json), "c2")
        model.nextPage("c2")
        XCTAssertEqual(model.request.params["cursor"], ["c2"])
        XCTAssertEqual(model.queryItems.map { $0.0 }, ["method", "p.cursor", "p.limit"])
        await waitUntil { model.run.value != nil && XrpcConsole.nextCursor(model.run.value?.json) == nil }
        XCTAssertTrue(transport.urls.contains { $0.contains("listHosts?limit=5&cursor=c2") || $0.contains("listHosts?cursor=c2&limit=5") })
    }

    func testTheMethodFieldFindsAndOpens() {
        let (model, _) = makeModel([:], [])
        model.methodQuery = "getFollowers"
        XCTAssertEqual(model.searchResults.rows.first?.nsid, "app.bsky.graph.getFollowers")
        model.pickFirstMatch()
        XCTAssertEqual(model.request.method, "app.bsky.graph.getFollowers")
        XCTAssertTrue(model.pickerMatches.isEmpty, "the field shows the open method, so nothing to offer")
        model.methodQuery = "listRecords"
        XCTAssertEqual(model.pickerMatches.first?.nsid, "com.atproto.repo.listRecords")
        model.showAllMethods()
        XCTAssertFalse(model.methodValid)
        XCTAssertEqual(model.groups(family: "com.atproto").first?.namespace, "com.atproto.identity")
    }
}
