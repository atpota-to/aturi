import Foundation

/// Port of `src/utils/atpotatoWeather.ts`, plus the readers in
/// `AtmosphericConditions.tsx` (`readingOf`, `usualOf`) that pull a reading
/// and a usual out of atpota.to's two public endpoints: the words atpota.to
/// puts on its numbers, its rule for "busier than usual", and the number
/// formats the explore landing's conditions card prints them in.
///
/// Every threshold here is atpota.to's own (website/server/atmosphere.ts and
/// website/src/scripts/weather-almanac.ts in atpota-to/atpota.to), copied by
/// way of the web's util. When the report moves one, move it there and here,
/// or the app words a reading differently from the page it links to.
public enum AtpotatoWeather {
    /// `ATPOTATO`.
    public static let base = URL(string: "https://atpota.to")!
    /// `WEATHER_REPORT`: the full report the card links out to.
    public static let weatherReportURL = URL(string: "https://atpota.to/weather")!
    /// The station's last minute of the whole firehose.
    public static let atmosphereURL = URL(string: "https://atpota.to/api/atmosphere")!
    /// The almanac, asked for in UTC whatever the device's zone: only its
    /// `normal` is used, which does not depend on the zone, and one fixed
    /// URL keeps one CDN copy.
    public static let almanacURL = URL(string: "https://atpota.to/api/weather-almanac?tz=UTC")!

    // MARK: Levels

    /// Where each diversity index level starts, like the UV index. Below the
    /// last, "low".
    private static let diversityLevels: [(name: String, from: Double)] = [
        ("extreme", 11),
        ("very high", 8),
        ("high", 6),
        ("moderate", 3),
    ]

    public static func diversityLevel(_ index: Double) -> String {
        for level in diversityLevels where index >= level.from {
            return level.name
        }
        return "low"
    }

    /// Where each hosting diversity level starts. Its own scale: it grows
    /// with the share of accounts off Bluesky's hosts and how many hosts
    /// they're spread across, so it runs to the hundreds. Below the last,
    /// "early days".
    private static let hostingLevels: [(name: String, from: Double)] = [
        ("flourishing", 200),
        ("well spread", 75),
        ("spreading", 25),
        ("taking root", 10),
    ]

    public static func hostingLevel(_ index: Double) -> String {
        for level in hostingLevels where index >= level.from {
            return level.name
        }
        return "early days"
    }

    // MARK: Against usual

    /// Quieter-than-usual edges, then busier ones (`USUAL_EDGES` on the page).
    public static let muchQuieterEdge = 0.8
    public static let quieterEdge = 0.93
    public static let busierEdge = 1.08
    public static let muchBusierEdge = 1.25
    /// Less of the last hour than this and there is nothing to compare.
    public static let minimumSeconds: Double = 1_800

    /// The last hour against usual, compared by rate. The same weekday once
    /// the station has heard one, the same hour on the days before until
    /// then, and nothing at all on less than half an hour of now: the
    /// station has gaps, and a window it heard half of, compared by count,
    /// reads as a collapse.
    public static func compareWithUsual(now: HeardWindow, days: HeardWindow, weeks: HeardWindow) -> UsualComparison? {
        let basis: UsualComparison.Basis
        if weeks.windows > 0 {
            basis = .weeks
        } else if days.windows > 0 {
            basis = .days
        } else {
            return nil
        }
        guard now.seconds >= minimumSeconds else { return nil }
        let usual = basis == .weeks ? weeks : days
        guard usual.seconds > 0, usual.creates > 0 else { return nil }
        let ratio = (now.creates / now.seconds) / (usual.creates / usual.seconds)
        let verdict: String
        if ratio >= muchBusierEdge {
            verdict = "much busier than usual"
        } else if ratio >= busierEdge {
            verdict = "busier than usual"
        } else if ratio <= muchQuieterEdge {
            verdict = "much quieter than usual"
        } else if ratio <= quieterEdge {
            verdict = "quieter than usual"
        } else {
            verdict = "about as busy as usual"
        }
        let changePercent = Int(exactly: roundHalfUp((ratio - 1) * 100)) ?? 0
        return UsualComparison(
            basis: basis, windows: usual.windows, ratio: ratio,
            changePercent: changePercent, verdict: verdict
        )
    }

    // MARK: Reading the endpoints

    /// `readingOf`: the parts of `/api/atmosphere` the card shows, or nil
    /// when the answer lacks the time, the condition or the rate. A missing
    /// part (the station's fallback sample has no accounts or hosts) leaves
    /// that field nil rather than failing the reading.
    public static func reading(from body: JSONValue) -> AtmosphereReading? {
        guard let measuredAt = body["measuredAt"]?.stringValue,
              let condition = body["condition"]?.stringValue,
              let rate = number(body["records"]?["perSecond"])
        else { return nil }

        var diversity: AtmosphereReading.Diversity?
        if let d = body["diversity"], let index = number(d["index"]) {
            diversity = AtmosphereReading.Diversity(
                index: index,
                // The page's own word when it sends one, so the two never disagree.
                level: d["level"]?.stringValue ?? diversityLevel(index),
                share: number(d["share"]) ?? 0,
                apps: number(d["apps"]) ?? 0
            )
        }

        var hosts: AtmosphereReading.Hosts?
        if let h = body["hosts"], let hd = h["diversity"],
           let hostIndex = number(hd["index"]),
           let independent = number(h["independent"]) {
            hosts = AtmosphereReading.Hosts(
                index: hostIndex,
                share: number(hd["share"]) ?? 0,
                independent: independent
            )
        }

        return AtmosphereReading(
            measuredAt: measuredAt,
            condition: condition,
            recordsPerSecond: rate,
            accounts: number(body["accounts"]?["active"]),
            diversity: diversity,
            hosts: hosts
        )
    }

