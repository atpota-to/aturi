import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Fragment-keyed transport whose answers can change between loads, so a
/// test can take the station or the almanac down for a refresh.
private final class WeatherFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private var replies: [(fragment: String, reply: Reply)]
    private var recorded: [URLRequest] = []

    init(_ replies: [(String, Reply)]) {
        self.replies = replies.map { (fragment: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = answer(request)
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

    /// Locking stays in synchronous helpers: NSLock is not async-safe.
    private func answer(_ request: URLRequest) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(request)
        let url = request.url?.absoluteString ?? ""
        return replies.first { url.contains($0.fragment) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    func set(_ fragment: String, _ reply: Reply) {
        lock.lock(); defer { lock.unlock() }
        replies = replies.filter { $0.fragment != fragment } + [(fragment: fragment, reply: reply)]
    }

    func requests(containing fragment: String) -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.url?.absoluteString.contains(fragment) ?? false }
    }
}

/// A clock the test moves by hand.
private final class WeatherTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(seconds)
    }
}

@MainActor
final class AtmosphericConditionsModelTests: XCTestCase {
    private nonisolated static let station = "atpota.to/api/atmosphere"
    private nonisolated static let almanac = "atpota.to/api/weather-almanac"
    private nonisolated static let down = WeatherFakeTransport.Reply(status: 503, body: #"{"error":"unavailable"}"#)

    private func transport(
        station: WeatherFakeTransport.Reply = .init(status: 200, body: AtpotatoWeatherTests.atmosphereBody),
        almanac: WeatherFakeTransport.Reply = .init(status: 200, body: AtpotatoWeatherTests.almanacBody)
    ) -> WeatherFakeTransport {
        WeatherFakeTransport([(Self.station, station), (Self.almanac, almanac)])
    }

    private func makeModel(_ transport: WeatherFakeTransport, clock: WeatherTestClock = WeatherTestClock(Date(timeIntervalSince1970: 1_795_115_830))) -> AtmosphericConditionsModel {
        AtmosphericConditionsModel(http: HTTPClient(transport: transport), clock: { clock.now })
    }

    func testBeforeTheFirstLoadNothingIsDown() {
        let model = makeModel(transport())
        XCTAssertFalse(model.hasLoaded)
        XCTAssertFalse(model.isDown)
        XCTAssertNil(model.measuredAt)
        XCTAssertEqual(model.stats.map(\.label), ["Right now", "Against usual", "Diversity index", "Hosting diversity"])
        XCTAssertEqual(model.stats.map(\.value), [nil, nil, nil, nil])
    }

    func testALoadReadsBothEndpointsAndFillsTheFourStats() async {
        let fake = transport()
        let model = makeModel(fake)
        await model.load().value

        XCTAssertTrue(model.hasLoaded)
        XCTAssertFalse(model.isDown)
        XCTAssertEqual(model.measuredAt?.timeIntervalSince1970 ?? 0, 1_795_115_824, accuracy: 0.001)
        XCTAssertEqual(model.rightNow, AtmosphericStat(label: "Right now", value: "Breezy", note: "497 records a second \u{00B7} 12,456 accounts"))
        XCTAssertEqual(model.againstUsual, AtmosphericStat(label: "Against usual", value: "+6%", note: "About as busy as usual over the last hour"))
        XCTAssertEqual(model.diversity, AtmosphericStat(
            label: "Diversity index", value: "3.47", level: "moderate",
            note: "0.75% of active accounts write with 25 other apps"
        ))
        XCTAssertEqual(model.hosting, AtmosphericStat(
            label: "Hosting diversity", value: "9.08", level: "early days",
            note: "1.68% of accounts on 1,940 independent PDSes"
        ))

        XCTAssertEqual(fake.requests(containing: Self.station).map { $0.url?.absoluteString }, ["https://atpota.to/api/atmosphere"])
        XCTAssertEqual(fake.requests(containing: Self.almanac).map { $0.url?.absoluteString }, ["https://atpota.to/api/weather-almanac?tz=UTC"])
        XCTAssertEqual(fake.requests(containing: Self.station).first?.value(forHTTPHeaderField: "Accept"), "application/json")
    }

    func testAFailedRefreshKeepsTheLastReading() async {
        let fake = transport()
        let model = makeModel(fake)
        await model.load().value
        let first = model.stats

        fake.set(Self.station, Self.down)
        fake.set(Self.almanac, Self.down)
        await model.load().value

        XCTAssertEqual(model.stats, first)
        XCTAssertEqual(model.reading?.condition, "breezy")
        XCTAssertEqual(model.usual?.changePercent, 6)
        XCTAssertFalse(model.isDown)
        XCTAssertEqual(fake.requests(containing: Self.station).count, 2)
    }

    func testAnAlmanacWithNothingToCompareYetClearsTheUsual() async {
        let fake = transport()
        let model = makeModel(fake)
        await model.load().value
        XCTAssertNotNil(model.usual)

        // Twenty minutes of now and no earlier windows: still learning.
        fake.set(Self.almanac, .init(status: 200, body: #"{"normal":{"now":{"seconds":1200,"creates":600000},"days":{"seconds":0,"creates":0,"windows":0},"weeks":{"seconds":0,"creates":0,"windows":0}}}"#))
        await model.load().value

        XCTAssertNil(model.usual)
        XCTAssertEqual(model.againstUsual, AtmosphericStat(label: "Against usual", value: nil, note: "Still learning what usual looks like"))
    }

    func testTheDaysBeforeStandInUntilAWeekdayIsHeard() async throws {
        let body = AtpotatoWeatherTests.almanacBody.replacingOccurrences(of: #""windows":6}}}"#, with: #""windows":0}}}"#)
        XCTAssertNotEqual(body, AtpotatoWeatherTests.almanacBody, "the fixture's weeks window should be the one rewritten")
        let model = makeModel(transport(almanac: .init(status: 200, body: body)))
        await model.load().value

        let usual = try XCTUnwrap(model.usual)
        XCTAssertEqual(usual.basis, .days)
        XCTAssertEqual(model.againstUsual.value, "+9%")
        XCTAssertEqual(model.againstUsual.note, "Busier than usual over the last hour")
    }

    func testBothDownSaysSo() async {
        let model = makeModel(transport(station: Self.down, almanac: Self.down))
        await model.load().value

        XCTAssertTrue(model.hasLoaded)
        XCTAssertTrue(model.isDown)
        XCTAssertEqual(model.rightNow.note, "The station isn\u{2019}t answering")
        XCTAssertEqual(model.againstUsual.note, "The almanac isn\u{2019}t answering")
    }

    func testTheAlmanacCanAnswerWhileTheStationIsDown() async {
        let model = makeModel(transport(station: Self.down))
        await model.load().value

        XCTAssertFalse(model.isDown)
        XCTAssertNil(model.reading)
        XCTAssertEqual(model.rightNow, AtmosphericStat(label: "Right now", value: nil, note: "The station isn\u{2019}t answering"))
        XCTAssertEqual(model.diversity.note, "The station isn\u{2019}t answering")
        XCTAssertEqual(model.againstUsual.value, "+6%")
    }

    func testAStationAnswerThatIsNotAReadingCountsAsDown() async {
        let model = makeModel(transport(station: .init(status: 200, body: #"{"ok":true}"#), almanac: Self.down))
        await model.load().value
        XCTAssertTrue(model.isDown)
    }

    func testAFallbackSampleSaysWhichPartsAreMissing() async {
        let sample = #"{"measuredAt":"2026-11-19T19:17:04.000Z","condition":"calm","records":{"perSecond":12.4},"diversity":{"index":1.2,"share":0.4,"apps":3},"source":"jetstream"}"#
        let model = makeModel(transport(station: .init(status: 200, body: sample)))
        await model.load().value

        XCTAssertEqual(model.rightNow, AtmosphericStat(label: "Right now", value: "Calm", note: "12 records a second"))
        XCTAssertEqual(model.diversity.level, "low")
        XCTAssertEqual(model.hosting, AtmosphericStat(label: "Hosting diversity", value: nil, note: "Not in this reading"))
    }

    func testRefreshIfStaleWaitsOutTheMinute() async {
        let fake = transport()
        let clock = WeatherTestClock(Date(timeIntervalSince1970: 1_795_115_830))
        let model = makeModel(fake, clock: clock)

        let first = model.refreshIfStale()
        XCTAssertNotNil(first, "nothing loaded yet")
        await first?.value
        XCTAssertEqual(fake.requests(containing: Self.station).count, 1)

        clock.advance(59)
        XCTAssertNil(model.refreshIfStale())
        XCTAssertEqual(fake.requests(containing: Self.station).count, 1)

        clock.advance(1)
        let second = model.refreshIfStale()
        XCTAssertNotNil(second)
        await second?.value
        XCTAssertEqual(fake.requests(containing: Self.station).count, 2)
        XCTAssertEqual(fake.requests(containing: Self.almanac).count, 2)
    }

    func testTheCardCopy() {
        XCTAssertEqual(AtmosphericConditionsModel.title, "Atmospheric conditions")
        XCTAssertEqual(AtmosphericConditionsModel.subtitle, "The last minute of the whole firehose, from atpota.to\u{2019}s weather station")
        XCTAssertEqual(AtmosphericConditionsModel.reportLinkLabel, "Full weather report")
        XCTAssertEqual(AtmosphericConditionsModel.refreshInterval, 60)
    }
}
