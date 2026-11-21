import Foundation
import XCTest
@testable import AturiCore

/// `AtpotatoWeather` against the thresholds in `src/utils/atpotatoWeather.ts`
/// and the shapes `AtmosphericConditions.tsx` reads.
final class AtpotatoWeatherTests: XCTestCase {
    /// A station reading trimmed from a real `/api/atmosphere` answer.
    static let atmosphereBody = #"{"measuredAt":"2026-11-19T19:17:04.000Z","seconds":60,"condition":"breezy","records":{"perSecond":496.7,"bluesky":432.8,"elsewhere":63.9},"diversity":{"index":3.47,"level":"moderate","share":0.75,"spread":21.38,"apps":25,"collections":51},"source":"station","accounts":{"active":12456,"bluesky":12389,"elsewhere":94,"index":0.75},"hosts":{"listed":6797,"active":2029,"independent":1940,"diversity":{"index":9.08,"share":1.68,"spread":29.24}}}"#

    /// The `normal` of a real `/api/weather-almanac?tz=UTC` answer.
    static let almanacBody = #"{"tz":"UTC","normal":{"historyStart":"2026-10-06T14:00:00.000Z","now":{"seconds":3480,"posts":168171,"creates":1727008,"elsewhere":163792},"days":{"seconds":21600,"posts":1042983,"creates":9822115,"elsewhere":61581,"windows":6},"weeks":{"seconds":21600,"posts":1079678,"creates":10083211,"elsewhere":40532,"windows":6}}}"#

    private func json(_ text: String) throws -> JSONValue {
        try JSONValue.parse(Data(text.utf8))
    }

    func testTheURLs() {
        XCTAssertEqual(AtpotatoWeather.atmosphereURL.absoluteString, "https://atpota.to/api/atmosphere")
        XCTAssertEqual(AtpotatoWeather.almanacURL.absoluteString, "https://atpota.to/api/weather-almanac?tz=UTC")
        XCTAssertEqual(AtpotatoWeather.weatherReportURL.absoluteString, "https://atpota.to/weather")
    }

    // MARK: Levels

