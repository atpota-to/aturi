import Foundation

/// The activity calendar's arithmetic: which day a record belongs to, the
/// grid of days the calendar draws, and what the counts add up to. Port of
/// `src/lib/tools/activity.ts`.
///
/// Most record keys are TIDs, and a TID is a timestamp: the microsecond the
/// key was made, which is to say when the record was created. So an
/// account's year can be read from its keys alone, without keeping a single
/// record body. Keys that are not TIDs (`self`, a feed generator's name)
/// carry no time; for those the record's own `createdAt` stands in, and a
/// record with neither is counted as undated rather than guessed at.
///
/// Two things follow from reading keys, and the page says both. Only
/// records that still exist are counted: a deleted post or an undone like
/// leaves no key behind. And a record is counted once, on the day it was
/// created, so a profile edited every week still shows as one day.
///
/// Everything here is pure. Days are the viewer's local days, so every
/// function that names a day takes the `Calendar` whose time zone decides
/// them (the device's, unless a test pins one), and every date is reached
/// by calendar days rather than by adding 24 hours, which would drift
/// across a daylight-saving change. The web's epoch milliseconds are
/// `Date`s here. The reading itself (the requests, the budget) is in
/// `ActivityCalendarScan`.
public enum ActivityCalendar {
    // MARK: - Input

    public enum ActorInput: Hashable, Sendable {
        case ok(actor: String)
        case invalid(reason: String)

        public var actor: String? {
            if case .ok(let actor) = self { return actor }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }
    }

    /// The first non-empty path segment after `/profile/` or `/explore/`,
    /// in either case: the web's `PROFILE_PATH`.
    static func profilePathSegment(_ link: String) -> String? {
        var searchStart = link.startIndex
        while searchStart < link.endIndex {
            let candidates = ["/profile/", "/explore/"].compactMap {
                link.range(of: $0, options: .caseInsensitive, range: searchStart..<link.endIndex)
            }
            guard let first = candidates.min(by: { $0.lowerBound < $1.lowerBound }) else { return nil }
            let segment = link[first.upperBound...].prefix { $0 != "/" && $0 != "?" && $0 != "#" }
            if !segment.isEmpty { return String(segment) }
            searchStart = link.index(after: first.lowerBound)
        }
        return nil
    }

    /* The character classes of the web's patterns, by code point. */

