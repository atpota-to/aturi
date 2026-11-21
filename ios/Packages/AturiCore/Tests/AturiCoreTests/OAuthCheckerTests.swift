import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Port of src/lib/tools/__tests__/oauth.test.ts and oauthScopes.test.ts, and
// of the OAuth route's read (src/app/api/tools/oauth/route.ts) against a
// scripted transport.

private let clientID = "https://app.example.com/oauth-client-metadata.json"

/// A public web client that meets every rule.
private let publicWeb: [String: JSONValue] = [
    "client_id": .string(clientID),
    "client_name": "Example",
    "client_uri": "https://app.example.com",
    "logo_uri": "https://app.example.com/logo.png",
    "tos_uri": "https://app.example.com/terms",
    "policy_uri": "https://app.example.com/privacy",
    "redirect_uris": ["https://app.example.com/oauth/callback"],
    "scope": "atproto repo:com.example.post blob:*/*",
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "application_type": "web",
    "dpop_bound_access_tokens": true,
]

/// `{ ...PUBLIC_WEB, ...changes }`, where a nil value removes the field.
private func doc(_ changes: [String: JSONValue?] = [:], base: [String: JSONValue] = publicWeb) -> JSONValue {
    var out = base
    for (key, value) in changes {
        out[key] = value
    }
    return .object(out)
}

private func probe(
    _ document: JSONValue?,
    httpStatus: Int = 200,
    contentType: String? = "application/json",
    redirectedFrom: [String] = [],
    finalUrl: String = clientID,
    bodyProblem: String? = nil
) -> OAuthChecker.ClientMetadataProbe {
    OAuthChecker.ClientMetadataProbe(
        clientId: clientID,
        status: .answered,
        httpStatus: httpStatus,
        contentType: contentType,
        redirectedFrom: redirectedFrom,
        finalUrl: finalUrl,
        document: document,
        bodyProblem: bodyProblem
    )
}

private func statusOf(_ document: JSONValue, _ id: String) -> ServiceCheckStatus? {
    statusOf(probe(document), id)
}

private func statusOf(_ probe: OAuthChecker.ClientMetadataProbe, _ id: String) -> ServiceCheckStatus? {
    OAuthChecker.buildClientChecks(.done(probe), clientId: clientID).first { $0.id == id }?.status
}

private func assertMatches(_ text: String?, _ pattern: String, file: StaticString = #filePath, line: UInt = #line) {
    let value = text ?? ""
    XCTAssertNotNil(value.range(of: pattern, options: .regularExpression), "\(value) does not match \(pattern)", file: file, line: line)
}

final class OAuthCheckerTests: XCTestCase {
    func testParseClientIdAcceptsHttpsURLsAndTheLocalhostForm() {
        XCTAssertEqual(OAuthChecker.parseClientId(" \(clientID) "), .ok(kind: .hosted, clientId: clientID))
        // A bare host gains its scheme and nothing else changes.
        XCTAssertEqual(OAuthChecker.parseClientId("app.example.com/client.json"), .ok(kind: .hosted, clientId: "https://app.example.com/client.json"))
        XCTAssertEqual(OAuthChecker.parseClientId("http://localhost?scope=atproto"), .ok(kind: .loopback, clientId: "http://localhost?scope=atproto"))
        XCTAssertNotNil(OAuthChecker.parseClientId("").reason)
        XCTAssertNotNil(OAuthChecker.parseClientId("http://app.example.com/client.json").reason)
        XCTAssertNotNil(OAuthChecker.parseClientId("https://app.example.com:8443/client.json").reason)
        // The URL parser hides a default port; it still counts as a port.
        XCTAssertNotNil(OAuthChecker.parseClientId("https://app.example.com:443/client.json").reason)
        XCTAssertNotNil(OAuthChecker.parseClientId("https://user:pass@app.example.com/client.json").reason)
        XCTAssertNotNil(OAuthChecker.parseClientId("ftp://app.example.com/client.json").reason)
        XCTAssertNotNil(OAuthChecker.parseClientId("https://app example.com").reason)
    }