    func testDiversityLevels() {
        XCTAssertEqual(AtpotatoWeather.diversityLevel(0), "low")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(2.99), "low")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(3), "moderate")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(5.99), "moderate")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(6), "high")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(8), "very high")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(10.99), "very high")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(11), "extreme")
        XCTAssertEqual(AtpotatoWeather.diversityLevel(40), "extreme")
    }

    func testHostingLevels() {
        XCTAssertEqual(AtpotatoWeather.hostingLevel(0), "early days")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(9.08), "early days")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(10), "taking root")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(25), "spreading")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(74.99), "spreading")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(75), "well spread")
        XCTAssertEqual(AtpotatoWeather.hostingLevel(200), "flourishing")
    }

    // MARK: Against usual

    /// Usual runs at one record a second, so `creates` over 2000 seconds of
    /// now is the ratio, and each edge divides exactly to its literal.
    private func compare(nowCreates: Double, nowSeconds: Double = 2_000, daysWindows: Double = 0, weeksWindows: Double = 4) -> UsualComparison? {
        AtpotatoWeather.compareWithUsual(
            now: HeardWindow(seconds: nowSeconds, creates: nowCreates),
            days: HeardWindow(seconds: 100, creates: 100, windows: daysWindows),
            weeks: HeardWindow(seconds: 100, creates: 100, windows: weeksWindows)
        )
    }

    func testVerdictsAtTheEdges() {
        XCTAssertEqual(compare(nowCreates: 2_500)?.verdict, "much busier than usual")
        XCTAssertEqual(compare(nowCreates: 2_500)?.changePercent, 25)
        XCTAssertEqual(compare(nowCreates: 2_160)?.verdict, "busier than usual")
        XCTAssertEqual(compare(nowCreates: 2_160)?.changePercent, 8)
        XCTAssertEqual(compare(nowCreates: 2_158)?.verdict, "about as busy as usual")
        XCTAssertEqual(compare(nowCreates: 2_000)?.verdict, "about as busy as usual")
        XCTAssertEqual(compare(nowCreates: 2_000)?.changePercent, 0)
        XCTAssertEqual(compare(nowCreates: 1_862)?.verdict, "about as busy as usual")
        XCTAssertEqual(compare(nowCreates: 1_860)?.verdict, "quieter than usual")
        XCTAssertEqual(compare(nowCreates: 1_860)?.changePercent, -7)
        XCTAssertEqual(compare(nowCreates: 1_600)?.verdict, "much quieter than usual")
        XCTAssertEqual(compare(nowCreates: 1_600)?.changePercent, -20)
        XCTAssertEqual(compare(nowCreates: 1_000)?.ratio ?? 0, 0.5, accuracy: 1e-12)
    }

    func testTheSameWeekdayWinsOverTheDaysBefore() {
        XCTAssertEqual(compare(nowCreates: 2_000, daysWindows: 6, weeksWindows: 4)?.basis, .weeks)
        XCTAssertEqual(compare(nowCreates: 2_000, daysWindows: 6, weeksWindows: 4)?.windows, 4)
        XCTAssertEqual(compare(nowCreates: 2_000, daysWindows: 6, weeksWindows: 0)?.basis, .days)
        XCTAssertEqual(compare(nowCreates: 2_000, daysWindows: 6, weeksWindows: 0)?.windows, 6)
        XCTAssertNil(compare(nowCreates: 2_000, daysWindows: 0, weeksWindows: 0), "nothing heard before")
    }

    func testLessThanHalfAnHourOfNowComparesNothing() {
        XCTAssertNil(compare(nowCreates: 1_799, nowSeconds: 1_799))
        XCTAssertEqual(compare(nowCreates: 1_800, nowSeconds: 1_800)?.changePercent, 0)
    }

    func testAnEmptyUsualComparesNothing() {
        let now = HeardWindow(seconds: 3_600, creates: 3_600)
        XCTAssertNil(AtpotatoWeather.compareWithUsual(
            now: now, days: HeardWindow(seconds: 0, creates: 0), weeks: HeardWindow(seconds: 3_600, creates: 0, windows: 2)
        ))
        XCTAssertNil(AtpotatoWeather.compareWithUsual(
            now: now, days: HeardWindow(seconds: 0, creates: 0), weeks: HeardWindow(seconds: 0, creates: 3_600, windows: 2)
        ))
    }

    func testRoundingTakesHalvesUpAsJavaScriptDoes() {
        XCTAssertEqual(AtpotatoWeather.roundHalfUp(2.5), 3)
        XCTAssertEqual(AtpotatoWeather.roundHalfUp(-2.5), -2)
        XCTAssertEqual(AtpotatoWeather.roundHalfUp(-2.6), -3)
        XCTAssertEqual(AtpotatoWeather.roundHalfUp(496.7), 497)
    }

    // MARK: Reading the endpoints

    func testAReadingFromTheStation() throws {
        let body = try json(Self.atmosphereBody)
        let reading = try XCTUnwrap(AtpotatoWeather.reading(from: body))
        XCTAssertEqual(reading.measuredAt, "2026-11-19T19:17:04.000Z")
        XCTAssertEqual(reading.condition, "breezy")
        XCTAssertEqual(reading.recordsPerSecond, 496.7)
        XCTAssertEqual(reading.accounts, 12_456)
        XCTAssertEqual(reading.diversity, AtmosphereReading.Diversity(index: 3.47, level: "moderate", share: 0.75, apps: 25))
        XCTAssertEqual(reading.hosts, AtmosphereReading.Hosts(index: 9.08, share: 1.68, independent: 1_940))
    }

    func testAFallbackSampleLeavesItsMissingPartsOut() throws {
        // No accounts or hosts, and a diversity with no word of its own.
        let body = try json(#"{"measuredAt":"2026-11-19T19:17:04.000Z","condition":"calm","records":{"perSecond":12},"diversity":{"index":6.2},"source":"jetstream"}"#)
        let reading = try XCTUnwrap(AtpotatoWeather.reading(from: body))
        XCTAssertNil(reading.accounts)
        XCTAssertNil(reading.hosts)
        XCTAssertEqual(reading.diversity, AtmosphereReading.Diversity(index: 6.2, level: "high", share: 0, apps: 0))
    }

    func testHostsNeedTheirIndexAndIndependentCount() throws {
        let noCount = try json(#"{"measuredAt":"t","condition":"calm","records":{"perSecond":1},"hosts":{"diversity":{"index":9}}}"#)
        let noCountReading = try XCTUnwrap(AtpotatoWeather.reading(from: noCount))
        XCTAssertNil(noCountReading.hosts)
        let noIndex = try json(#"{"measuredAt":"t","condition":"calm","records":{"perSecond":1},"hosts":{"independent":4,"diversity":{"share":1}}}"#)
        let noIndexReading = try XCTUnwrap(AtpotatoWeather.reading(from: noIndex))
        XCTAssertNil(noIndexReading.hosts)
    }

    func testAReadingNeedsItsTimeConditionAndRate() throws {
        XCTAssertNil(AtpotatoWeather.reading(from: try json(#"{"condition":"calm","records":{"perSecond":1}}"#)))
        XCTAssertNil(AtpotatoWeather.reading(from: try json(#"{"measuredAt":"t","records":{"perSecond":1}}"#)))
        XCTAssertNil(AtpotatoWeather.reading(from: try json(#"{"measuredAt":"t","condition":"calm","records":{"perSecond":"1"}}"#)))
        XCTAssertNil(AtpotatoWeather.reading(from: try json(#"{"measuredAt":"t","condition":"calm","records":[1]}"#)))
        XCTAssertNil(AtpotatoWeather.reading(from: try json(#"[1,2,3]"#)))
    }

    func testTheUsualFromTheAlmanac() throws {
        let body = try json(Self.almanacBody)
        let usual = try XCTUnwrap(AtpotatoWeather.usual(from: body))
        XCTAssertEqual(usual.basis, .weeks)
        XCTAssertEqual(usual.windows, 6)
        XCTAssertEqual(usual.ratio, 1.0630899, accuracy: 1e-6)
        XCTAssertEqual(usual.changePercent, 6)
        XCTAssertEqual(usual.verdict, "about as busy as usual")
    }

    func testTheUsualNeedsAllThreeWindows() throws {
        let noDays = #"{"normal":{"now":{"seconds":3600,"creates":10},"weeks":{"seconds":3600,"creates":10,"windows":1}}}"#
        XCTAssertNil(AtpotatoWeather.usual(from: try json(noDays)))
        XCTAssertNil(AtpotatoWeather.usual(from: try json(#"{"today":{}}"#)))
    }

    // MARK: Formats

    func testWholeNumbers() {
        XCTAssertEqual(AtpotatoWeather.whole(496.7), "497")
        XCTAssertEqual(AtpotatoWeather.whole(12_456), "12,456")
        XCTAssertEqual(AtpotatoWeather.whole(1_234_567.4), "1,234,567")
        XCTAssertEqual(AtpotatoWeather.whole(0.5), "1")
        XCTAssertEqual(AtpotatoWeather.whole(0), "0")
    }

    func testPercentages() {
        XCTAssertEqual(AtpotatoWeather.percent(0.75), "0.75%")
        XCTAssertEqual(AtpotatoWeather.percent(1.68), "1.68%")
        XCTAssertEqual(AtpotatoWeather.percent(1.5), "1.5%")
        XCTAssertEqual(AtpotatoWeather.percent(0.1), "0.1%")
        XCTAssertEqual(AtpotatoWeather.percent(0.05), "0.05%")
        XCTAssertEqual(AtpotatoWeather.percent(12), "12%")
        XCTAssertEqual(AtpotatoWeather.percent(1_234.5), "1,234.5%")
        XCTAssertEqual(AtpotatoWeather.percent(0.004), "0%")
    }

    func testIndexChangeAndCapitalization() {
        XCTAssertEqual(AtpotatoWeather.indexText(3.47), "3.47")
        XCTAssertEqual(AtpotatoWeather.indexText(2), "2.00")
        XCTAssertEqual(AtpotatoWeather.changeText(0), "\u{00B1}0%")
        XCTAssertEqual(AtpotatoWeather.changeText(5), "+5%")
        XCTAssertEqual(AtpotatoWeather.changeText(-7), "\u{2212}7%")
        XCTAssertEqual(AtpotatoWeather.capitalize("breezy"), "Breezy")
        XCTAssertEqual(AtpotatoWeather.capitalize("much busier than usual"), "Much busier than usual")
        XCTAssertEqual(AtpotatoWeather.capitalize(""), "")
    }
}
