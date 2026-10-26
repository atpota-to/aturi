import XCTest
@testable import AturiCore

final class FormattingTests: XCTestCase {
    func testCompactCount() {
        XCTAssertEqual(Formatting.compactCount(0), "0")
        XCTAssertEqual(Formatting.compactCount(999), "999")
        XCTAssertEqual(Formatting.compactCount(1_000), "1.0k")
        XCTAssertEqual(Formatting.compactCount(1_234), "1.2k")
        XCTAssertEqual(Formatting.compactCount(999_949), "999.9k")
        XCTAssertEqual(Formatting.compactCount(1_500_000), "1.5M")
        XCTAssertEqual(Formatting.compactCount(3_400_000), "3.4M")
        XCTAssertEqual(Formatting.compactCount(2_100_000_000), "2.1B")
    }

    func testBytes() {
        XCTAssertEqual(Formatting.bytes(0), "0 B")
        XCTAssertEqual(Formatting.bytes(1023), "1023 B")
        XCTAssertEqual(Formatting.bytes(1024), "1.0 KB")
        XCTAssertEqual(Formatting.bytes(1536), "1.5 KB")
        XCTAssertEqual(Formatting.bytes(10 * 1024), "10 KB")
        XCTAssertEqual(Formatting.bytes(512 * 1024), "512 KB")
        XCTAssertEqual(Formatting.bytes(1024 * 1024), "1.0 MB")
        XCTAssertEqual(Formatting.bytes(5 * 1024 * 1024 + 300 * 1024), "5.3 MB")
        XCTAssertEqual(Formatting.bytes(1024 * 1024 * 1024), "1.00 GB")
        XCTAssertEqual(Formatting.bytes(1024 * 1024 * 1024 + 256 * 1024 * 1024), "1.25 GB")
    }

    func testRelative() {
        let now = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14T22:13:20Z
        XCTAssertEqual(Formatting.relative(now, now: now), "0s ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-12), now: now), "12s ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-59.9), now: now), "59s ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-60), now: now), "1m ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-12 * 60), now: now), "12m ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-3600), now: now), "1h ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-23 * 3600 + -59 * 60), now: now), "23h ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-3 * 86400), now: now), "3d ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-13 * 86400 - 1), now: now), "13d ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-14 * 86400), now: now), "2023-10-31")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-189 * 86400), now: now), "2023-05-09")
        // A future date prints as a calendar date rather than a negative chip.
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(60), now: now), "2023-11-14")
    }

    func testIsoDate() throws {
        let plain = try XCTUnwrap(Formatting.isoDate("2023-05-06T01:39:13Z"))
        XCTAssertEqual(plain.timeIntervalSince1970, 1_683_337_153, accuracy: 0.0005)

        let millis = try XCTUnwrap(Formatting.isoDate("2023-05-06T01:39:13.937Z"))
        XCTAssertEqual(millis.timeIntervalSince1970, 1_683_337_153.937, accuracy: 0.0005)

        let micros = try XCTUnwrap(Formatting.isoDate("2023-05-06T01:39:13.937001Z"))
        XCTAssertEqual(micros.timeIntervalSince1970, 1_683_337_153.937001, accuracy: 0.0005)

        let nanosAndMore = try XCTUnwrap(Formatting.isoDate("2023-05-06T01:39:13.9370012345Z"))
        XCTAssertEqual(nanosAndMore.timeIntervalSince1970, 1_683_337_153.937001, accuracy: 0.0005)

        let offset = try XCTUnwrap(Formatting.isoDate("2023-05-06T03:39:13+02:00"))
        XCTAssertEqual(offset.timeIntervalSince1970, 1_683_337_153, accuracy: 0.0005)

        let negativeOffset = try XCTUnwrap(Formatting.isoDate("2023-05-05T20:39:13.5-05:00"))
        XCTAssertEqual(negativeOffset.timeIntervalSince1970, 1_683_337_153.5, accuracy: 0.0005)

        let compactOffset = try XCTUnwrap(Formatting.isoDate("2023-05-06T03:39:13+0200"))
        XCTAssertEqual(compactOffset.timeIntervalSince1970, 1_683_337_153, accuracy: 0.0005)

        let dayOnly = try XCTUnwrap(Formatting.isoDate("2023-05-06"))
        XCTAssertEqual(dayOnly.timeIntervalSince1970, 1_683_331_200, accuracy: 0.0005)

        let lowercase = try XCTUnwrap(Formatting.isoDate("2023-05-06t01:39:13z"))
        XCTAssertEqual(lowercase.timeIntervalSince1970, 1_683_337_153, accuracy: 0.0005)
    }

    func testIsoDateRejectsGarbage() {
        XCTAssertNil(Formatting.isoDate(""))
        XCTAssertNil(Formatting.isoDate("yesterday"))
        XCTAssertNil(Formatting.isoDate("2023-13-01T00:00:00Z"))
        XCTAssertNil(Formatting.isoDate("2023-05-06T25:00:00Z"))
        XCTAssertNil(Formatting.isoDate("2023-05-06T01:39:13"))
        XCTAssertNil(Formatting.isoDate("2023-05-06T01:39:13.Z"))
        XCTAssertNil(Formatting.isoDate("2023-05-06T01:39:13Z trailing"))
        XCTAssertNil(Formatting.isoDate("1683337153"))
    }

    func testIsoDayAndTimestamp() {
        let date = Date(timeIntervalSince1970: 1_683_337_153.937)
        XCTAssertEqual(Formatting.isoDay(date), "2023-05-06")
        XCTAssertEqual(Formatting.isoTimestamp(date), "2023-05-06T01:39:13.937Z")
        XCTAssertEqual(Formatting.isoDay(Date(timeIntervalSince1970: 0)), "1970-01-01")
    }

    func testIsoDateRoundTripsThroughIsoTimestamp() throws {
        let original = Date(timeIntervalSince1970: 1_700_000_000.123)
        let parsed = try XCTUnwrap(Formatting.isoDate(Formatting.isoTimestamp(original)))
        XCTAssertEqual(parsed.timeIntervalSince1970, original.timeIntervalSince1970, accuracy: 0.0005)
    }
}