    func testADocumentThatMeetsEveryRulePassesEveryCheck() {
        let checks = OAuthChecker.buildClientChecks(.done(probe(doc())), clientId: clientID)
        XCTAssertEqual(checks.filter { $0.status != .pass }.map(\.id), [])
        XCTAssertEqual(OAuthChecker.clientVerdict(checks, kind: .hosted).tone, .pass)
    }

    /// The web pins its own confidential document; the app's own native
    /// one, as `OAuthClientMetadata.native` encodes it, has to pass too.
    func testTheAppsOwnNativeClientDocumentPasses() throws {
        let metadata = OAuthClientMetadata.native
        let document = try JSONValue.parse(JSONEncoder().encode(metadata))
        var read = probe(document)
        read.clientId = metadata.clientId
        read.finalUrl = metadata.clientId
        let checks = OAuthChecker.buildClientChecks(.done(read), clientId: metadata.clientId)
        XCTAssertEqual(checks.filter { $0.status == .fail || $0.status == .warn }.map { "\($0.id): \($0.summary)" }, [])
        XCTAssertEqual(OAuthChecker.clientKind(document), OAuthChecker.ClientKind(application: .native, confidential: false))
    }

    func testTheResponseItselfHasRules() {
        XCTAssertEqual(statusOf(doc(), "served"), .pass)
        XCTAssertEqual(statusOf(probe(doc(), contentType: "application/json; charset=utf-8"), "served"), .pass)
        XCTAssertEqual(statusOf(probe(doc(), contentType: "text/plain"), "served"), .fail)
        XCTAssertEqual(statusOf(probe(doc(), httpStatus: 203), "served"), .fail)
        XCTAssertEqual(statusOf(probe(doc(), redirectedFrom: [clientID], finalUrl: "https://www.example.com/c.json"), "served"), .fail)
        XCTAssertEqual(statusOf(["not", "an", "object"], "served"), .fail)
        // With no document the rest cannot be judged.
        let noBody = OAuthChecker.buildClientChecks(.done(probe(nil, httpStatus: 404, bodyProblem: "The body is not valid JSON.")), clientId: clientID)
        XCTAssertEqual(noBody.first?.status, .fail)
        XCTAssertTrue(noBody.dropFirst().allSatisfy { $0.status == .skip })
        let unreachable = OAuthChecker.buildClientChecks(
            .done(OAuthChecker.ClientMetadataProbe(clientId: clientID, status: .error, error: "the hostname does not resolve")),
            clientId: clientID
        )
        XCTAssertEqual(unreachable.first?.status, .fail)
        XCTAssertEqual(OAuthChecker.clientVerdict(unreachable, kind: .hosted).tone, .fail)
    }

    func testClientIdMustRepeatTheURLExactly() {
        XCTAssertEqual(statusOf(doc(["client_id": .string("\(clientID)/")]), "client_id"), .fail)
        XCTAssertEqual(statusOf(doc(["client_id": nil]), "client_id"), .fail)
    }

    func testTheRequiredFieldsAreRequired() {
        XCTAssertEqual(statusOf(doc(["grant_types": ["refresh_token"]]), "grant_types"), .fail)
        XCTAssertEqual(statusOf(doc(["grant_types": nil]), "grant_types"), .fail)
        XCTAssertEqual(statusOf(doc(["grant_types": ["authorization_code", "implicit"]]), "grant_types"), .warn)
        XCTAssertEqual(statusOf(doc(["grant_types": ["authorization_code"]]), "grant_types"), .pass)
        XCTAssertEqual(statusOf(doc(["response_types": ["token"]]), "response_types"), .fail)
        XCTAssertEqual(statusOf(doc(["dpop_bound_access_tokens": false]), "dpop"), .fail)
        XCTAssertEqual(statusOf(doc(["dpop_bound_access_tokens": nil]), "dpop"), .fail)
        XCTAssertEqual(statusOf(doc(["redirect_uris": []]), "redirect_uris"), .fail)
        XCTAssertEqual(statusOf(doc(["application_type": nil]), "application_type"), .info)
        XCTAssertEqual(statusOf(doc(["application_type": "mobile"]), "application_type"), .fail)
    }

