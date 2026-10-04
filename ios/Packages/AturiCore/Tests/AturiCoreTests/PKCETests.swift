import XCTest
@testable import AturiCore

final class PKCETests: XCTestCase {
    // MARK: SHA-256 vectors (FIPS 180-4 examples and the empty string)

    func testSHA256EmptyString() {
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
    }

    func testSHA256Abc() {
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data("abc".utf8)),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testSHA256TwoBlockMessage() {
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        )
    }

    func testSHA256PaddingBoundaries() {
        // 55, 56 and 64 bytes exercise the three padding cases: room for the
        // length in the same block, exactly no room, and a full block.
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data(String(repeating: "a", count: 55).utf8)),
            "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"
        )
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data(String(repeating: "a", count: 56).utf8)),
            "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"
        )
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data(String(repeating: "a", count: 64).utf8)),
            "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
        )
    }

    func testSHA256MillionAs() {
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data([UInt8](repeating: UInt8(ascii: "a"), count: 1_000_000))),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        )
    }

    func testSHA256DataAndByteOverloadsAgree() {
        let bytes: [UInt8] = Array("hello".utf8)
        XCTAssertEqual(OAuthSHA256.hash(Data(bytes)), Data(OAuthSHA256.hash(bytes)))
        XCTAssertEqual(OAuthSHA256.hash(bytes).count, 32)
    }

    // MARK: base64url

    func testBase64URLUsesTheURLAlphabetWithoutPadding() {
        // 0xfb 0xff 0xbf encodes to "+/+/" in base64; the url alphabet swaps
        // both symbols.
        XCTAssertEqual(OAuthBase64URL.encode(Data([0xfb, 0xff, 0xbf])), "-_-_")
        XCTAssertEqual(OAuthBase64URL.encode(Data("a".utf8)), "YQ")
        XCTAssertEqual(OAuthBase64URL.encode(Data("ab".utf8)), "YWI")
        XCTAssertEqual(OAuthBase64URL.encode(Data("abc".utf8)), "YWJj")
        XCTAssertEqual(OAuthBase64URL.encode(Data()), "")
    }

    func testBase64URLDecodeRoundTripsEveryRemainder() {
        for length in 0..<10 {
            let bytes = (0..<length).map { UInt8($0 * 37 % 256) }
            let encoded = OAuthBase64URL.encode(Data(bytes))
            XCTAssertFalse(encoded.contains("="))
            XCTAssertEqual(OAuthBase64URL.decode(encoded), Data(bytes), "length \(length)")
        }
        XCTAssertEqual(OAuthBase64URL.decode("-_-_"), Data([0xfb, 0xff, 0xbf]))
        XCTAssertNil(OAuthBase64URL.decode("Y"), "a single leftover char is not valid base64")
        XCTAssertNil(OAuthBase64URL.decode("not base64!"))
    }

    // MARK: PKCE

    func testChallengeMatchesRFC7636AppendixB() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        XCTAssertEqual(PKCE.challenge(for: verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(PKCE.challengeMethod, "S256")
    }

    func testVerifierFromBytesIsDeterministicAndValid() {
        let bytes = [UInt8](repeating: 0x42, count: 32)
        let verifier = PKCE.verifier(fromRandomBytes: bytes)
        XCTAssertEqual(verifier, PKCE.verifier(fromRandomBytes: bytes))
        XCTAssertEqual(verifier.count, 43)
        XCTAssertTrue(PKCE.isValidVerifier(verifier))
    }

    func testGeneratedVerifierIsLegalAndUnique() {
        let first = PKCE.generateVerifier()
        let second = PKCE.generateVerifier()
        XCTAssertTrue(PKCE.isValidVerifier(first))
        XCTAssertTrue(PKCE.isValidVerifier(second))
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first.count, 43)
    }

    func testVerifierValidation() {
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a", count: 42)), "too short")
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "a", count: 43)))
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "a", count: 128)))
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a", count: 129)), "too long")
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a", count: 42) + "+"), "reserved character")
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "a", count: 40) + "-._~"))
    }

    func testRandomTokensAreBase64URLOfTheRequestedSize() {
        let token = OAuthRandom.token(bytes: 32)
        XCTAssertEqual(token.count, 43)
        XCTAssertEqual(OAuthBase64URL.decode(token)?.count, 32)
        XCTAssertEqual(OAuthRandom.bytes(count: 16).count, 16)
        XCTAssertNotEqual(OAuthRandom.token(bytes: 16), OAuthRandom.token(bytes: 16))
    }
}
