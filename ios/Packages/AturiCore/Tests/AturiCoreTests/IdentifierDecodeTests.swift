import Foundation
import XCTest
@testable import AturiCore

/// Port of src/lib/tools/__tests__/decode.test.ts. Real identifiers, read
/// from the network when the web's tests were written. The web checks the
/// TID against `@atproto/common-web`; the value that reference parser gives
/// is pinned here instead.
final class IdentifierDecodeTests: XCTestCase {
    private static let postTid = "3n22yg6lg2k2f"
    /// `TID.fromStr(POST_TID).timestamp()`.
    private static let postTidMicros: UInt64 = 1_794_435_596_202_000
    private static let postCid = "bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq"
    private static let bskyDid = "did:plc:z72i7hdynmk6r22z27h6tvur"
    private static let bskyKey = "zQ3shQo6TF2moaqMTrUZEM1jeuYRQXeHEx4evX9751y2qPqRA"
    /// `Date.UTC(2026, 10, 12)`.
    private static let nowMs: Int64 = 1_794_441_600_000
    private static let now = Date(timeIntervalSince1970: 1_794_441_600)

    private func decode(_ text: String) -> [IdentifierDecode.Decoded] {
        IdentifierDecode.decode(text, now: Self.now)
    }

    private func base64URL(_ json: String) -> String {
        Data(json.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func jwt(header: String, payload: String, signature: String = "c2ln") -> String {
        "\(base64URL(header)).\(base64URL(payload)).\(signature)"
    }

    func testATidDecodesToTheReferenceTimeAndBack() {
        XCTAssertEqual(TID.microseconds(from: Self.postTid), Self.postTidMicros)
        XCTAssertEqual(TID.clockId(from: Self.postTid), 11)
        XCTAssertEqual(IdentifierDecode.formatTid(micros: Self.postTidMicros, clockId: 11), Self.postTid)
        XCTAssertNil(TID.microseconds(from: "self"))
        // The first character holds the high bit, which must be zero.
        XCTAssertNil(TID.microseconds(from: "zzzzzzzzzzzzz"))
    }

    func testATidIsReadAsATimestampIdentifier() throws {
        let decoded = try XCTUnwrap(decode(Self.postTid).first)
        XCTAssertEqual(decoded.kind, .tid)
        XCTAssertEqual(decoded.fact("UTC"), "2026-11-11T22:19:56.202Z")
        XCTAssertEqual(decoded.fact("Relative"), "1 hour ago")
        XCTAssertEqual(decoded.fact("Microseconds since 1970"), "1794435596202000")
        XCTAssertEqual(decoded.fact("Clock ID"), "11")
        XCTAssertEqual(decoded.notes, [])
    }

    func testThirteenLettersThatDecodeFarOutsideAtprotosYearsAreFlagged() throws {
        let decoded = try XCTUnwrap(decode("2222222222222").first)
        XCTAssertEqual(decoded.kind, .tid)
        XCTAssertFalse(decoded.notes.isEmpty)
    }

    func testARecordCidIsCidV1DagCborSha256() throws {
        let decoded = try XCTUnwrap(decode(Self.postCid).first)
        XCTAssertEqual(decoded.kind, .cid)
        XCTAssertEqual(decoded.fact("Version"), "CIDv1")
        XCTAssertEqual(decoded.fact("Codec"), "dag-cbor (0x71)")
        XCTAssertEqual(decoded.fact("Hash"), "sha2-256, 256 bits")
        XCTAssertEqual(decoded.fact("Digest"), "34fb509e95033e877fad2fc3e538126846e1fdef689f756daf7422a2f0d13d8c")
        XCTAssertEqual(decoded.notes, [])
    }

    func testACidV0IsReadAndNotedAsAFormAtprotoDoesNotUse() throws {
        let decoded = try XCTUnwrap(decode("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").first)
        XCTAssertEqual(decoded.kind, .cid)
        XCTAssertEqual(decoded.fact("Version"), "CIDv0")
        XCTAssertEqual(decoded.fact("Digest"), "9d6c2be50f706953479ab9df2ce3edca90b68053c00b3004b7f0accbe1e8eedf")
        XCTAssertTrue(decoded.notes.contains { $0.contains("CIDv0") })
    }

    func testBase32AndBase58DecodeToTheBytesTheyEncode() {
        XCTAssertEqual(IdentifierDecode.decodeBase32("mzxw6ytboi"), Array("foobar".utf8))
        XCTAssertNil(IdentifierDecode.decodeBase32("not base32!"))
        XCTAssertEqual(IdentifierDecode.decodeBase58("2NEpo7TZRRrLZSi2U"), Array("Hello World!".utf8))
        // A leading "1" is a leading zero byte.
        XCTAssertEqual(IdentifierDecode.decodeBase58("11"), [0, 0])
        XCTAssertNil(IdentifierDecode.decodeBase58("0OIl"))
    }

    func testASigningKeyFromADidDocumentIsAK256Key() throws {
        let decoded = try XCTUnwrap(decode(Self.bskyKey).first)
        XCTAssertEqual(decoded.kind, .key)
        XCTAssertTrue(decoded.fact("Curve")?.contains("secp256k1") == true)
        XCTAssertEqual(decoded.fact("JWT algorithm"), "ES256K")
        // A compressed point: 33 bytes.
        XCTAssertEqual(decoded.fact("Key bytes"), "023249d921a1da482dc7117e9451bf2ae48ef641dc87bd9c9ea3648f3e81cce249")
        XCTAssertEqual(decoded.notes, [])
        let asDid = try XCTUnwrap(decode("did:key:\(Self.bskyKey)").first)
        XCTAssertEqual(asDid.kind, .key)
        XCTAssertEqual(asDid.title, "Public key (did:key)")
    }

    func testDidsAreReadByMethod() throws {
        let plc = try XCTUnwrap(decode(Self.bskyDid).first)
        XCTAssertEqual(plc.kind, .did)
        XCTAssertEqual(plc.fact("Document"), "https://plc.directory/\(Self.bskyDid)")
        XCTAssertEqual(plc.notes, [])

        let short = try XCTUnwrap(decode("did:plc:abc").first)
        XCTAssertFalse(short.notes.isEmpty)

        let web = try XCTUnwrap(decode("did:web:example.com").first)
        XCTAssertEqual(web.fact("Host"), "example.com")
        XCTAssertEqual(web.fact("Document"), "https://example.com/.well-known/did.json")
        XCTAssertEqual(web.notes, [])
    }

    func testAnAtUriIsTakenApartIntoItsThreeParts() throws {
        let decoded = try XCTUnwrap(decode("at://\(Self.bskyDid)/app.bsky.feed.post/\(Self.postTid)").first)
        XCTAssertEqual(decoded.kind, .atUri)
        XCTAssertEqual(decoded.parts.map { "\($0.label):\($0.decoded.kind.rawValue)" }, [
            "Authority:did",
            "Collection:nsid",
            "Record key:tid",
        ])
        XCTAssertEqual(decoded.fact("Universal link"), "https://aturi.to/\(Self.bskyDid)/app.bsky.feed.post/\(Self.postTid)")
        XCTAssertEqual(decoded.notes, [])
        XCTAssertEqual(decoded.links.map(\.href), ["/explore/\(Self.bskyDid)/app.bsky.feed.post/\(Self.postTid)"])
    }

    func testAnAtUriOnAHandleWorksWithANoteThatHandlesChange() throws {
        let decoded = try XCTUnwrap(decode("at://bsky.app/app.bsky.actor.profile/self").first)
        XCTAssertEqual(decoded.parts.map(\.decoded.kind), [.handle, .nsid, .recordKey])
        XCTAssertTrue(decoded.notes.contains { $0.lowercased().contains("handle") })
    }

    func testAnAtUriWithMoreThanThreePartsIsNotOne() {
        XCTAssertEqual(decode("at://bsky.app/app.bsky.actor.profile/self/extra").count, 0)
        XCTAssertEqual(decode("at://bsky.app/app.bsky.actor.profile?x=1").count, 0)
        let fragment = decode("at://bsky.app/app.bsky.actor.profile/self#main").first
        XCTAssertEqual(fragment?.fact("Fragment"), "#main")
    }

    func testAnNsidNamesItsAuthorityAndIsAlsoOfferedAsAHandle() {
        let readings = decode("app.bsky.feed.post")
        XCTAssertEqual(readings.map(\.kind), [.nsid, .handle])
        XCTAssertEqual(readings.first?.fact("Authority"), "feed.bsky.app")
        XCTAssertEqual(readings.first?.fact("Published at"), "_lexicon.feed.bsky.app")
        // Two segments cannot be an NSID.
        XCTAssertEqual(decode("bsky.app").map(\.kind), [.handle])
    }

    func testATokenIsDecodedWithItsExpirySaidInWords() throws {
        let exp = Self.nowMs / 1000 - 3600
        let token = jwt(
            header: #"{"typ":"at+jwt","alg":"ES256K"}"#,
            payload: #"{"iss":"https://bsky.social","sub":"\#(Self.bskyDid)","scope":"atproto","exp":\#(exp)}"#
        )
        let decoded = try XCTUnwrap(decode("Bearer \(token)").first)
        XCTAssertEqual(decoded.kind, .jwt)
        XCTAssertEqual(decoded.fact("sub"), Self.bskyDid)
        XCTAssertEqual(decoded.fact("Type"), "at+jwt. An OAuth access token.")
        XCTAssertTrue(decoded.notes.contains { $0.contains("expired 1 hour ago") })
        XCTAssertTrue(decoded.notes.contains { $0.contains("not checked") })
        XCTAssertEqual(decoded.json.map(\.label), ["Header", "Claims"])
        // The registered claims first, in their order.
        XCTAssertEqual(decoded.facts.map(\.label), ["Type", "Algorithm", "iss", "sub", "scope", "exp"])
        XCTAssertEqual(IdentifierDecode.claimMeaning("aud"), "Audience: the service it is meant for. A service must refuse a token addressed to another.")
    }

    func testTokensAndLongInputAreKeptOutOfTheLink() {
        let token = jwt(header: #"{"alg":"ES256"}"#, payload: #"{"sub":"x"}"#)
        XCTAssertTrue(IdentifierDecode.isSensitiveInput(token))
        XCTAssertTrue(IdentifierDecode.isSensitiveInput("Bearer \(token)"))
        XCTAssertTrue(IdentifierDecode.isSensitiveInput(String(repeating: "a", count: 401)))
        XCTAssertFalse(IdentifierDecode.isSensitiveInput(Self.postTid))
    }

    func testTimestampsConvertToATid() throws {
        let decoded = try XCTUnwrap(decode("2026-11-12T00:00:00Z").first)
        XCTAssertEqual(decoded.kind, .datetime)
        let tid = try XCTUnwrap(decoded.fact("TID"))
        XCTAssertEqual(TID.microseconds(from: tid), UInt64(Self.nowMs) * 1000)
        XCTAssertEqual(decoded.fact("Seconds"), "1794441600")
        XCTAssertEqual(decoded.notes, [])
        XCTAssertEqual(decode(String(Self.nowMs / 1000)).first?.kind, .datetime)
        XCTAssertEqual(decode("1762905600").first?.fact("TID"), "3m5fdt2z22222")
    }

    func testADatetimeWithNoZoneIsReadInLocalTimeAndSaysSo() throws {
        let decoded = try XCTUnwrap(decode("2026-11-12T10:30").first)
        XCTAssertEqual(decoded.kind, .datetime)
        XCTAssertEqual(decoded.notes.count, 1)
        XCTAssertNil(IdentifierDecode.datetimeShape("2026-11-12T10:30:00.Z"))
        XCTAssertNil(IdentifierDecode.datetimeShape("2026-11-12T10"))
        XCTAssertEqual(IdentifierDecode.datetimeShape("2026-11-12 10:30:00.123+02:00")?.hasZone, true)
    }

    func testTextThatIsNothingInParticularDecodesToNothingOrABareRecordKey() {
        XCTAssertEqual(decode("").count, 0)
        XCTAssertEqual(decode("hello world").count, 0)
        XCTAssertEqual(decode("self").map(\.kind), [.recordKey])
    }

    /// Every link a reading offers opens a page the app has.
    func testEveryLinkIsAPageTheAppCanOpen() {
        let inputs = [
            Self.bskyDid,
            "did:web:example.com",
            "app.bsky.feed.post",
            "at://\(Self.bskyDid)/app.bsky.feed.post/\(Self.postTid)",
            "at://bsky.app",
        ]
        for input in inputs {
            for decoded in decode(input) {
                for link in decoded.links + decoded.parts.flatMap(\.decoded.links) {
                    XCTAssertNotNil(DeepLinkRouting.destination(for: Endpoints.aturiBase.absoluteString + link.href), link.href)
                }
            }
        }
    }
}