    func testScopeMustBeAStringWithAtprotoInIt() {
        XCTAssertEqual(statusOf(doc(["scope": "repo:com.example.post"]), "scope"), .fail)
        XCTAssertEqual(statusOf(doc(["scope": ["atproto"]]), "scope"), .fail)
        XCTAssertEqual(statusOf(doc(["scope": "atproto"]), "scope"), .pass)
        // A scope that breaks the permission spec is a warning: the document is still usable.
        XCTAssertEqual(statusOf(doc(["scope": "atproto repo:com.example.*"]), "scope"), .warn)
        // A resource the spec does not define yet is allowed through.
        XCTAssertEqual(statusOf(doc(["scope": "atproto space:*?authority=*&action=read"]), "scope"), .pass)
    }

    func testRedirectURIsFollowTheClientType() {
        XCTAssertNil(OAuthChecker.redirectUriProblem("https://app.example.com/cb", application: .web, clientId: clientID))
        XCTAssertNil(OAuthChecker.redirectUriProblem("https://other.example.net:8443/cb", application: .web, clientId: clientID))
        assertMatches(OAuthChecker.redirectUriProblem("https://app.example.com:443/cb", application: .web, clientId: clientID), "default port")
        assertMatches(OAuthChecker.redirectUriProblem("http://app.example.com/cb", application: .web, clientId: clientID), "plain http")
        assertMatches(OAuthChecker.redirectUriProblem("com.example.app:/cb", application: .web, clientId: clientID), "https URL")

        XCTAssertEqual(OAuthChecker.reverseDomain("app.example.com"), "com.example.app")
        XCTAssertNil(OAuthChecker.redirectUriProblem("com.example.app:/callback", application: .native, clientId: clientID))
        XCTAssertNil(OAuthChecker.redirectUriProblem("https://app.example.com/callback", application: .native, clientId: clientID))
        assertMatches(OAuthChecker.redirectUriProblem("https://other.example.com/callback", application: .native, clientId: clientID), "origin")
        assertMatches(OAuthChecker.redirectUriProblem("com.other.app:/callback", application: .native, clientId: clientID), "in reverse")
        assertMatches(OAuthChecker.redirectUriProblem("com.example.app://callback", application: .native, clientId: clientID), "one slash")
        assertMatches(OAuthChecker.redirectUriProblem("com.example.app:callback", application: .native, clientId: clientID), "one slash")

        XCTAssertEqual(statusOf(doc(["application_type": "native", "redirect_uris": ["com.example.app:/callback"]]), "redirect_uris"), .pass)
        XCTAssertEqual(statusOf(doc(["redirect_uris": ["com.example.app:/callback"]]), "redirect_uris"), .fail)
    }

    func testClientAuthenticationPublicConfidentialAndNeither() {
        XCTAssertEqual(statusOf(doc(["token_endpoint_auth_method": nil]), "auth"), .pass)
        XCTAssertEqual(statusOf(doc(["token_endpoint_auth_method": "client_secret_basic"]), "auth"), .fail)
        XCTAssertEqual(statusOf(doc(["token_endpoint_auth_signing_alg": "none"]), "auth"), .fail)

        var confidential = publicWeb
        confidential["token_endpoint_auth_method"] = "private_key_jwt"
        confidential["token_endpoint_auth_signing_alg"] = "ES256"
        XCTAssertEqual(statusOf(doc(base: confidential), "auth"), .fail, "no key published")
        XCTAssertEqual(statusOf(doc(["jwks_uri": "https://app.example.com/jwks.json"], base: confidential), "auth"), .pass)
        XCTAssertEqual(statusOf(doc(["jwks_uri": "http://app.example.com/jwks.json"], base: confidential), "auth"), .fail)
        XCTAssertEqual(statusOf(doc(["jwks": ["keys": [["kty": "EC", "crv": "P-256", "x": "a", "y": "b"]]]], base: confidential), "auth"), .pass)
        XCTAssertEqual(statusOf(doc(["jwks": ["keys": []]], base: confidential), "auth"), .fail)
        XCTAssertEqual(
            statusOf(doc(["jwks": ["keys": [["kty": "EC"]]], "jwks_uri": "https://app.example.com/jwks.json"], base: confidential), "auth"),
            .fail
        )
        // A private key in a public document is the one mistake worth shouting about.
        XCTAssertEqual(statusOf(doc(["jwks": ["keys": [["kty": "EC", "d": "secret"]]]], base: confidential), "auth"), .fail)
        XCTAssertEqual(
            statusOf(doc(["token_endpoint_auth_signing_alg": nil, "jwks_uri": "https://app.example.com/jwks.json"], base: confidential), "auth"),
            .warn
        )
        XCTAssertEqual(
            statusOf(doc(["token_endpoint_auth_signing_alg": "RS256", "jwks_uri": "https://app.example.com/jwks.json"], base: confidential), "auth"),
            .warn
        )
    }

