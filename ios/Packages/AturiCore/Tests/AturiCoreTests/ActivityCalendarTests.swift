import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/activity.test.ts`.
///
/// Days are the viewer's local days, so the tests pin a zone with daylight
/// saving, as the web's do with `TZ`: New York springs forward on 8 March
/// 2026 and falls back on 1 November 2026. The zone is handed to each
/// function as a `Calendar` rather than set for the process.
/// New York, the web tests' `TZ`.
let activityNewYork: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/New_York")!
    return calendar
}()

/// `new Date(year, month - 1, day, hour, minute)` in New York.
func activityLocal(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
    activityNewYork.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
}

/// A record key made at a local date and time in New York.
func activityTid(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0) -> String {
    let ms = Int64((activityLocal(year, month, day, hour, minute).timeIntervalSince1970 * 1000).rounded())
    return toolsTid(ms: ms)
}

final class ActivityCalendarTests: XCTestCase {
    private typealias Scan = ActivityCalendar.CollectionScan

    private var ny: Calendar { activityNewYork }

    private func local(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        activityLocal(year, month, day, hour, minute)
    }

    private func tidAt(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0) -> String {
        activityTid(year, month, day, hour, minute)
    }

    private func utc(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func makeWindow(_ now: Date, weeks: Int = ActivityCalendar.calendarWeeks) -> ActivityCalendar.Window {
        ActivityCalendar.buildWindow(now: now, weekCount: weeks, calendar: ny)
    }

    private func key(_ date: Date) -> String {
        ActivityCalendar.dayKey(date, calendar: ny)
    }

    private func date(_ key: String) -> Date {
        ActivityCalendar.dateFromKey(key, calendar: ny)!
    }

    private func weekday(_ key: String) -> Int {
        ny.component(.weekday, from: date(key)) - 1
    }

    private func tally(_ scan: Scan, _ records: [ActivityCalendar.KeyedRecord], _ window: ActivityCalendar.Window) -> ActivityCalendar.Tally {
        ActivityCalendar.tallyPage(scan, records: records, window: window, calendar: ny)
    }

    private func scanOf(_ collection: String, _ days: [String: Int]) -> Scan {
        Scan(collection: collection, days: days, counted: days.values.reduce(0, +), state: .done)
    }

    // MARK: Input

    func testNormalizeActorInputAcceptsHandlesDidsAndProfileLinks() {
        XCTAssertEqual(ActivityCalendar.normalizeActorInput(" @Alice.Example.com "), .ok(actor: "alice.example.com"))
        XCTAssertEqual(
            ActivityCalendar.normalizeActorInput("did:plc:z72i7hdynmk6r22z27h6tvur"),
            .ok(actor: "did:plc:z72i7hdynmk6r22z27h6tvur")
        )
        XCTAssertEqual(ActivityCalendar.normalizeActorInput("did:web:example.com"), .ok(actor: "did:web:example.com"))
        XCTAssertEqual(
            ActivityCalendar.normalizeActorInput("at://alice.example.com/app.bsky.feed.post/3kabc"),
            .ok(actor: "alice.example.com")
        )
        XCTAssertEqual(
            ActivityCalendar.normalizeActorInput("https://bsky.app/profile/alice.example.com/post/3kabc"),
            .ok(actor: "alice.example.com")
        )
        XCTAssertEqual(
            ActivityCalendar.normalizeActorInput("https://aturi.to/explore/did:plc:z72i7hdynmk6r22z27h6tvur"),
            .ok(actor: "did:plc:z72i7hdynmk6r22z27h6tvur")
        )
        XCTAssertEqual(ActivityCalendar.normalizeActorInput("https://alice.example.com/"), .ok(actor: "alice.example.com"))
        XCTAssertNil(ActivityCalendar.normalizeActorInput("").actor)
        XCTAssertNil(ActivityCalendar.normalizeActorInput("alice").actor)
        XCTAssertNil(ActivityCalendar.normalizeActorInput("did:plc:short").actor)
        XCTAssertNil(ActivityCalendar.normalizeActorInput("not a handle").actor)
    }

    // MARK: Days

    func testAMomentBelongsToTheLocalDayNotTheUTCOne() {
        // 02:30 UTC on 4 March is still the evening of 3 March in New York.
        XCTAssertEqual(key(utc(2026, 3, 4, 2, 30)), "2026-03-03")
        XCTAssertEqual(key(utc(2026, 3, 4, 5, 0)), "2026-03-04")
        XCTAssertEqual(key(local(2026, 1, 5)), "2026-01-05")
        XCTAssertEqual(date("2026-01-05"), local(2026, 1, 5))
        XCTAssertNil(ActivityCalendar.dateFromKey("not a day", calendar: ny))
    }

    // MARK: The window

    func testTheWindowIs53WholeWeeksEndingWithTheWeekTodayIsIn() {
        // Thursday 12 November 2026, mid-afternoon.
        let window = makeWindow(local(2026, 11, 12, 15, 30))
        XCTAssertEqual(window.weeks.count, 53)
        XCTAssertTrue(window.weeks.allSatisfy { $0.count == 7 })
        XCTAssertEqual(window.todayKey, "2026-11-12")
        // The current week starts on Sunday 8 November; 52 weeks before is 9 November 2025.
        XCTAssertEqual(window.firstKey, "2025-11-09")
        XCTAssertEqual(window.weeks[0][0], "2025-11-09")
        XCTAssertEqual(weekday(window.firstKey), 0)
        // The last column holds Sunday to Thursday, then two days that have not happened.
        XCTAssertEqual(window.weeks[52], ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", nil, nil])
        XCTAssertEqual(window.start, local(2025, 11, 9))
        XCTAssertEqual(window.end, local(2026, 11, 13))
        XCTAssertEqual(ActivityCalendar.windowDays(window).count, 52 * 7 + 5)
    }

    func testEveryDayIsOneCalendarDayAfterTheLastAcrossBothClockChanges() {
        let keys = ActivityCalendar.windowDays(makeWindow(local(2026, 11, 12)))
        XCTAssertEqual(Set(keys).count, keys.count)
        for index in 1..<keys.count {
            let next = ny.date(byAdding: .day, value: 1, to: date(keys[index - 1]))!
            XCTAssertEqual(keys[index], key(next))
        }
        // The 23-hour day and the 25-hour day are both there, once each.
        XCTAssertTrue(keys.contains("2026-03-08"))
        XCTAssertTrue(keys.contains("2026-03-09"))
        XCTAssertTrue(keys.contains("2026-11-01"))
        XCTAssertTrue(keys.contains("2026-11-02"))
        // Every column starts on a Sunday, clock changes or not.
        for week in makeWindow(local(2026, 11, 12)).weeks {
            XCTAssertEqual(weekday(week[0]!), 0)
        }
    }

    func testTheWindowCrossesAYearBoundaryWithoutLosingADay() {
        // Saturday 3 January 2026: the current week began in the old year.
        let window = makeWindow(local(2026, 1, 3, 9))
        XCTAssertEqual(window.todayKey, "2026-01-03")
        XCTAssertEqual(window.weeks[52], [
            "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03",
        ])
        XCTAssertEqual(window.firstKey, "2024-12-29")
        XCTAssertEqual(ActivityCalendar.windowDays(window).count, 53 * 7)
    }

    func testAWindowThatEndsOnASundayHasALastColumnOfOneDay() {
        let window = makeWindow(local(2026, 11, 8, 0, 5))
        XCTAssertEqual(window.weeks[52], ["2026-11-08", nil, nil, nil, nil, nil, nil])
        XCTAssertEqual(window.firstKey, "2025-11-09")
    }

    func testMonthLabelsSitOnTheFirstColumnThatStartsInEachMonth() {
        let window = makeWindow(local(2026, 11, 12))
        XCTAssertEqual(
            window.months.map { $0.label },
            ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]
        )
        for month in window.months where month.column > 0 {
            let sunday = ny.component(.month, from: date(window.weeks[month.column][0]!))
            let before = ny.component(.month, from: date(window.weeks[month.column - 1][0]!))
            XCTAssertNotEqual(sunday, before)
        }
        // Columns strictly increase, so labels never collide.
        for index in 1..<window.months.count {
            XCTAssertGreaterThanOrEqual(window.months[index].column - window.months[index - 1].column, 3)
        }
    }

    func testAFirstMonthWithUnderThreeColumnsGivesUpItsLabel() {
        // Wednesday 27 May 2026: the window opens on Sunday 25 May 2025, one
        // column before June starts.
        let window = makeWindow(local(2026, 5, 27))
        XCTAssertEqual(window.firstKey, "2025-05-25")
        XCTAssertEqual(window.months[0].label, "Jun")
        XCTAssertEqual(window.months[0].column, 1)
    }

    func testAShorterWindowIsTheSameShapeWithFewerColumns() {
        let window = makeWindow(local(2026, 11, 12), weeks: 26)
        XCTAssertEqual(window.weeks.count, 26)
        XCTAssertEqual(window.firstKey, "2026-05-17")
    }

    // MARK: Reading a collection

    func testRecordTimePrefersTheKeyThenCreatedAtThenGivesUp() {
        let tid = tidAt(2026, 6, 15, 9, 30)
        XCTAssertEqual(
            ActivityCalendar.recordTime(tid, createdAt: .string("2020-01-01T00:00:00Z")),
            ActivityCalendar.RecordTime(date: local(2026, 6, 15, 9, 30), fromKey: true)
        )
        XCTAssertEqual(
            ActivityCalendar.recordTime("self", createdAt: .string("2026-06-15T13:30:00.000Z")),
            ActivityCalendar.RecordTime(date: utc(2026, 6, 15, 13, 30), fromKey: false)
        )
        XCTAssertEqual(ActivityCalendar.recordTime("self", createdAt: nil), ActivityCalendar.RecordTime(date: nil, fromKey: false))
        XCTAssertEqual(
            ActivityCalendar.recordTime("whats-hot", createdAt: .string("yesterday")),
            ActivityCalendar.RecordTime(date: nil, fromKey: false)
        )
        XCTAssertEqual(ActivityCalendar.recordTime("self", createdAt: .number(12345)), ActivityCalendar.RecordTime(date: nil, fromKey: false))
    }

    func testTallyPageCountsRecordsByLocalDayAndStopsAtAKeyOlderThanTheWindow() {
        let window = makeWindow(local(2026, 11, 12, 15))
        let page = [
            ActivityCalendar.KeyedRecord(rkey: tidAt(2026, 11, 12, 9)),
            ActivityCalendar.KeyedRecord(rkey: tidAt(2026, 11, 12, 8)),
            // 23:30 local on the 11th is already the 12th in UTC.
            ActivityCalendar.KeyedRecord(rkey: tidAt(2026, 11, 11, 23, 30)),
            ActivityCalendar.KeyedRecord(rkey: tidAt(2025, 11, 9, 0, 0)),
            ActivityCalendar.KeyedRecord(rkey: tidAt(2025, 11, 8, 23, 59)),
            ActivityCalendar.KeyedRecord(rkey: tidAt(2025, 6, 1)),
        ]
        let result = tally(ActivityCalendar.emptyScan("app.bsky.feed.post"), page, window)
        XCTAssertTrue(result.passedWindow)
        XCTAssertEqual(result.scan.days, ["2026-11-12": 2, "2026-11-11": 1, "2025-11-09": 1])
        XCTAssertEqual(result.scan.counted, 4)
        XCTAssertEqual(result.scan.undated, 0)
        XCTAssertEqual(result.scan.pages, 1)
        // The key that ended the read is the oldest moment seen, not the one after it.
        XCTAssertEqual(result.scan.reached, local(2025, 11, 8, 23, 59))
    }

    func testTallyPageKeepsReadingWhenEveryKeyIsInsideTheWindow() {
        let window = makeWindow(local(2026, 11, 12))
        let first = tally(
            ActivityCalendar.emptyScan("app.bsky.feed.like"),
            [.init(rkey: tidAt(2026, 11, 1)), .init(rkey: tidAt(2026, 10, 1))],
            window
        )
        XCTAssertFalse(first.passedWindow)
        let second = tally(first.scan, [.init(rkey: tidAt(2026, 10, 1, 8)), .init(rkey: tidAt(2026, 9, 1))], window)
        XCTAssertFalse(second.passedWindow)
        XCTAssertEqual(second.scan.days, ["2026-11-01": 1, "2026-10-01": 2, "2026-09-01": 1])
        XCTAssertEqual(second.scan.counted, 4)
        XCTAssertEqual(second.scan.pages, 2)
        // The input is not changed in place: a published snapshot stays what it was.
        XCTAssertEqual(first.scan.days, ["2026-11-01": 1, "2026-10-01": 1])
    }

    func testKeysWithoutATimeFallBackToCreatedAtAndAnOldCreatedAtDoesNotStopTheRead() {
        let window = makeWindow(local(2026, 11, 12))
        let result = tally(
            ActivityCalendar.emptyScan("app.bsky.feed.generator"),
            [
                .init(rkey: "whats-hot", createdAt: .string("2026-08-02T15:00:00.000Z")),
                .init(rkey: "old-feed", createdAt: .string("2023-05-01T00:00:00.000Z")),
                .init(rkey: "no-date"),
                .init(rkey: "newer", createdAt: .string("2026-08-03T15:00:00.000Z")),
            ],
            window
        )
        // Custom keys sort as text, so an old record says nothing about the next.
        XCTAssertFalse(result.passedWindow)
        XCTAssertEqual(result.scan.days, ["2026-08-02": 1, "2026-08-03": 1])
        XCTAssertEqual(result.scan.undated, 1)
        XCTAssertNil(result.scan.reached)
    }

    func testAKeyDatedWellIntoTheFutureIsLeftOutAndASlightlyFastClockLandsOnToday() {
        let window = makeWindow(local(2026, 11, 12, 15))
        let result = tally(
            ActivityCalendar.emptyScan("app.bsky.feed.post"),
            [.init(rkey: tidAt(2027, 3, 1)), .init(rkey: tidAt(2026, 11, 13, 0, 20)), .init(rkey: tidAt(2026, 11, 12, 10))],
            window
        )
        XCTAssertFalse(result.passedWindow)
        XCTAssertEqual(result.scan.days, ["2026-11-12": 2])
        XCTAssertEqual(result.scan.counted, 2)
    }

    func testAnEmptyPageChangesNothingButThePageCount() {
        let window = makeWindow(local(2026, 11, 12))
        let result = tally(ActivityCalendar.emptyScan("app.bsky.feed.post"), [], window)
        XCTAssertFalse(result.passedWindow)
        XCTAssertEqual(result.scan.days, [:])
        XCTAssertEqual(result.scan.pages, 1)
    }

    // MARK: Adding up

    private var posts: Scan { scanOf("app.bsky.feed.post", ["2026-11-10": 2, "2026-11-11": 1]) }
    private var likes: Scan { scanOf("app.bsky.feed.like", ["2026-11-11": 5]) }
    private var entries: Scan { scanOf("com.whtwnd.blog.entry", ["2026-11-12": 1]) }
    private var profile: Scan { scanOf("app.bsky.actor.profile", [:]) }

    func testAppOfIsTheFirstTwoSegmentsOfAnNSID() {
        XCTAssertEqual(ActivityCalendar.appOf("app.bsky.feed.post"), "app.bsky")
        XCTAssertEqual(ActivityCalendar.appOf("com.whtwnd.blog.entry"), "com.whtwnd")
        XCTAssertEqual(ActivityCalendar.appOf("is.dame"), "is.dame")
        XCTAssertEqual(ActivityCalendar.appOf("odd"), "odd")
    }

    func testSumDaysAddsCollectionsTogetherAndHonoursAFilter() {
        let all = [posts, likes, entries, profile]
        XCTAssertEqual(ActivityCalendar.sumDays(all), ["2026-11-10": 2, "2026-11-11": 6, "2026-11-12": 1])
        XCTAssertEqual(
            ActivityCalendar.sumDays(all, filter: ActivityCalendar.Filter(by: .app, key: "app.bsky")),
            ["2026-11-10": 2, "2026-11-11": 6]
        )
        XCTAssertEqual(ActivityCalendar.sumDays(all, filter: ActivityCalendar.Filter(by: .collection, key: "app.bsky.feed.like")), ["2026-11-11": 5])
        XCTAssertEqual(ActivityCalendar.sumDays(all, filter: ActivityCalendar.Filter(by: .app, key: "nobody.here")), [:])
        XCTAssertEqual(ActivityCalendar.sumDays([]), [:])
    }

    func testTotalsByRanksAppsAndCollectionsAndLeavesOutTheEmptyOnes() {
        let all = [posts, likes, entries, profile]
        XCTAssertEqual(ActivityCalendar.totalsBy(all, by: .app), [
            ActivityCalendar.Share(key: "app.bsky", count: 8, share: 8.0 / 9.0, collections: 2),
            ActivityCalendar.Share(key: "com.whtwnd", count: 1, share: 1.0 / 9.0, collections: 1),
        ])
        XCTAssertEqual(ActivityCalendar.totalsBy(all, by: .collection).map { $0.key }, [
            "app.bsky.feed.like", "app.bsky.feed.post", "com.whtwnd.blog.entry",
        ])
        XCTAssertEqual(ActivityCalendar.totalsBy(all, by: .collection).map { $0.count }, [5, 3, 1])
        XCTAssertEqual(ActivityCalendar.totalsBy([profile], by: .app), [])
    }

    func testDayBreakdownListsWhatWasWrittenOnOneDayLargestFirst() {
        let all = [posts, likes, entries]
        XCTAssertEqual(ActivityCalendar.dayBreakdown(all, key: "2026-11-11"), [
            ActivityCalendar.CollectionCount(collection: "app.bsky.feed.like", count: 5),
            ActivityCalendar.CollectionCount(collection: "app.bsky.feed.post", count: 1),
        ])
        XCTAssertEqual(ActivityCalendar.dayBreakdown(all, key: "2026-01-01"), [])
    }

    // MARK: Intensity

    func testIntensityStepsComeFromTheQuartilesOfTheActiveDays() {
        let thresholds = ActivityCalendar.intensityThresholds([0, 0, 1, 2, 3, 4, 5, 6, 7, 8])
        XCTAssertEqual(thresholds, [3, 5, 7])
        XCTAssertEqual(ActivityCalendar.intensityLevel(0, thresholds: thresholds), 0)
        XCTAssertEqual(ActivityCalendar.intensityLevel(1, thresholds: thresholds), 1)
        XCTAssertEqual(ActivityCalendar.intensityLevel(3, thresholds: thresholds), 1)
        XCTAssertEqual(ActivityCalendar.intensityLevel(4, thresholds: thresholds), 2)
        XCTAssertEqual(ActivityCalendar.intensityLevel(6, thresholds: thresholds), 3)
        XCTAssertEqual(ActivityCalendar.intensityLevel(8, thresholds: thresholds), 4)
    }

    func testOneEnormousDayDoesNotFlattenTheRest() {
        let thresholds = ActivityCalendar.intensityThresholds([1, 1, 2, 2, 3, 3, 4, 4, 10000])
        XCTAssertEqual(ActivityCalendar.intensityLevel(1, thresholds: thresholds), 1)
        XCTAssertGreaterThan(
            ActivityCalendar.intensityLevel(3, thresholds: thresholds),
            ActivityCalendar.intensityLevel(1, thresholds: thresholds)
        )
        XCTAssertEqual(ActivityCalendar.intensityLevel(10000, thresholds: thresholds), 4)
    }

    func testIntensityCopesWithNothingAndWithEveryDayTheSame() {
        XCTAssertEqual(ActivityCalendar.intensityThresholds([]), [0, 0, 0])
        XCTAssertEqual(ActivityCalendar.intensityThresholds([0, 0]), [0, 0, 0])
        XCTAssertEqual(ActivityCalendar.intensityLevel(0, thresholds: [0, 0, 0]), 0)
        let same = ActivityCalendar.intensityThresholds([2, 2, 2])
        XCTAssertEqual(same, [2, 2, 2])
        XCTAssertEqual(ActivityCalendar.intensityLevel(2, thresholds: same), 1)
    }

    // MARK: Summary

    func testSummarizeFindsTheBusiestDayTheLongestStreakAndTheBusiestMonth() {
        let window = makeWindow(local(2026, 11, 12))
        let days = [
            // A three-day run across the spring clock change.
            "2026-03-07": 1,
            "2026-03-08": 4,
            "2026-03-09": 1,
            // A two-day run across the year boundary.
            "2025-12-31": 2,
            "2026-01-01": 2,
            "2026-07-04": 9,
            // Outside the window: not counted.
            "2024-01-01": 50,
        ]
        let summary = ActivityCalendar.summarize(days, window: window)
        XCTAssertEqual(summary.total, 19)
        XCTAssertEqual(summary.activeDays, 6)
        XCTAssertEqual(summary.windowDays, 52 * 7 + 5)
        XCTAssertEqual(summary.busiestDay, ActivityCalendar.DayCount(key: "2026-07-04", count: 9))
        XCTAssertEqual(summary.longestStreak, ActivityCalendar.Streak(days: 3, startKey: "2026-03-07", endKey: "2026-03-09"))
        XCTAssertEqual(summary.busiestMonth, ActivityCalendar.MonthCount(label: "July 2026", count: 9))
    }

    func testAStreakCanRunAcrossTheAutumnClockChangeAndUpToToday() {
        let window = makeWindow(local(2026, 11, 12))
        var days: [String: Int] = [:]
        for day in 28...31 {
            days["2026-10-\(day)"] = 1
        }
        for day in 1...12 {
            days["2026-11-\(day < 10 ? "0\(day)" : String(day))"] = 1
        }
        let summary = ActivityCalendar.summarize(days, window: window)
        XCTAssertEqual(summary.longestStreak, ActivityCalendar.Streak(days: 16, startKey: "2026-10-28", endKey: "2026-11-12"))
        XCTAssertEqual(summary.busiestMonth, ActivityCalendar.MonthCount(label: "November 2026", count: 12))
    }

    func testAnAccountWithNothingInTheWindowSummarizesToZeros() {
        let window = makeWindow(local(2026, 11, 12))
        XCTAssertEqual(
            ActivityCalendar.summarize([:], window: window),
            ActivityCalendar.Summary(
                total: 0,
                activeDays: 0,
                windowDays: 52 * 7 + 5,
                busiestDay: nil,
                longestStreak: nil,
                busiestMonth: nil
            )
        )
        XCTAssertEqual(ActivityCalendar.sumDays([profile]), [:])
        XCTAssertEqual(ActivityCalendar.totalsBy([profile], by: .collection), [])
    }
}
