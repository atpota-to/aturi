import XCTest
@testable import AturiCore

final class EndpointsTests: XCTestCase {
    func testHostsMatchTheWebConfig() {
        XCTAssertEqual(Endpoints.appView.absoluteString, "https://public.api.bsky.app")
        XCTAssertEqual(Endpoints.plcDirectory.absoluteString, "https://plc.directory")
        XCTAssertEqual(Endpoints.constellation.absoluteString, "https://constellation.microcosm.blue")
        XCTAssertEqual(Endpoints.slingshot.absoluteString, "https://slingshot.microcosm.blue")
        XCTAssertEqual(Endpoints.jetstream.absoluteString, "wss://jetstream2.us-east.bsky.network/subscribe")
        XCTAssertEqual(Endpoints.handleResolverFallback.absoluteString, "https://bsky.social")
        XCTAssertEqual(Endpoints.relay.absoluteString, "https://relay1.us-east.bsky.network")
        XCTAssertEqual(Endpoints.ufos.absoluteString, "https://ufos-api.microcosm.blue")
        XCTAssertEqual(Endpoints.credBlueAPI.absoluteString, "https://api.cred.blue")
        XCTAssertEqual(Endpoints.aturiBase.absoluteString, "https://aturi.to")
        XCTAssertEqual(Endpoints.aturiHost, "aturi.to")
        XCTAssertEqual(Endpoints.aturiBase.host, Endpoints.aturiHost)
    }

    func testEndpointsComposeWithMakeURL() {
        let url = makeURL(Endpoints.appView, path: "/xrpc/com.atproto.identity.resolveHandle", query: [("handle", "dame.is")])
        XCTAssertEqual(url.absoluteString, "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=dame.is")
    }
}