    func testTheDisplayFieldsHaveOriginAndSchemeRules() {
        XCTAssertEqual(statusOf(doc(["client_uri": "https://www.example.org"]), "display"), .fail)
        XCTAssertEqual(statusOf(doc(["logo_uri": "http://app.example.com/logo.png"]), "display"), .fail)
        XCTAssertEqual(statusOf(doc(["tos_uri": nil]), "display"), .info)
    }

    func testALookupStillOnItsWayIsPendingAndOneThatFailedSaysSo() {
        let waiting = OAuthChecker.buildClientChecks(.pending, clientId: clientID)
        XCTAssertTrue(waiting.allSatisfy { $0.status == .pending })
        XCTAssertEqual(OAuthChecker.clientVerdict(waiting, kind: .hosted).tone, .pending)
        let failed = OAuthChecker.buildClientChecks(.failed, clientId: clientID)
        XCTAssertEqual(failed.first?.status, .fail)
    }

    func testTheLocalhostFormDerivesItsMetadataFromTheURL() {
        let bare = OAuthChecker.readLoopbackClient("http://localhost")
        XCTAssertEqual(bare.document["redirect_uris"], ["http://127.0.0.1/", "http://[::1]/"])
        XCTAssertEqual(bare.document["scope"], "atproto")
        XCTAssertEqual(bare.document["application_type"], "native")
        XCTAssertEqual(bare.document["token_endpoint_auth_method"], "none")
        XCTAssertEqual(OAuthChecker.clientVerdict(bare.checks, kind: .loopback).tone, .pass)

        let configured = OAuthChecker.readLoopbackClient(
            "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=atproto%20transition%3Ageneric"
        )
        XCTAssertEqual(configured.document["redirect_uris"], ["http://127.0.0.1:8080/callback"])
        XCTAssertEqual(configured.document["scope"], "atproto transition:generic")
        XCTAssertEqual(OAuthChecker.clientVerdict(configured.checks, kind: .loopback).tone, .pass)
    }

    func testTheLocalhostFormHasRulesOfItsOwn() {
        func find(_ clientId: String, _ id: String) -> ServiceCheckStatus? {
            OAuthChecker.readLoopbackClient(clientId).checks.first { $0.id == id }?.status
        }
        XCTAssertEqual(find("http://localhost:3000", "form"), .fail)
        XCTAssertEqual(find("http://localhost/app", "form"), .fail)
        // The redirect goes to the loopback address, not the name.
        XCTAssertEqual(find("http://localhost?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb", "redirect_uris"), .fail)
        XCTAssertEqual(find("http://localhost?redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A3000%2Fcb", "redirect_uris"), .pass)
        XCTAssertEqual(find("http://localhost?scope=transition%3Ageneric", "scope"), .fail)
        XCTAssertEqual(find("http://localhost?scope=atproto&scope=atproto", "scope"), .fail)
        XCTAssertEqual(find("http://localhost?client_name=Dev", "params"), .warn)
    }

