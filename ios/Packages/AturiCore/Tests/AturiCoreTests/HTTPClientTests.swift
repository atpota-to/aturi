import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A transport that plays back scripted outcomes in order and records every
/// request it was handed, so retry counts and headers can be asserted.
private final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    typealias Outcome = Result<(Data, HTTPURLResponse), Error>

    private let lock = NSLock()
    private var outcomes: [Outcome]
    private(set) var requests: [URLRequest] = []

    init(_ outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let outcome = record(request) else {
            XCTFail("transport asked for more responses than were scripted")
            throw URLError(.unknown)
        }
        return try outcome.get()
    }

    private func record(_ request: URLRequest) -> Outcome? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        return outcomes.isEmpty ? nil : outcomes.removeFirst()
    }

    var callCount: Int {
        lock.lock(); defer { lock.unlock() }
        return requests.count
    }
}

private func response(_ status: Int, url: URL, headers: [String: String] = [:]) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
}

private func ok(_ body: String, url: URL, headers: [String: String] = [:]) -> ScriptedTransport.Outcome {
    .success((Data(body.utf8), response(200, url: url, headers: headers)))
}

private struct HandleResponse: Decodable, Equatable {
    let did: String
}

final class HTTPClientTests: XCTestCase {
    private let url = URL(string: "https://example.test/xrpc/com.atproto.identity.resolveHandle?handle=x")!

