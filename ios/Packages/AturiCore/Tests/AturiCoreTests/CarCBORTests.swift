import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/cbor.test.ts`.
final class CarCBORTests: XCTestCase {
    // A real record CID, read from the network when the web test was written.
    private let postCid = "bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq"

    private func decodeHex(_ text: String) throws -> CarCBORValue {
        try CarCBOR.decode(CarFixture.hex(text))
    }

    private func assertRefused(_ text: String, _ fragment: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try decodeHex(text), file: file, line: line) { error in
            let message = (error as? CarCBORError)?.message ?? ""
            XCTAssertTrue(message.contains(fragment), "\(message) should say \(fragment)", file: file, line: line)
        }
    }

    func testIntegersDecodeAtEveryWidth() throws {
        // RFC 8949, appendix A.
        XCTAssertEqual(try decodeHex("00"), .int(0))
        XCTAssertEqual(try decodeHex("17"), .int(23))
        XCTAssertEqual(try decodeHex("1818"), .int(24))
        XCTAssertEqual(try decodeHex("1903e8"), .int(1000))
        XCTAssertEqual(try decodeHex("1a000f4240"), .int(1_000_000))
        XCTAssertEqual(try decodeHex("1b000000e8d4a51000"), .int(1_000_000_000_000))
        XCTAssertEqual(try decodeHex("20"), .int(-1))
        XCTAssertEqual(try decodeHex("3863"), .int(-100))
        XCTAssertEqual(try decodeHex("3903e7"), .int(-1000))
    }

    func testIntegersPastTwoToTheFiftyThirdBecomeDigitsInJSON() throws {
        XCTAssertEqual(try decodeHex("1b001fffffffffffff"), .int(9_007_199_254_740_991))
        XCTAssertEqual(CarCBOR.toJSON(try decodeHex("1b001fffffffffffff")), .number(9_007_199_254_740_991))
        XCTAssertEqual(try decodeHex("1bffffffffffffffff"), .bigInt("18446744073709551615"))
        XCTAssertEqual(try decodeHex("3bffffffffffffffff"), .bigInt("-18446744073709551616"))
        XCTAssertEqual(CarCBOR.toJSON(try decodeHex("1bffffffffffffffff")), .string("18446744073709551615"))
        // Inside Int64 but past what a JavaScript number holds exactly.
        XCTAssertEqual(CarCBOR.toJSON(try decodeHex("1b0020000000000000")), .string("9007199254740992"))
    }

    func testStringsIncludingOnesThatAreNotASCII() throws {
        XCTAssertEqual(try decodeHex("60"), .text(""))
        XCTAssertEqual(try decodeHex("6161"), .text("a"))
        XCTAssertEqual(try decodeHex("62c3bc"), .text("\u{00FC}"))
        XCTAssertEqual(try decodeHex("64f0908591"), .text("\u{10151}"))
        let long = "A longer string with an emoji \u{1F33F} in it, well past the short-string path."
        XCTAssertEqual(try CarCBOR.decode(CarFixture.encode(.text(long))), .text(long))
    }

    func testByteStringsStayBytesAndBecomeDollarBytesInJSON() throws {
        XCTAssertEqual(try decodeHex("40"), .bytes([]))
        XCTAssertEqual(try decodeHex("4401020304"), .bytes([1, 2, 3, 4]))
        XCTAssertEqual(CarCBOR.toJSON(try decodeHex("4401020304")), ["$bytes": "AQIDBA"])
        XCTAssertEqual(CarCBOR.encodeBase64([0xff, 0xfe]), "//4")
    }

    func testArraysMapsAndTheThreeSimpleValues() throws {
        XCTAssertEqual(try decodeHex("80"), .array([]))
        XCTAssertEqual(try decodeHex("83010203"), .array([.int(1), .int(2), .int(3)]))
        XCTAssertEqual(try decodeHex("a0"), .map([:]))
        XCTAssertEqual(try decodeHex("a26161016162820203"), .map(["a": .int(1), "b": .array([.int(2), .int(3)])]))
        XCTAssertEqual(try decodeHex("f4"), .bool(false))
        XCTAssertEqual(try decodeHex("f5"), .bool(true))
        XCTAssertEqual(try decodeHex("f6"), .null)
    }

    func testSixtyFourBitFloatsDecodeAndShorterOnesAreRefused() throws {
        XCTAssertEqual(try decodeHex("fb3ff199999999999a"), .float(1.1))
        assertRefused("f93c00", "64-bit floats")
        assertRefused("fa47c35000", "64-bit floats")
    }

    func testTagFortyTwoIsALinkAndBecomesDollarLinkInJSON() throws {
        let cid = try XCTUnwrap(CarCBOR.decodeBase32(postCid.dropFirst()))
        let link = try CarCBOR.decode(CarFixture.encode(.link(CarCIDLink(bytes: cid))))
        guard case .link(let decoded) = link else {
            return XCTFail("expected a link, got \(link)")
        }
        XCTAssertEqual(decoded.string, postCid)
        XCTAssertEqual(CarCBOR.toJSON(.map(["ref": link])), ["ref": ["$link": .string(postCid)]])
    }

    func testCIDsPrintAsBase32ForV1AndBase58ForV0() throws {
        let cid = try XCTUnwrap(CarCBOR.decodeBase32(postCid.dropFirst()))
        XCTAssertEqual(CarCBOR.cidString(cid), postCid)
        XCTAssertEqual("b" + CarCBOR.encodeBase32(cid), postCid)
        // A CIDv0 is a bare sha2-256 multihash.
        let v0: [UInt8] = [0x12, 0x20] + [UInt8](repeating: 1, count: 32)
        let text = CarCBOR.cidString(v0)
        XCTAssertTrue(text.hasPrefix("Qm"), text)
        XCTAssertEqual(text.count, 46)
        XCTAssertEqual(CarCBOR.decodeBase58(text), v0, "base58 reads back what it wrote")
    }

    func testBase58KeepsLeadingZeroBytes() {
        XCTAssertEqual(CarCBOR.encodeBase58([0, 0, 1]), "112")
        XCTAssertEqual(CarCBOR.decodeBase58("112"), [0, 0, 1])
        XCTAssertNil(CarCBOR.decodeBase58("0OIl"), "not in the alphabet")
        XCTAssertNil(CarCBOR.decodeBase32("ABC"), "upper case is not the alphabet the CIDs use")
    }

    func testWhatDagCborDoesNotAllowIsRefusedByName() {
        assertRefused("5f4101ff", "Indefinite lengths")
        assertRefused("9f01ff", "Indefinite lengths")
        assertRefused("bf616101ff", "Indefinite lengths")
        assertRefused("f7", "undefined")
        assertRefused("c074323031332d30332d32315432303a30343a30305a", "Tag 0 is not allowed")
        assertRefused("a10102", "Map keys must be strings")
        // Tag 42 around something that is not a CID behind a zero byte.
        assertRefused("d82a6161", "link (tag 42)")
        assertRefused("d82a420171", "link (tag 42)")
    }

    func testTruncatedAndOverlongDataAreErrorsNotPartialValues() {
        XCTAssertThrowsError(try decodeHex("1903"))
        assertRefused("6461", "ends in the middle")
        assertRefused("8301", "ends in the middle")
        assertRefused("", "ends in the middle")
        // A count far past what the data could hold.
        assertRefused("9a00ffffff", "ends in the middle")
        assertRefused("0000", "more data after")
    }

    func testNestingIsBounded() throws {
        assertRefused(String(repeating: "81", count: 400) + "00", "nested too deeply")
        var expected = CarCBORValue.int(0)
        for _ in 0..<10 {
            expected = .array([expected])
        }
        XCTAssertEqual(try decodeHex(String(repeating: "81", count: 10) + "00"), expected)
    }

    func testDecodeAtReadsOneValueAndSaysWhereItEnded() throws {
        let decoded = try CarCBOR.decodeAt(CarFixture.hex("ff6161f6"), offset: 1)
        XCTAssertEqual(decoded.value, .text("a"))
        XCTAssertEqual(decoded.next, 3)
    }

    func testARecordDecodesToTheJSONThePDSWouldGive() throws {
        let cid = CarCIDLink(bytes: try XCTUnwrap(CarCBOR.decodeBase32(postCid.dropFirst())))
        let record: CarCBORValue = .map([
            "$type": .text("app.bsky.feed.post"),
            "text": .text("hello"),
            "langs": .array([.text("en")]),
            "reply": .null,
            "embed": .map(["image": .map([
                "$type": .text("blob"),
                "ref": .link(cid),
                "mimeType": .text("image/png"),
                "size": .int(1234),
            ])]),
        ])
        let expected: JSONValue = [
            "$type": "app.bsky.feed.post",
            "text": "hello",
            "langs": ["en"],
            "reply": nil,
            "embed": ["image": ["$type": "blob", "ref": ["$link": .string(postCid)], "mimeType": "image/png", "size": 1234]],
        ]
        XCTAssertEqual(CarCBOR.toJSON(try CarCBOR.decode(CarFixture.encode(record))), expected)
    }
}