    func testNarrowClientMetadataKeepsTheDefinedFieldsAndOnlyNamesTheRest() {
        let narrowed = OAuthChecker.narrowClientMetadata([
            "client_id": "https://app.example.com/client-metadata.json",
            "scope": "atproto",
            "dpop_bound_access_tokens": true,
            "internal_notes": "not for the page",
            "users": [["email": "someone@example.com"]],
        ])
        XCTAssertEqual(Set(narrowed.document.keys), ["client_id", "scope", "dpop_bound_access_tokens"])
        XCTAssertEqual(narrowed.otherFields, ["internal_notes", "users"])
        XCTAssertFalse(JSONValue.object(narrowed.document).compactString().contains("someone@example.com"))
        // An API response that is not client metadata comes back empty.
        XCTAssertEqual(OAuthChecker.narrowClientMetadata(["data": [1, 2, 3], "next": "x"]).document, [:])
    }
}

// MARK: - Scopes

/// Every valid example in the permission spec's "Scope String Syntax" section.
private let specExamples = [
    "identity:*",
    "identity:*?",
    "rpc?lxm=*&aud=did:web:api.example.com%23svc_appview",
    "blob?accept=video/*&accept=text/html",
    "repo:app.example.profile?action=create&action=update&action=delete",
    "include:app.example.authFull?aud=did:web:api.example.com%23svc_chat",
]

private func problems(_ scope: String) -> String {
    OAuthCheckerScopes.parseScope(scope).problems.joined(separator: " ")
}

final class OAuthCheckerScopesTests: XCTestCase {
    func testTheSpecsOwnExamplesAllReadAsValid() {
        for example in specExamples {
            let scope = OAuthCheckerScopes.parseScope(example)
            XCTAssertEqual(scope.status, .valid, "\(example): \(scope.problems.joined(separator: " "))")
        }
    }

    func testAScopeWrittenInItsShortestFormSurvivesARoundTrip() {
        let canonical = [
            "repo:app.example.profile",
            "repo:*",
            "repo:*?action=delete",
            "repo:app.example.post?action=create&action=update",
            "repo?collection=app.example.profile&collection=app.example.post",
            "rpc:app.example.moderation.createReport?aud=*",
            "rpc:*?aud=did:web:api.bsky.app%23bsky_appview",
            "rpc?lxm=app.example.getFeed&lxm=app.example.getProfile&aud=did:web:api.example.com%23svc",
            "blob:*/*",
            "blob?accept=video/*&accept=text/html",
            "account:email",
            "account:email?action=manage",
            "account:repo?action=manage",
            "identity:handle",
            "identity:*",
            "include:com.example.authBasicFeatures",
            "include:com.example.authBasicFeatures?aud=did:web:api.example.com%23svc_appview",
        ]
        for scope in canonical {
            let parsed = OAuthCheckerScopes.parseScope(scope)
            XCTAssertEqual(parsed.status, .valid, "\(scope): \(parsed.problems.joined(separator: " "))")
            guard let draft = parsed.draft else {
                XCTFail("\(scope) has no draft")
                continue
            }
            XCTAssertEqual(OAuthCheckerScopes.format(draft), scope)
        }
    }

    func testTheLongFormsOfAScopeAreWrittenBackInTheShortForm() {
        func short(_ scope: String) -> String? {
            OAuthCheckerScopes.parseScope(scope).draft.map(OAuthCheckerScopes.format)
        }
        // All three actions is the default, so it is left out.
        XCTAssertEqual(short("repo:app.example.profile?action=create&action=update&action=delete"), "repo:app.example.profile")
        // The spec: account:repo?action=manage is the same as account?action=manage&attr=repo.
        XCTAssertEqual(short("account?action=manage&attr=repo"), "account:repo?action=manage")
        XCTAssertEqual(short("account:email?action=read"), "account:email")
        XCTAssertEqual(short("repo?collection=app.example.post"), "repo:app.example.post")
    }

    func testEachResourceSaysWhatItGrants() {
        XCTAssertEqual(OAuthCheckerScopes.parseScope("repo:*?action=delete").meaning, "Delete records in every collection.")
        XCTAssertEqual(OAuthCheckerScopes.parseScope("repo:app.bsky.feed.post").meaning, "Create, update and delete records in app.bsky.feed.post.")
        XCTAssertEqual(
            OAuthCheckerScopes.parseScope("rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview").meaning,
            "Call app.bsky.actor.getProfile on did:web:api.bsky.app#bsky_appview."
        )
        XCTAssertEqual(OAuthCheckerScopes.parseScope("blob:*/*").meaning, "Upload files of any type.")
        assertMatches(OAuthCheckerScopes.parseScope("account:email?action=manage").meaning, "change")
        assertMatches(OAuthCheckerScopes.parseScope("identity:handle").meaning, "handle")
        assertMatches(OAuthCheckerScopes.parseScope("atproto").meaning, "Required")
        assertMatches(OAuthCheckerScopes.parseScope("transition:generic").meaning, "app password")
    }

