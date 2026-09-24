import XCTest
@testable import AturiCore

final class TIDTests: XCTestCase {
    func testLooksLikeTid() {
        XCTAssertTrue(TID.looksLikeTid("3juzlwllznd24"))
        XCTAssertTrue(TID.looksLikeTid("2222222222222"))
        XCTAssertFalse(TID.looksLikeTid("self"))
        XCTAssertFalse(TID.looksLikeTid("abc"))
        XCTAssertFalse(TID.looksLikeTid(""))
        XCTAssertFalse(TID.looksLikeTid("3juzlwllznd2"), "twelve characters")
        XCTAssertFalse(TID.looksLikeTid("3juzlwllznd245"), "fourteen characters")
        XCTAssertFalse(TID.looksLikeTid("3juzlwllznd21"), "1 is outside the alphabet")
        XCTAssertFalse(TID.looksLikeTid("3JUZLWLLZND24"), "upper case is outside the alphabet")
        XCTAssertFalse(TID.looksLikeTid("3juzlwllznd2\u{E9}"))
    }

    func testKnownTidDecodesToMay2023() throws {
        let date = try XCTUnwrap(TID.date(from: "3juzlwllznd24"))
        XCTAssertEqual(Formatting.utcCalendar.component(.year, from: date), 2023)
        XCTAssertEqual(Formatting.isoTimestamp(date), "2023-05-06T01:39:13.937Z")
        XCTAssertEqual(TID.microseconds(from: "3juzlwllznd24"), 1_683_337_153_937_001)
        XCTAssertEqual(TID.clockId(from: "3juzlwllznd24"), 2)
        XCTAssertEqual(TID.rawValue(of: "3juzlwllznd24"), 0x17EB_F1E4_63F9_A402)
    }

    func testAnotherKnownTid() throws {
        let date = try XCTUnwrap(TID.date(from: "3jzfcijpj2z2a"))
        XCTAssertEqual(Formatting.isoTimestamp(date), "2023-06-30T15:03:01.887Z")
        XCTAssertEqual(TID.clockId(from: "3jzfcijpj2z2a"), 6)
    }

    func testNonTidRecordKeysAreNil() {
        XCTAssertNil(TID.date(from: "self"))
        XCTAssertNil(TID.date(from: "abc"))
        XCTAssertNil(TID.date(from: ""))
        XCTAssertNil(TID.date(from: "3juzlwllznd2"))
        XCTAssertNil(TID.microseconds(from: "self"))
        XCTAssertNil(TID.clockId(from: "self"))
    }

    func testOutOfRangeDatesAreNil() {
        // All zeros is the epoch, which predates the network.
        XCTAssertNil(TID.date(from: "2222222222222"))
        // The leading digit sets the top bits: year 2255 and beyond.
        XCTAssertNil(TID.date(from: "zzzzzzzzzzzzz"))
        XCTAssertNil(TID.rawValue(of: "zzzzzzzzzzzzz"), "65-bit value cannot be a TID")
        XCTAssertNil(TID.date(from: "7222222222222"))
        // Epoch + 1 microsecond is a well-formed value but not a sane date.
        XCTAssertEqual(TID.rawValue(of: "2222222222226"), 4)
        XCTAssertNil(TID.date(from: "2222222222226"))
    }

    func testRawValueBoundary() {
        XCTAssertNotNil(TID.rawValue(of: "b222222222222"), "b is 7, the last digit that keeps the top bits clear")
        XCTAssertNil(TID.rawValue(of: "c222222222222"), "c is 8 and overflows the top bit")
    }

    func testFormatRelativeMatchesFormatting() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let date = now.addingTimeInterval(-3 * 86400)
        XCTAssertEqual(TID.formatRelative(date, now: now), "3d ago")
        XCTAssertEqual(TID.formatRelative(date, now: now), Formatting.relative(date, now: now))
        XCTAssertEqual(TID.formatRelative(now.addingTimeInterval(-30 * 86400), now: now), "2023-10-15")
    }
}