    /// `[a-z2-7]`
    private static func isLowerBase32(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x61...0x7A, 0x32...0x37: return true
        default: return false
        }
    }

    /// `[A-Za-z0-9.%:_-]`
    private static func isDidWebCharacter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x61...0x7A, 0x41...0x5A, 0x30...0x39, 0x2E, 0x25, 0x3A, 0x5F, 0x2D: return true
        default: return false
        }
    }

    /// `[a-z0-9-]`
    private static func isHandleCharacter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x61...0x7A, 0x30...0x39, 0x2D: return true
        default: return false
        }
    }

    /// `^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)$`
    static func isCalendarDid(_ value: String) -> Bool {
        if value.hasPrefix("did:plc:") {
            let rest = value.dropFirst("did:plc:".count).unicodeScalars
            return rest.count == 24 && rest.allSatisfy(isLowerBase32)
        }
        if value.hasPrefix("did:web:") {
            let rest = value.dropFirst("did:web:".count).unicodeScalars
            return !rest.isEmpty && rest.allSatisfy(isDidWebCharacter)
        }
        return false
    }

    /// `^[a-z0-9-]+(\.[a-z0-9-]+)+$`
    static func isCalendarHandle(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2 else { return false }
        return parts.allSatisfy { part in
            !part.isEmpty && part.unicodeScalars.allSatisfy(isHandleCharacter)
        }
    }

    /// Tidy what was typed into a handle or DID: `@name`, an at:// URI, or a
    /// profile link from an app or from the Explorer.
    public static func normalizeActorInput(_ raw: String) -> ActorInput {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid(reason: "Enter a handle or DID.") }

        let lower = value.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            if let segment = profilePathSegment(value) {
                value = segment.removingPercentEncoding ?? segment
            } else if let host = URL(string: value)?.host, !host.isEmpty {
                value = host.lowercased()
            } else {
                return .invalid(reason: "That link could not be read. Enter a handle such as alice.example.com.")
            }
        }
        if value.lowercased().hasPrefix("at://") {
            value = String(value.dropFirst("at://".count))
        }
        if value.hasPrefix("@") {
            value.removeFirst()
        }
        value = String(value.prefix { $0 != "/" })

        if value.lowercased().hasPrefix("did:") {
            return isCalendarDid(value)
                ? .ok(actor: value)
                : .invalid(reason: "That DID is not a valid did:plc or did:web identifier.")
        }
        if value.hasSuffix(".") {
            value.removeLast()
        }
        value = value.lowercased()
        guard isCalendarHandle(value) else {
            return .invalid(reason: "Enter a handle such as alice.example.com, or a DID.")
        }
        return .ok(actor: value)
    }

    // MARK: - Days

    private static func pad(_ n: Int) -> String {
        n < 10 ? "0\(n)" : String(n)
    }

    /// The local day a moment falls on, as `YYYY-MM-DD`.
    public static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)-\(pad(parts.month ?? 0))-\(pad(parts.day ?? 0))"
    }

    /// Local midnight at the start of a day key. Nil for anything that is not one.
    public static func dateFromKey(_ key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// `days` calendar days from `date`, keeping its time of day: by
    /// calendar date, never by adding 24 hours, since a day is 23 or 25
    /// hours long twice a year.
    static func addingDays(_ days: Int, to date: Date, calendar: Calendar) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date.addingTimeInterval(TimeInterval(days) * 86_400)
    }

    // MARK: - The window

    /// A year of weeks, and the one in progress.
    public static let calendarWeeks = 53

    static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let monthsLong = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    /// Where a month's label sits: the first column that starts in it.
    public struct MonthLabel: Hashable, Sendable {
        public var column: Int
        public var label: String

        public init(column: Int, label: String) {
            self.column = column
            self.label = label
        }
    }

    public struct Window: Hashable, Sendable {
        /// Local midnight at the start of the first day shown.
        public var start: Date
        /// Local midnight at the end of today. Exclusive.
        public var end: Date
        public var firstKey: String
        public var todayKey: String
        /// One column per week, Sunday first, seven day keys each. Days
        /// after today in the last column are nil: they have not happened.
        public var weeks: [[String?]]
        public var months: [MonthLabel]

        public init(start: Date, end: Date, firstKey: String, todayKey: String, weeks: [[String?]], months: [MonthLabel]) {
            self.start = start
            self.end = end
            self.firstKey = firstKey
            self.todayKey = todayKey
            self.weeks = weeks
            self.months = months
        }
    }

    /// The days the calendar shows: whole weeks, ending with the week today
    /// is in. 53 columns is the last 12 months and however much of a 53rd
    /// week it takes to start on a Sunday.
    public static func buildWindow(now: Date, weekCount: Int = calendarWeeks, calendar: Calendar = .current) -> Window {
        let today = calendar.startOfDay(for: now)
        // `.weekday` is 1 for Sunday whatever the locale's first weekday is;
        // the web's `getDay()` is 0 for it.
        let weekday = calendar.component(.weekday, from: today) - 1
        let first = addingDays(-weekday - (weekCount - 1) * 7, to: today, calendar: calendar)
        let tomorrow = addingDays(1, to: today, calendar: calendar)

        var weeks: [[String?]] = []
        var months: [MonthLabel] = []
        var lastMonth = -1
        for w in 0..<max(0, weekCount) {
            var column: [String?] = []
            for d in 0..<7 {
                let date = addingDays(w * 7 + d, to: first, calendar: calendar)
                column.append(date > today ? nil : dayKey(date, calendar: calendar))
                let month = calendar.component(.month, from: date) - 1
                if d == 0 && month != lastMonth {
                    months.append(MonthLabel(column: w, label: monthsShort[month]))
                    lastMonth = month
                }
            }
            weeks.append(column)
        }
        // A window that opens in the last week of a month would print that
        // month's label on top of the next one's.
        if months.count > 1 && months[1].column - months[0].column < 3 {
            months.removeFirst()
        }

        return Window(
            start: first,
            end: tomorrow,
            firstKey: dayKey(first, calendar: calendar),
            todayKey: dayKey(today, calendar: calendar),
            weeks: weeks,
            months: months
        )
    }

    /// Every day in the window, oldest first.
    public static func windowDays(_ window: Window) -> [String] {
        window.weeks.flatMap { $0.compactMap { $0 } }
    }

    // MARK: - Reading one collection

    public struct CollectionScan: Hashable, Sendable {
        /// `waiting` and `reading` are on their way. `done` has been read
        /// back past the start of the window, or to its end. `partial`
        /// stopped short, at the budget or because Stop was pressed, and
        /// `cursor` says where to resume.
        public enum State: String, Hashable, Sendable {
            case waiting
            case reading
            case done
            case partial
            case failed
        }

        public var collection: String
        /// Records per local day, for days inside the window.
        public var days: [String: Int]
        /// Records inside the window. The sum of `days`.
        public var counted: Int
        /// Records with no time in their key and no usable `createdAt`.
        public var undated: Int
        /// Pages read so far, across every run.
        public var pages: Int
        /// Where the next page starts. Nil before the first page and after the last.
        public var cursor: String?
        public var state: State
        /// The oldest moment read so far, when the keys carry time.
        public var reached: Date?
        public var error: String?

        public init(
            collection: String,
            days: [String: Int] = [:],
            counted: Int = 0,
            undated: Int = 0,
            pages: Int = 0,
            cursor: String? = nil,
            state: State = .waiting,
            reached: Date? = nil,
            error: String? = nil
        ) {
            self.collection = collection
            self.days = days
            self.counted = counted
            self.undated = undated
            self.pages = pages
            self.cursor = cursor
            self.state = state
            self.reached = reached
            self.error = error
        }
    }

    public static func emptyScan(_ collection: String) -> CollectionScan {
        CollectionScan(collection: collection)
    }

    public struct RecordTime: Hashable, Sendable {
        public var date: Date?
        /// The time came from the record key.
        public var fromKey: Bool

        public init(date: Date?, fromKey: Bool) {
            self.date = date
            self.fromKey = fromKey
        }
    }

    /// When a record was created, and whether its key said so.
    ///
    /// A TID key is trusted over `createdAt`: the field is whatever the
    /// client wrote, and imported or backdated posts carry dates years from
    /// when they entered the repository.
    public static func recordTime(_ rkey: String, createdAt: JSONValue?) -> RecordTime {
        if TID.looksLikeTid(rkey), let date = TID.date(from: rkey) {
            return RecordTime(date: date, fromKey: true)
        }
        if let text = createdAt?.stringValue, let date = Formatting.isoDate(text) {
            return RecordTime(date: date, fromKey: false)
        }
        return RecordTime(date: nil, fromKey: false)
    }

    /// A clock a little ahead is normal; a key dated next month is a mistake.
    static let futureSlack: TimeInterval = 24 * 60 * 60

    /// One record of a page: its key, and its `createdAt` for a key with no time.
    public struct KeyedRecord: Hashable, Sendable {
        public var rkey: String
        public var createdAt: JSONValue?

        public init(rkey: String, createdAt: JSONValue? = nil) {
            self.rkey = rkey
            self.createdAt = createdAt
        }
    }

    public struct Tally: Hashable, Sendable {
        public var scan: CollectionScan
        /// The page reached a key older than the window, so reading can stop.
        public var passedWindow: Bool

        public init(scan: CollectionScan, passedWindow: Bool) {
            self.scan = scan
            self.passedWindow = passedWindow
        }
    }

    /// Add one page of records, as listRecords returns them (newest key
    /// first), to a collection's count.
    ///
    /// `passedWindow` says the page reached a key older than the window, so
    /// no later page can hold anything inside it and reading can stop. Only
    /// a key can say that. Keys sort as text, so a TID older than the window
    /// means every TID after it is older still, while a `createdAt` on a
    /// record with a custom key says nothing about the records that sort
    /// after it.
    public static func tallyPage(
        _ scan: CollectionScan,
        records: [KeyedRecord],
        window: Window,
        calendar: Calendar = .current
    ) -> Tally {
        var out = scan
        var passedWindow = false
        let lastMoment = window.end.addingTimeInterval(-0.001)

        for record in records {
            let time = recordTime(record.rkey, createdAt: record.createdAt)
            guard let date = time.date else {
                out.undated += 1
                continue
            }
            if time.fromKey, out.reached.map({ date < $0 }) ?? true {
                out.reached = date
            }
            if date < window.start {
                if time.fromKey {
                    passedWindow = true
                    break
                }
                continue
            }
            if date >= window.end.addingTimeInterval(futureSlack) { continue }
            let key = dayKey(min(date, lastMoment), calendar: calendar)
            out.days[key, default: 0] += 1
            out.counted += 1
        }

        out.pages += 1
        return Tally(scan: out, passedWindow: passedWindow)
    }

    // MARK: - Adding up

    /// `app.bsky.feed.post` belongs to `app.bsky`, as the explorer groups its collections.
    public static func appOf(_ collection: String) -> String {
        let segments = collection.split(separator: ".", omittingEmptySubsequences: false)
        return segments.count >= 2 ? "\(segments[0]).\(segments[1])" : collection
    }

    public enum GroupBy: String, Hashable, Sendable, CaseIterable {
        case app
        case collection
    }

    /// Only one app's or one collection's records. Nil is everything.
    public struct Filter: Hashable, Sendable {
        public var by: GroupBy
        public var key: String

        public init(by: GroupBy, key: String) {
            self.by = by
            self.key = key
        }
    }

    public static func matchesFilter(_ collection: String, _ filter: Filter?) -> Bool {
        guard let filter else { return true }
        return filter.by == .app ? appOf(collection) == filter.key : collection == filter.key
    }

    /// Records per day across the collections a filter lets through.
    public static func sumDays(_ scans: [CollectionScan], filter: Filter? = nil) -> [String: Int] {
        var out: [String: Int] = [:]
        for scan in scans where matchesFilter(scan.collection, filter) {
            for (key, count) in scan.days {
                out[key, default: 0] += count
            }
        }
        return out
    }

    public struct Share: Hashable, Sendable {
        public var key: String
        public var count: Int
        /// Of every counted record, 0 to 1.
        public var share: Double
        /// How many collections are behind this row. 1 for a collection.
        public var collections: Int

        public init(key: String, count: Int, share: Double, collections: Int) {
            self.key = key
            self.count = count
            self.share = share
            self.collections = collections
        }
    }

    /// Totals by app or by collection, largest first, leaving out the ones
    /// with nothing in the window. Ties fall to plain string order where the
    /// web uses `localeCompare`; the two agree on lowercase NSIDs.
    public static func totalsBy(_ scans: [CollectionScan], by: GroupBy) -> [Share] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var collections: [String: Int] = [:]
        var total = 0
        for scan in scans where scan.counted > 0 {
            let key = by == .app ? appOf(scan.collection) : scan.collection
            if counts[key] == nil {
                order.append(key)
            }
            counts[key, default: 0] += scan.counted
            collections[key, default: 0] += 1
            total += scan.counted
        }
        let shares = order.map { key -> Share in
            let count = counts[key] ?? 0
            return Share(
                key: key,
                count: count,
                share: total > 0 ? Double(count) / Double(total) : 0,
                collections: collections[key] ?? 0
            )
        }
        return shares.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.key < b.key
        }
    }

    public struct CollectionCount: Hashable, Sendable {
        public var collection: String
        public var count: Int

        public init(collection: String, count: Int) {
            self.collection = collection
            self.count = count
        }
    }

    /// What was written on one day, by collection, largest first.
    public static func dayBreakdown(_ scans: [CollectionScan], key: String) -> [CollectionCount] {
        scans
            .map { CollectionCount(collection: $0.collection, count: $0.days[key] ?? 0) }
            .filter { $0.count > 0 }
            .sorted { a, b in
                if a.count != b.count { return a.count > b.count }
                return a.collection < b.collection
            }
    }

    // MARK: - Intensity

    /// The three cut points between the four shades, from the quartiles of
    /// the days that have anything at all.
    ///
    /// Quartiles rather than fractions of the busiest day, because one day
    /// of a bulk import (ten thousand follows from a starter pack) would
    /// otherwise push every ordinary day into the palest shade.
    public static func intensityThresholds(_ counts: [Int]) -> [Int] {
        let active = counts.filter { $0 > 0 }.sorted()
        guard !active.isEmpty else { return [0, 0, 0] }
        func at(_ q: Double) -> Int {
            active[min(active.count - 1, Int((q * Double(active.count)).rounded(.down)))]
        }
        return [at(0.25), at(0.5), at(0.75)]
    }

    /// 0 for an empty day, then 1 to 4: how many cut points the count is
    /// above, plus one.
    public static func intensityLevel(_ count: Int, thresholds: [Int]) -> Int {
        if count <= 0 { return 0 }
        var level = 1
        for threshold in thresholds where count > threshold {
            level += 1
        }
        return level
    }

    // MARK: - Summary

    public struct DayCount: Hashable, Sendable {
        public var key: String
        public var count: Int

        public init(key: String, count: Int) {
            self.key = key
            self.count = count
        }
    }

    public struct Streak: Hashable, Sendable {
        public var days: Int
        public var startKey: String
        public var endKey: String

        public init(days: Int, startKey: String, endKey: String) {
            self.days = days
            self.startKey = startKey
            self.endKey = endKey
        }
    }

    public struct MonthCount: Hashable, Sendable {
        /// "July 2026".
        public var label: String
        public var count: Int

        public init(label: String, count: Int) {
            self.label = label
            self.count = count
        }
    }

    public struct Summary: Hashable, Sendable {
        public var total: Int
        public var activeDays: Int
        /// Days in the window, up to and including today.
        public var windowDays: Int
        public var busiestDay: DayCount?
        /// The longest run of consecutive days with at least one record.
        public var longestStreak: Streak?
        public var busiestMonth: MonthCount?

        public init(
            total: Int,
            activeDays: Int,
            windowDays: Int,
            busiestDay: DayCount?,
            longestStreak: Streak?,
            busiestMonth: MonthCount?
        ) {
            self.total = total
            self.activeDays = activeDays
            self.windowDays = windowDays
            self.busiestDay = busiestDay
            self.longestStreak = longestStreak
            self.busiestMonth = busiestMonth
        }
    }

    public static func summarize(_ days: [String: Int], window: Window) -> Summary {
        let keys = windowDays(window)
        var total = 0
        var activeDays = 0
        var busiestDay: DayCount? = nil
        var longestStreak: Streak? = nil
        var runStart: String? = nil
        var runLength = 0
        var monthOrder: [String] = []
        var months: [String: Int] = [:]

        for key in keys {
            let count = days[key] ?? 0
            if count > 0 {
                total += count
                activeDays += 1
                if busiestDay.map({ count > $0.count }) ?? true {
                    busiestDay = DayCount(key: key, count: count)
                }
                let month = String(key.prefix(7))
                if months[month] == nil {
                    monthOrder.append(month)
                }
                months[month, default: 0] += count
                let start = runStart ?? key
                runStart = start
                runLength += 1
                if longestStreak.map({ runLength > $0.days }) ?? true {
                    longestStreak = Streak(days: runLength, startKey: start, endKey: key)
                }
            } else {
                runStart = nil
                runLength = 0
            }
        }

        var busiestMonth: MonthCount? = nil
        for month in monthOrder {
            let count = months[month] ?? 0
            guard busiestMonth.map({ count > $0.count }) ?? true else { continue }
            let parts = month.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 2, (1...12).contains(parts[1]) else { continue }
            busiestMonth = MonthCount(label: "\(monthsLong[parts[1] - 1]) \(parts[0])", count: count)
        }

        return Summary(
            total: total,
            activeDays: activeDays,
            windowDays: keys.count,
            busiestDay: busiestDay,
            longestStreak: longestStreak,
            busiestMonth: busiestMonth
        )
    }
}