    func testAResourceTheSpecDoesNotDefineIsUnknownNotInvalid() {
        let scope = OAuthCheckerScopes.parseScope("space:*?authority=*&action=read")
        XCTAssertEqual(scope.kind, .unknown)
        XCTAssertEqual(scope.status, .unknown)
        XCTAssertEqual(scope.problems, [])
        XCTAssertEqual(OAuthCheckerScopes.parseScope("resource").status, .unknown)
        XCTAssertEqual(OAuthCheckerScopes.parseScope("service:did:web:com.example#type?key=val").status, .unknown)
    }

    func testTextOutsideTheGeneralSyntaxIsInvalid() {
        XCTAssertEqual(OAuthCheckerScopes.parseScope("resource:positional?key=qu\u{e9}bec").status, .invalid)
        XCTAssertEqual(OAuthCheckerScopes.parseScope("emoji:\u{263A}\u{FE0F}").status, .invalid)
        XCTAssertEqual(OAuthCheckerScopes.parseScope("repo:%E0%A4%A").status, .invalid)
    }

    func testAMalformedParameterIsReported() {
        assertMatches(problems("repo:app.example.post?action"), "name=value")
        assertMatches(problems("repo:app.example.post?action="), "name=value")
        assertMatches(problems("repo:app.example.post?verb=create"), "not a parameter")
        assertMatches(problems("repo:app.example.post?action=read"), "not an action")
        assertMatches(problems("repo:app.example.post?action=create&action=create"), "once")
    }

