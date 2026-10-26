import Foundation

/// Timestamp identifiers, the default record key. Port of
/// `src/utils/atproto/tid.ts`; the decoding the web delegates to
/// `@atproto/common-web` is done here directly.
///
/// A TID is 13 characters of base32-sortable text spelling a 64-bit value:
/// the top bit is zero, the next 53 bits are microseconds since the Unix
/// epoch, and the low 10 bits are a clock id that keeps concurrent writers
/// from colliding.
public enum TID {
    /// The base32-sortable alphabet: digits 2-7 first, then a-z, so that
    /// lexical order is chronological order.
    public static let alphabet = "234567abcdefghijklmnopqrstuvwxyz"

    private static let alphabetIndex: [Unicode.Scalar: UInt64] = {
        var table: [Unicode.Scalar: UInt64] = [:]
        for (i, scalar) in alphabet.unicodeScalars.enumerated() {
            table[scalar] = UInt64(i)
        }
        return table
    }()

    /// Quick syntactic check: 13 characters, all from the alphabet. Used by
    /// callers rendering many rkeys so obviously-non-TID strings ("self",
    /// a slug) skip the decode.
    public static func looksLikeTid(_ s: String) -> Bool {
        let scalars = s.unicodeScalars
        guard scalars.count == 13 else { return false }
        return scalars.allSatisfy { alphabetIndex[$0] != nil }
    }

    /// The 64-bit value behind a TID, or nil when it is not one. 13 base32
    /// digits carry 65 bits, so the first digit must leave the top two clear
    /// (a value below 8) for the number to be a well-formed TID at all.
    public static func rawValue(of s: String) -> UInt64? {
        guard looksLikeTid(s) else { return nil }
        var value: UInt64 = 0
        for (i, scalar) in s.unicodeScalars.enumerated() {
            let digit = alphabetIndex[scalar]!
            if i == 0, digit >= 8 { return nil }
            value = (value << 5) | digit
        }
        return value
    }

    /// Microseconds since the epoch (the top 53 bits), or nil.
    public static func microseconds(from s: String) -> UInt64? {
        rawValue(of: s).map { $0 >> 10 }
    }

    /// The low 10 bits, or nil.
    public static func clockId(from s: String) -> Int? {
        rawValue(of: s).map { Int($0 & 0x3FF) }
    }

    /// Decode a TID rkey to a Date. Nil when the input is not a well-formed
    /// TID or the decoded time falls outside a sane range: atproto launched
    /// in 2022, so anything well outside [2020, now + 10 years] is almost
    /// certainly a non-TID rkey that happens to pass the alphabet check, and
    /// rendering a date for it would mislead.
    public static func date(from rkey: String) -> Date? {
        guard let micros = microseconds(from: rkey), micros > 0 else { return nil }
        let millis = micros / 1000
        let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
        let year = Formatting.utcCalendar.component(.year, from: date)
        let currentYear = Formatting.utcCalendar.component(.year, from: Date())
        if year < 2020 || year > currentYear + 10 { return nil }
        return date
    }

    /// Render a TID-derived date in a list-friendly way: recent dates get a
    /// relative chip ("12m ago", "3d ago"); older dates get an ISO calendar
    /// date. See `Formatting.relative`.
    public static func formatRelative(_ date: Date, now: Date = Date()) -> String {
        Formatting.relative(date, now: now)
    }
}
