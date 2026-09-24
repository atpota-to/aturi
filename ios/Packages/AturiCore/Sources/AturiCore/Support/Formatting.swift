import Foundation

/// Pure display formatters, kept together so the app and the package's
/// view models agree on how a count, a size or a timestamp reads.
public enum Formatting {
    /// Compact count, the port of `ufos/format.ts` `formatCount`:
    /// 1_234 -> "1.2k", 1_500_000 -> "1.5M", 2_100_000_000 -> "2.1B".
    /// Below a thousand the number prints as is.
    public static func compactCount(_ n: Int) -> String {
        let value = Double(n)
        if value >= 1_000_000_000 { return fixed(value / 1_000_000_000, 1) + "B" }
        if value >= 1_000_000 { return fixed(value / 1_000_000, 1) + "M" }
        if value >= 1_000 { return fixed(value / 1_000, 1) + "k" }
        return String(n)
    }

    /// Relative chip for recent dates ("12s ago", "12m ago", "3h ago",
    /// "3d ago") and an ISO calendar date past two weeks, so a six-month-old
    /// record does not read as "189d ago". A date in the future prints as a
    /// calendar date too. Port of `tid.ts` `formatTidRelative`.
    public static func relative(_ date: Date, now: Date = Date()) -> String {
        let diff = now.timeIntervalSince(date)
        if diff < 0 { return isoDay(date) }
        let sec = Int(diff.rounded(.down))
        if sec < 60 { return "\(sec)s ago" }
        let min = sec / 60
        if min < 60 { return "\(min)m ago" }
        let hr = min / 60
        if hr < 24 { return "\(hr)h ago" }
        let day = hr / 24
        if day < 14 { return "\(day)d ago" }
        return isoDay(date)
    }

    /// Human-readable size in binary units (1 KB = 1024 B), matching how PDS
    /// and repo tooling report CAR sizes. One decimal from MB up (two for GB)
    /// and no decimal for KB at or above 10 so tiny repos stay tidy. Port of
    /// `AccountStats.tsx` `formatBytes`.
    public static func bytes(_ n: Int) -> String {
        if n < 1024 { return "\(n) B" }
        let kb = Double(n) / 1024
        if kb < 1024 { return fixed(kb, kb < 10 ? 1 : 0) + " KB" }
        let mb = kb / 1024
        if mb < 1024 { return fixed(mb, 1) + " MB" }
        return fixed(mb / 1024, 2) + " GB"
    }

    /// Parse the ISO 8601 shapes atproto emits: `2023-05-06T01:39:13Z`,
    /// with any number of fractional digits, with a `+02:00` style offset,
    /// or a bare calendar date (midnight UTC, as JavaScript reads it).
    /// Hand-rolled because `ISO8601DateFormatter` only accepts exactly three
    /// fractional digits and PDS records routinely carry six.
    public static func isoDate(_ s: String) -> Date? {
        let scalars = Array(s.unicodeScalars)
        var cursor = 0

        func digits(_ count: Int) -> Int? {
            guard cursor + count <= scalars.count else { return nil }
            var value = 0
            for i in 0..<count {
                guard let digit = digitValue(scalars[cursor + i]) else { return nil }
                value = value * 10 + digit
            }
            cursor += count
            return value
        }

        func expect(_ scalar: Unicode.Scalar) -> Bool {
            guard cursor < scalars.count, scalars[cursor] == scalar else { return false }
            cursor += 1
            return true
        }

        guard let year = digits(4), expect("-"), let month = digits(2), expect("-"), let day = digits(2) else {
            return nil
        }
        guard (1...12).contains(month), (1...31).contains(day) else { return nil }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day

        if cursor == scalars.count {
            return utcCalendar.date(from: components)
        }

        guard expect("T") || expect("t") || expect(" ") else { return nil }
        guard let hour = digits(2), expect(":"), let minute = digits(2) else { return nil }
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        components.hour = hour
        components.minute = minute

        var second = 0
        var nanoseconds = 0
        if expect(":") {
            guard let sec = digits(2), (0...60).contains(sec) else { return nil }
            second = sec
            if expect(".") || expect(",") {
                var fraction = 0
                var scale = 100_000_000
                var count = 0
                while cursor < scalars.count, let digit = digitValue(scalars[cursor]) {
                    if scale > 0 { fraction += digit * scale }
                    scale /= 10
                    count += 1
                    cursor += 1
                }
                guard count > 0 else { return nil }
                nanoseconds = fraction
            }
        }
        components.second = second
        components.nanosecond = nanoseconds

        var offsetSeconds = 0
        if expect("Z") || expect("z") {
            offsetSeconds = 0
        } else if cursor < scalars.count, scalars[cursor] == "+" || scalars[cursor] == "-" {
            let negative = scalars[cursor] == "-"
            cursor += 1
            guard let offsetHour = digits(2) else { return nil }
            var offsetMinute = 0
            if expect(":") {
                guard let m = digits(2) else { return nil }
                offsetMinute = m
            } else if let m = digits(2) {
                offsetMinute = m
            }
            offsetSeconds = (offsetHour * 3600 + offsetMinute * 60) * (negative ? -1 : 1)
        } else {
            return nil
        }

        guard cursor == scalars.count else { return nil }
        guard let local = utcCalendar.date(from: components) else { return nil }
        return local.addingTimeInterval(TimeInterval(-offsetSeconds))
    }

    /// `yyyy-MM-dd` in UTC, the first ten characters of `toISOString()`.
    public static func isoDay(_ date: Date) -> String {
        let parts = utcCalendar.dateComponents([.year, .month, .day], from: date)
        return pad(parts.year ?? 0, 4) + "-" + pad(parts.month ?? 0, 2) + "-" + pad(parts.day ?? 0, 2)
    }

    /// Full `toISOString()` shape with millisecond precision, for hover and
    /// copy affordances that show the exact timestamp.
    public static func isoTimestamp(_ date: Date) -> String {
        // Round to whole milliseconds first, as a JavaScript Date holds them,
        // so 0.123 s does not print as .122 through a floor on its binary value.
        let totalMillis = Int64((date.timeIntervalSince1970 * 1000).rounded())
        let seconds = Double(totalMillis.quotientAndRemainder(dividingBy: 1000).quotient)
        var millis = Int(totalMillis % 1000)
        var wholeSeconds = seconds
        if millis < 0 {
            millis += 1000
            wholeSeconds -= 1
        }
        let whole = Date(timeIntervalSince1970: wholeSeconds)
        let parts = utcCalendar.dateComponents([.hour, .minute, .second], from: whole)
        return isoDay(whole) + "T" + pad(parts.hour ?? 0, 2) + ":" + pad(parts.minute ?? 0, 2)
            + ":" + pad(parts.second ?? 0, 2) + "." + pad(millis, 3) + "Z"
    }

    static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private static func digitValue(_ scalar: Unicode.Scalar) -> Int? {
        guard scalar.value >= 48, scalar.value <= 57 else { return nil }
        return Int(scalar.value - 48)
    }

    private static func pad(_ value: Int, _ width: Int) -> String {
        let text = String(value)
        return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
    }

    /// JavaScript `toFixed`. printf rounds exact binary ties to even where
    /// JavaScript rounds them up; such ties are rare enough in real counts
    /// that the difference never reaches a screen.
    private static func fixed(_ value: Double, _ digits: Int) -> String {
        String(format: "%.\(digits)f", value)
    }
}