    func testTheRulesOfEachResourceAreEnforced() {
        // The positional parameter cannot be given twice.
        assertMatches(problems("repo:com.example.record?collection=com.example.other"), "after the colon and again")
        assertMatches(problems("repo:com.example.*"), "partial wildcard")
        assertMatches(problems("repo:notansid"), "not a valid NSID")
        assertMatches(problems("repo"), "needs a collection")
        assertMatches(problems("repo:"), "Nothing follows the colon")
        // rpc always needs an audience in a scope string, and not two wildcards.
        assertMatches(problems("rpc:app.example.getFeed"), "needs aud")
        assertMatches(problems("rpc:*?aud=*"), #"cannot both be \*"#)
        assertMatches(problems("rpc:app.example.getFeed?aud=did:web:api.example.com"), "service reference")
        assertMatches(problems("blob:images"), "MIME")
        assertMatches(problems("account:*"), "wildcard is not supported")
        assertMatches(problems("account:email?action=write"), "read or manage")
        assertMatches(problems("identity:did"), #"handle and \*"#)
        assertMatches(problems("include:"), "Name the permission set")
        assertMatches(problems("include:notansid"), "not a valid NSID")
        assertMatches(problems("transition:everything"), "transition:generic")
        assertMatches(problems("atproto:full"), "no parameters")
    }

    func testNotesFlagWhatIsValidButWorthKnowing() {
        assertMatches(OAuthCheckerScopes.parseScope("account:repo").notes.joined(separator: " "), "action=manage")
        assertMatches(OAuthCheckerScopes.parseScope("include:com.example.authBasicFeatures").notes.joined(separator: " "), "No aud")
        assertMatches(OAuthCheckerScopes.parseScope("rpc:app.example.getFeed?aud=did:web:api.example.com#svc").notes.joined(separator: " "), "%23")
    }

    func testAScopeStringIsReadAsAWhole() {
        let ok = OAuthCheckerScopes.analyze("atproto repo:app.example.post blob:*/*")
        XCTAssertEqual(ok.problems, [])
        XCTAssertEqual(ok.scopes.count, 3)
        XCTAssertTrue(ok.scopes.allSatisfy { $0.status == .valid })

        assertMatches(OAuthCheckerScopes.analyze("repo:app.example.post").problems.joined(separator: " "), "atproto scope is missing")
        assertMatches(OAuthCheckerScopes.analyze("atproto transition:chat.bsky").problems.joined(separator: " "), "without transition:generic")
        assertMatches(OAuthCheckerScopes.analyze("atproto blob:*/* blob:*/*").notes.joined(separator: " "), "more than once")
        XCTAssertEqual(OAuthCheckerScopes.analyze("   ").scopes, [])
        XCTAssertEqual(OAuthCheckerScopes.analyze("").problems, [])
    }

    /// The web checks its own metadata scope; the app's (`Scopes`, which
    /// leaves out the proposed space permissions) has to read cleanly too.
    func testTheAppsOwnMetadataScopeReadsCleanly() {
        let analysis = OAuthCheckerScopes.analyze(Scopes.metadataScope)
        XCTAssertEqual(analysis.problems, [])
        for scope in analysis.scopes {
            XCTAssertEqual(scope.status, .valid, "\(scope.raw): \(scope.problems.joined(separator: " "))")
        }
    }

    func testAddingAndRemovingKeepTheStringTidy() {
        XCTAssertEqual(OAuthCheckerScopes.add("", "repo:app.example.post"), "atproto repo:app.example.post")
        XCTAssertEqual(OAuthCheckerScopes.add("atproto blob:*/*", "blob:*/*"), "atproto blob:*/*")
        XCTAssertEqual(OAuthCheckerScopes.add("blob:*/*", "identity:handle"), "atproto blob:*/* identity:handle")
        XCTAssertEqual(OAuthCheckerScopes.remove("atproto blob:*/* identity:handle", at: 1), "atproto identity:handle")
        XCTAssertEqual(OAuthCheckerScopes.split(" atproto \n blob:*/*  "), ["atproto", "blob:*/*"])
    }

    func testTheBuilderWritesWhatItsFieldsSpell() {
        var form = OAuthCheckerScopes.BuilderForm()
        XCTAssertNil(form.candidate, "a repo permission needs a collection")
        form.collection = "app.example.post, app.example.like"
        XCTAssertEqual(form.candidate, "repo?collection=app.example.post&collection=app.example.like")
        form.toggle(.update)
        form.toggle(.delete)
        XCTAssertEqual(form.actions, [.create])
        form.toggle(.delete)
        XCTAssertEqual(form.actions, [.create, .delete], "actions keep their usual order")
        form.collection = "app.example.post"
        XCTAssertEqual(form.candidate, "repo:app.example.post?action=create&action=delete")
        XCTAssertEqual(form.parsed?.status, .valid)

        form.kind = .rpc
        form.lxm = "app.bsky.actor.getProfile"
        form.aud = "did:web:api.bsky.app#bsky_appview"
        XCTAssertEqual(form.candidate, "rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview")

        form.kind = .identity
        form.identityAttr = .all
        XCTAssertEqual(form.candidate, "identity:*")

        form.kind = .transition
        form.transition = "chat.bsky"
        XCTAssertEqual(form.candidate, "transition:chat.bsky")
    }

    func testTheScopeVerdict() {
        XCTAssertNil(OAuthCheckerScopes.verdict(OAuthCheckerScopes.analyze("")))
        XCTAssertEqual(OAuthCheckerScopes.verdict(OAuthCheckerScopes.analyze("atproto blob:*/*"))?.title, "2 scopes, all valid")
        XCTAssertEqual(OAuthCheckerScopes.verdict(OAuthCheckerScopes.analyze("atproto space:*"))?.tone, .warn)
        XCTAssertEqual(OAuthCheckerScopes.verdict(OAuthCheckerScopes.analyze("blob:*/*"))?.title, "This string would be refused")
        XCTAssertEqual(OAuthCheckerScopes.verdict(OAuthCheckerScopes.analyze("atproto repo:x"))?.title, "1 of 2 scopes is not valid")
    }
}

// MARK: - The read

private final class OAuthFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String]
    }

    private let replies: [String: Reply]

    init(_ replies: [String: Reply]) {
        self.replies = replies
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!.absoluteString
        guard let reply = replies[url] else { throw URLError(.cannotFindHost) }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (Data(reply.body.utf8), response)
    }
}