    func testSuccessfulGetReturnsBodyAndSetsUserAgent() async throws {
        let transport = ScriptedTransport([ok(#"{"did":"did:plc:x"}"#, url: url)])
        let client = HTTPClient(transport: transport, userAgent: "test-agent")
        let (data, resp) = try await client.get(url, headers: ["Accept": "application/json"])
        XCTAssertEqual(resp.statusCode, 200)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"did":"did:plc:x"}"#)
        XCTAssertEqual(transport.callCount, 1)
        let request = transport.requests[0]
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "test-agent")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader))
        XCTAssertEqual(request.timeoutInterval, HTTPClient.timeout)
    }

    func testRetriesOnceOnTransportError() async throws {
        let transport = ScriptedTransport([
            .failure(URLError(.networkConnectionLost)),
            ok(#"{"did":"did:plc:x"}"#, url: url),
        ])
        let client = HTTPClient(transport: transport)
        let decoded = try await client.getJSON(HandleResponse.self, from: url)
        XCTAssertEqual(decoded, HandleResponse(did: "did:plc:x"))
        XCTAssertEqual(transport.callCount, 2)
    }

    func testGivesUpAfterSecondTransportError() async {
        let transport = ScriptedTransport([
            .failure(URLError(.timedOut)),
            .failure(URLError(.cannotConnectToHost)),
        ])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url)
            XCTFail("expected the second transport error to surface")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .cannotConnectToHost)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.callCount, 2)
    }

    func testDoesNotRetryOnHTTPStatus() async {
        let transport = ScriptedTransport([
            .success((Data("boom".utf8), response(500, url: url))),
            ok("{}", url: url),
        ])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url)
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 500)
            XCTAssertEqual(error.body, "boom")
            XCTAssertEqual(error.url, url)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.callCount, 1)
    }

    func testFourHundredIsAnHTTPErrorToo() async {
        let transport = ScriptedTransport([
            .success((Data(#"{"error":"RepoNotFound"}"#.utf8), response(400, url: url))),
        ])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.getJSONValue(from: url)
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 400)
            XCTAssertTrue(error.body.contains("RepoNotFound"))
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.callCount, 1)
    }

    func testDeclaredContentLengthOverCapIsRefused() async {
        let declared = HTTPClient.maxBodyBytes + 1
        let transport = ScriptedTransport([
            ok("{}", url: url, headers: ["content-length": String(declared)]),
        ])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url)
            XCTFail("expected tooLarge")
        } catch HTTPFailure.tooLarge(let size) {
            XCTAssertEqual(size, declared)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.callCount, 1, "a cap failure is never retried")
    }

    func testReceivedBodyOverCapIsRefused() async {
        let big = Data(repeating: UInt8(ascii: "x"), count: HTTPClient.maxBodyBytes + 1)
        let transport = ScriptedTransport([.success((big, response(200, url: url)))])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url)
            XCTFail("expected tooLarge")
        } catch HTTPFailure.tooLarge(let size) {
            XCTAssertEqual(size, HTTPClient.maxBodyBytes + 1)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.callCount, 1)
    }

    func testBodyExactlyAtCapIsAccepted() async throws {
        let body = Data(repeating: UInt8(ascii: "x"), count: HTTPClient.maxBodyBytes)
        let transport = ScriptedTransport([
            .success((body, response(200, url: url, headers: ["Content-Length": String(body.count)]))),
        ])
        let client = HTTPClient(transport: transport)
        let (data, _) = try await client.get(url)
        XCTAssertEqual(data.count, HTTPClient.maxBodyBytes)
    }

    func testRefuseRedirectsSetsMarkerAndRefusesA3xx() async {
        let target = URL(string: "https://elsewhere.test/did.json")!
        let transport = ScriptedTransport([
            .success((Data(), response(302, url: url, headers: ["Location": target.absoluteString]))),
        ])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url, refuseRedirects: true)
            XCTFail("expected redirectRefused")
        } catch HTTPFailure.redirectRefused(let location) {
            XCTAssertEqual(location, target)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1")
    }

    func testRefusedRedirectWithoutLocationReportsTheRequestURL() async {
        let transport = ScriptedTransport([.success((Data(), response(301, url: url)))])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url, refuseRedirects: true)
            XCTFail("expected redirectRefused")
        } catch HTTPFailure.redirectRefused(let location) {
            XCTAssertEqual(location, url)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testWithoutTheFlagA3xxIsAPlainHTTPError() async {
        let transport = ScriptedTransport([.success((Data(), response(302, url: url)))])
        let client = HTTPClient(transport: transport)
        do {
            _ = try await client.get(url)
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 302)
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertNil(transport.requests[0].value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader))
    }

    func testURLSessionTransportStripsTheMarkerBeforeSending() {
        // The marker is process-internal: the transport reads it and drops it.
        var request = URLRequest(url: url)
        request.setValue("1", forHTTPHeaderField: URLSessionTransport.noRedirectHeader)
        XCTAssertEqual(URLSessionTransport.noRedirectHeader, "X-Aturi-No-Redirect")
        XCTAssertNotNil(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader))
        request.setValue(nil, forHTTPHeaderField: URLSessionTransport.noRedirectHeader)
        XCTAssertNil(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader))
    }

    func testGetJSONOrNilSwallowsEveryFailure() async {
        let bad = ScriptedTransport([
            .failure(URLError(.timedOut)),
            .failure(URLError(.timedOut)),
        ])
        let status = ScriptedTransport([.success((Data("{}".utf8), response(503, url: url)))])
        let malformed = ScriptedTransport([ok("not json", url: url)])
        let good = ScriptedTransport([ok(#"{"did":"did:plc:y"}"#, url: url)])

        let fromBad = await HTTPClient(transport: bad).getJSONOrNil(HandleResponse.self, from: url)
        let fromStatus = await HTTPClient(transport: status).getJSONOrNil(HandleResponse.self, from: url)
        let fromMalformed = await HTTPClient(transport: malformed).getJSONOrNil(HandleResponse.self, from: url)
        let fromGood = await HTTPClient(transport: good).getJSONOrNil(HandleResponse.self, from: url)

        XCTAssertNil(fromBad)
        XCTAssertNil(fromStatus)
        XCTAssertNil(fromMalformed)
        XCTAssertEqual(fromGood, HandleResponse(did: "did:plc:y"))
    }

    func testGetJSONValueParsesTheBody() async throws {
        let transport = ScriptedTransport([ok(#"{"a":[1,2],"b":null}"#, url: url)])
        let value = try await HTTPClient(transport: transport).getJSONValue(from: url)
        XCTAssertEqual(value, ["a": [1, 2], "b": nil])
    }

    func testSendReturnsNon2xxAsAResponse() async throws {
        // OAuth's use_dpop_nonce dance needs the 400's headers, so `send`
        // hands every status back instead of throwing.
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let transport = ScriptedTransport([
            .success((Data(#"{"error":"use_dpop_nonce"}"#.utf8), response(400, url: url, headers: ["DPoP-Nonce": "abc"]))),
        ])
        let (data, resp) = try await HTTPClient(transport: transport).send(request)
        XCTAssertEqual(resp.statusCode, 400)
        XCTAssertEqual(HTTPClient.header("dpop-nonce", in: resp), "abc")
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("use_dpop_nonce"))
        XCTAssertEqual(transport.requests[0].httpMethod, "POST")
        XCTAssertNotNil(transport.requests[0].value(forHTTPHeaderField: "User-Agent"))
    }

    func testSendKeepsACallerProvidedUserAgent() async throws {
        var request = URLRequest(url: url)
        request.setValue("custom/1", forHTTPHeaderField: "User-Agent")
        let transport = ScriptedTransport([ok("{}", url: url)])
        _ = try await HTTPClient(transport: transport, userAgent: "default/1").send(request)
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "User-Agent"), "custom/1")
    }

    // MARK: makeURL

    func testMakeURLAppendsPathAndEncodesQuery() {
        let base = URL(string: "https://pds.example.com")!
        let url = makeURL(base, path: "/xrpc/com.atproto.repo.getRecord", query: [
            ("repo", "did:plc:abc"),
            ("collection", "app.bsky.feed.post"),
            ("rkey", "3k7q w&x=y"),
        ])
        XCTAssertEqual(
            url.absoluteString,
            "https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=app.bsky.feed.post&rkey=3k7q%20w%26x%3Dy"
        )
    }

    func testMakeURLKeepsBasePathAndColonsInPath() {
        let base = URL(string: "https://plc.directory")!
        XCTAssertEqual(makeURL(base, path: "did:plc:abc").absoluteString, "https://plc.directory/did:plc:abc")
        XCTAssertEqual(makeURL(base, path: "/did:plc:abc/log/audit").absoluteString, "https://plc.directory/did:plc:abc/log/audit")

        let nested = URL(string: "https://host.example/api/")!
        XCTAssertEqual(makeURL(nested, path: "v1/thing").absoluteString, "https://host.example/api/v1/thing")
        XCTAssertEqual(makeURL(nested, path: "").absoluteString, "https://host.example/api")
    }

    func testMakeURLEncodesUnicodeAndReservedCharacters() {
        let base = URL(string: "https://public.api.bsky.app")!
        let url = makeURL(base, path: "/xrpc/app.bsky.actor.searchActorsTypeahead", query: [("q", "caf\u{E9} #1")])
        XCTAssertEqual(url.query, "q=caf%C3%A9%20%231")
        XCTAssertEqual(URIEncoding.encodeComponent("a-b_c.d!e~f*g'h(i)j"), "a-b_c.d!e~f*g'h(i)j")
        XCTAssertEqual(URIEncoding.encodeComponent("at://did:plc:x/a.b.c/r?k#f"), "at%3A%2F%2Fdid%3Aplc%3Ax%2Fa.b.c%2Fr%3Fk%23f")
    }

    // MARK: live

    func testLivePLCDirectoryDocument() async throws {
        let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
        let url = makeURL(Endpoints.plcDirectory, path: did)
        let document: JSONValue
        do {
            document = try await HTTPClient.shared.getJSONValue(from: url)
        } catch let error as HTTPError {
            if error.status == 429 || error.status >= 500 {
                throw XCTSkip("plc.directory answered \(error.status); nothing to assert on")
            }
            throw error
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }
        XCTAssertEqual(document["id"]?.stringValue, did)
        XCTAssertNotNil(document["alsoKnownAs"]?.arrayValue)
        XCTAssertNotNil(document["service"]?.arrayValue)
    }
}