    /// `usualOf`: the almanac's `normal`, compared. Nil when a window is
    /// missing or `compareWithUsual` has nothing to say yet.
    public static func usual(from body: JSONValue) -> UsualComparison? {
        guard let normal = body["normal"],
              let now = heardWindow(normal["now"]),
              let days = heardWindow(normal["days"]),
              let weeks = heardWindow(normal["weeks"])
        else { return nil }
        return compareWithUsual(now: now, days: days, weeks: weeks)
    }

    /// `windowOf`.
    static func heardWindow(_ value: JSONValue?) -> HeardWindow? {
        guard let seconds = number(value?["seconds"]),
              let creates = number(value?["creates"])
        else { return nil }
        return HeardWindow(seconds: seconds, creates: creates, windows: number(value?["windows"]) ?? 0)
    }

    /// `num`: a finite number, nil for anything else.
    static func number(_ value: JSONValue?) -> Double? {
        guard let double = value?.doubleValue, double.isFinite else { return nil }
        return double
    }

    // MARK: Formats (the card's `whole`, `percent`, `changeText`, `capitalize`)

    /// `Math.round(n).toLocaleString('en-US')`: "12,456".
    public static func whole(_ n: Double) -> String {
        guard let value = Int(exactly: roundHalfUp(n)) else { return String(n) }
        return grouped(value)
    }

    /// `n.toLocaleString('en-US', { maximumFractionDigits: 2 })` and a
    /// percent sign: "0.75%", "1.5%", "12%".
    public static func percent(_ n: Double) -> String {
        guard let hundredths = Int(exactly: (abs(n) * 100).rounded(.toNearestOrAwayFromZero)) else {
            return "\(n)%"
        }
        var text = grouped(hundredths / 100)
        let fraction = hundredths % 100
        if fraction != 0 {
            var digits = fraction < 10 ? "0\(fraction)" : "\(fraction)"
            if digits.hasSuffix("0") {
                digits.removeLast()
            }
            text += "." + digits
        }
        let sign = n < 0 && hundredths != 0 ? "-" : ""
        return sign + text + "%"
    }

    /// An index as the card prints it, `toFixed(2)`: "3.47".
    public static func indexText(_ index: Double) -> String {
        String(format: "%.2f", index)
    }

    /// "+5%", "−7%", "±0%", as the report writes a change.
    public static func changeText(_ percent: Int) -> String {
        if percent == 0 { return "\u{00B1}0%" }
        return percent > 0 ? "+\(percent)%" : "\u{2212}\(abs(percent))%"
    }

    /// The first letter upper-cased: "breezy" becomes "Breezy".
    public static func capitalize(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + String(text.dropFirst())
    }

    /// JavaScript's `Math.round`, which takes halves up (-2.5 to -2) where
    /// Swift's `rounded()` takes them away from zero.
    static func roundHalfUp(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    /// Digits grouped by thousands with commas, as `en-US` prints them.
    private static func grouped(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, character) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 {
                out.append(",")
            }
            out.append(character)
        }
        return n < 0 ? "-" + out : out
    }
}

/// Records and the seconds the station heard them in, for one window
/// (`HeardWindow`). `windows` is how many earlier windows went into it,
/// zero for the current hour.
public struct HeardWindow: Hashable, Sendable {
    public let seconds: Double
    public let creates: Double
    public let windows: Double

    public init(seconds: Double, creates: Double, windows: Double = 0) {
        self.seconds = seconds
        self.creates = creates
        self.windows = windows
    }
}

/// The last hour against usual (`UsualComparison`).
public struct UsualComparison: Hashable, Sendable {
    /// `weeks`: the same hour on the same weekday; `days`: the same hour on
    /// the days before.
    public enum Basis: String, Hashable, Sendable {
        case weeks
        case days
    }

    public let basis: Basis
    public let windows: Double
    /// The last hour's rate over usual's.
    public let ratio: Double
    public let changePercent: Int
    public let verdict: String

    public init(basis: Basis, windows: Double, ratio: Double, changePercent: Int, verdict: String) {
        self.basis = basis
        self.windows = windows
        self.ratio = ratio
        self.changePercent = changePercent
        self.verdict = verdict
    }
}

/// One reading from the weather station (`Reading` in
/// `AtmosphericConditions.tsx`).
public struct AtmosphereReading: Hashable, Sendable {
    public struct Diversity: Hashable, Sendable {
        public let index: Double
        public let level: String
        /// Percent of active accounts that write with apps outside Bluesky.
        public let share: Double
        public let apps: Double

        public init(index: Double, level: String, share: Double, apps: Double) {
            self.index = index
            self.level = level
            self.share = share
            self.apps = apps
        }
    }

    public struct Hosts: Hashable, Sendable {
        public let index: Double
        /// Percent of accounts on independent PDSes.
        public let share: Double
        public let independent: Double

        public init(index: Double, share: Double, independent: Double) {
            self.index = index
            self.share = share
            self.independent = independent
        }
    }

    /// ISO 8601, as the station sends it.
    public let measuredAt: String
    public let condition: String
    public let recordsPerSecond: Double
    /// Different accounts that wrote anything; the station's only, not a
    /// fallback sample's.
    public let accounts: Double?
    public let diversity: Diversity?
    public let hosts: Hosts?

    public init(
        measuredAt: String,
        condition: String,
        recordsPerSecond: Double,
        accounts: Double?,
        diversity: Diversity?,
        hosts: Hosts?
    ) {
        self.measuredAt = measuredAt
        self.condition = condition
        self.recordsPerSecond = recordsPerSecond
        self.accounts = accounts
        self.diversity = diversity
        self.hosts = hosts
    }
}