final class OAuthCheckerClientTests: XCTestCase {
    private func read(_ replies: [String: OAuthFakeTransport.Reply], _ clientId: String = clientID) async -> OAuthChecker.ClientMetadataProbe {
        await OAuthCheckerClient(fetcher: ServiceFetcher(transport: OAuthFakeTransport(replies))).fetch(clientId)
    }

    func testADocumentIsReadAndNarrowed() async {
        let body = #"{"client_id":"\#(clientID)","scope":"atproto","dpop_bound_access_tokens":true,"secret_notes":"x"}"#
        let probe = await read([clientID: .init(status: 200, body: body, headers: ["Content-Type": "application/json"])])
        XCTAssertEqual(probe.status, .answered)
        XCTAssertEqual(probe.httpStatus, 200)
        XCTAssertEqual(probe.contentType, "application/json")
        XCTAssertEqual(probe.document?["scope"], "atproto")
        XCTAssertNil(probe.document?["secret_notes"])
        XCTAssertEqual(probe.otherFields, ["secret_notes"])
    }

    func testARedirectIsFollowedAndReported() async {
        let ended = "https://www.example.com/c.json"
        let probe = await read([
            clientID: .init(status: 301, body: "", headers: ["Location": ended]),
            ended: .init(status: 200, body: "{}", headers: ["Content-Type": "application/json"]),
        ])
        XCTAssertEqual(probe.redirectedFrom, [clientID])
        XCTAssertEqual(probe.finalUrl, ended)
        XCTAssertEqual(statusOf(probe, "served"), .fail)
    }

    func testAPageAndAFailureAreReportedAsSuch() async {
        let page = await read([clientID: .init(status: 200, body: "  <!doctype html><p>hi", headers: ["Content-Type": "text/html"])])
        XCTAssertEqual(page.bodyProblem, "The address returns a web page rather than JSON.")
        XCTAssertNil(page.document)

        let missing = await read([:])
        XCTAssertEqual(missing.status, .error)
        XCTAssertEqual(missing.error, "the hostname does not resolve")

        let local = await read([:], "https://auth.internal/client.json")
        XCTAssertEqual(local.error, "the host is not a public address")
    }
}

@MainActor
final class OAuthCheckerModelTests: XCTestCase {
    func testTheLocalhostFormNeedsNoFetchAndTheScopeViewKeepsItsString() {
        let model = OAuthCheckerModel(client: OAuthCheckerClient(fetcher: ServiceFetcher(transport: OAuthFakeTransport([:]))))
        XCTAssertNil(model.apply(query: ["client_id": "http://localhost"]))
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertEqual(model.kindLabel, "Public native client")
        XCTAssertEqual(model.documentScope, "atproto")

        model.readScopes("atproto   blob:*/*")
        XCTAssertEqual(model.mode, .scopes)
        XCTAssertEqual(model.scope, "atproto blob:*/*")
        model.addScope("identity:handle")
        model.removeScope(at: 1)
        XCTAssertEqual(model.scope, "atproto identity:handle")
        XCTAssertEqual(model.metadataField, #""scope": "atproto identity:handle""#)
        XCTAssertEqual(model.shareQuery, ["view": "scopes", "scope": "atproto identity:handle"])
    }

    func testAHostedClientIsFetched() async {
        let body = #"{"client_id":"\#(clientID)"}"#
        let transport = OAuthFakeTransport([clientID: .init(status: 200, body: body, headers: ["Content-Type": "application/json"])])
        let model = OAuthCheckerModel(client: OAuthCheckerClient(fetcher: ServiceFetcher(transport: transport)))
        let task = model.check(clientID)
        XCTAssertEqual(model.verdict?.tone, .pending)
        await task?.value
        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(model.verdict?.tone, .fail)
        XCTAssertEqual(model.checks.first { $0.id == "client_id" }?.status, .pass)
    }
}
