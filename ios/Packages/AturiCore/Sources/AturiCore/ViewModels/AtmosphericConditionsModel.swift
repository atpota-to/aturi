import Foundation
import Observation

// Port of the state behind "Atmospheric conditions" on the explore landing
// (src/components/explore/AtmosphericConditions.tsx): the last minute of the
// whole firehose, from atpota.to's weather station. The pulse below it says
// which lexicons were busy over days and the live feed says what is being
// written, as a sample; this says how much, and whether that is usual,
// which neither of them can.
//
// Read straight from atpota.to's public endpoints, as the web reads them
// from the browser, so aturi runs nothing for it. The words and thresholds
// are in `AtpotatoWeather`.

/// One of the card's four stats: a label, the figure (nil when that part is
/// missing, which the card prints as a dash), the level word some figures
/// carry, and the line under it.
public struct AtmosphericStat: Hashable, Sendable, Identifiable {
    public var id: String { label }
    public let label: String
    public let value: String?
    public let level: String?
    public let note: String

    public init(label: String, value: String?, level: String? = nil, note: String) {
        self.label = label
        self.value = value
        self.level = level
        self.note = note
    }
}

/// The station's reading and the almanac's usual, fetched together. A
/// refresh that fails keeps the last reading, whose time says how old it
/// is; an almanac that answers replaces the usual, even with "nothing to
/// compare yet". The screen drives the minute-by-minute refresh through
/// `refreshIfStale()`, so it can stop asking while it is off screen.
@MainActor
@Observable
public final class AtmosphericConditionsModel {
    /// `REFRESH_MS`: the station's window is a minute, so a fresher reading
    /// would not be a different one.
    public nonisolated static let refreshInterval: TimeInterval = 60

    public nonisolated static let title = "Atmospheric conditions"
    public nonisolated static let reportLinkLabel = "Full weather report"
    public nonisolated static let downMessage = "The weather station isn\u{2019}t answering. The full report may have the latest."

    /// The web's `loaded`: the first load has finished, whatever it found.
    public private(set) var hasLoaded = false
    /// The last good reading.
    public private(set) var reading: AtmosphereReading?
    /// The last hour against usual, from the last almanac that answered.
    public private(set) var usual: UsualComparison?
    /// The almanac has answered at least once, whether or not it had a
    /// usual to compare with yet.
    public private(set) var almanacAnswered = false

    @ObservationIgnored private let http: HTTPClient
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var lastLoad: Date?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        self.clock = clock
    }

    // MARK: Loading

    /// Fetch the reading and the almanac side by side. A load already in
    /// flight is cancelled, as the web aborts its previous controller.
    @discardableResult
    public func load() -> Task<Void, Never> {
        task?.cancel()
        generation += 1
        let gen = generation
        lastLoad = clock()
        let http = http
        let next = Task { [weak self] in
            async let nowLookup = AtmosphericConditionsModel.fetchJSON(AtpotatoWeather.atmosphereURL, http: http)
            async let almanacLookup = AtmosphericConditionsModel.fetchJSON(AtpotatoWeather.almanacURL, http: http)
            let (now, almanac) = await (nowLookup, almanacLookup)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.apply(now: now, almanac: almanac)
        }
        task = next
        return next
    }

    /// The web's `refresh`: load when nothing has been loaded yet or the
    /// last load started at least `refreshInterval` ago, otherwise nothing
    /// (nil). The screen calls this when it appears, when the app returns
    /// to the foreground, and once a minute while both hold.
    @discardableResult
    public func refreshIfStale() -> Task<Void, Never>? {
        if let lastLoad, clock().timeIntervalSince(lastLoad) < Self.refreshInterval {
            return nil
        }
        return load()
    }

    public func awaitPending() async {
        await task?.value
    }

    public func cancel() {
        task?.cancel()
    }

    private func apply(now: JSONValue?, almanac: JSONValue?) {
        hasLoaded = true
        if let now, let fresh = AtpotatoWeather.reading(from: now) {
            reading = fresh
        }
        if let almanac, almanac.objectValue != nil {
            usual = AtpotatoWeather.usual(from: almanac)
            almanacAnswered = true
        }
    }

    /// `getJson`: nil for a failed request, a non-2xx answer or a body
    /// that is not JSON.
    private nonisolated static func fetchJSON(_ url: URL, http: HTTPClient) async -> JSONValue? {
        do {
            let (data, _) = try await http.get(url, headers: ["Accept": "application/json"])
            return try JSONValue.parse(data)
        } catch {
            return nil
        }
    }

    // MARK: Card

    /// Neither the station nor the almanac answered: the card says so in
    /// place of the stats.
    public var isDown: Bool {
        hasLoaded && reading == nil && !almanacAnswered
    }

    /// When the reading was taken, for "Updated hh:mm".
    public var measuredAt: Date? {
        guard let reading else { return nil }
        return Formatting.isoDate(reading.measuredAt)
    }

    /// `missing`: the station can be up with a part missing (its fallback
    /// sample has no accounts or hosts), or down while the almanac's
    /// history still answers.
    public var missingNote: String {
        reading == nil ? "Station not answering" : "Not reported"
    }

    public var stats: [AtmosphericStat] {
        [rightNow, againstUsual, diversity, hosting]
    }

    /// The condition, with records a second and active accounts.
    public var rightNow: AtmosphericStat {
        guard let reading else {
            return AtmosphericStat(label: "Right now", value: nil, note: missingNote)
        }
        var note = "\(AtpotatoWeather.whole(reading.recordsPerSecond)) records/s"
        if let accounts = reading.accounts {
            note += " \u{00B7} \(AtpotatoWeather.whole(accounts)) accounts"
        }
        return AtmosphericStat(label: "Right now", value: AtpotatoWeather.capitalize(reading.condition), note: note)
    }

    /// The last hour's change against usual, and its verdict.
    public var againstUsual: AtmosphericStat {
        if let usual {
            return AtmosphericStat(
                label: "Against usual",
                value: AtpotatoWeather.changeText(usual.changePercent),
                note: "\(AtpotatoWeather.capitalize(usual.verdict)) \u{00B7} last hour"
            )
        }
        let note = almanacAnswered ? "No baseline yet" : "Almanac not answering"
        return AtmosphericStat(label: "Against usual", value: nil, note: note)
    }

    public var diversity: AtmosphericStat {
        guard let diversity = reading?.diversity else {
            return AtmosphericStat(label: "Diversity index", value: nil, note: missingNote)
        }
        return AtmosphericStat(
            label: "Diversity index",
            value: AtpotatoWeather.indexText(diversity.index),
            level: diversity.level,
            note: "\(AtpotatoWeather.percent(diversity.share)) on \(AtpotatoWeather.whole(diversity.apps)) non-Bluesky apps"
        )
    }

    public var hosting: AtmosphericStat {
        guard let hosts = reading?.hosts else {
            return AtmosphericStat(label: "Hosting diversity", value: nil, note: missingNote)
        }
        return AtmosphericStat(
            label: "Hosting diversity",
            value: AtpotatoWeather.indexText(hosts.index),
            level: AtpotatoWeather.hostingLevel(hosts.index),
            note: "\(AtpotatoWeather.percent(hosts.share)) on \(AtpotatoWeather.whole(hosts.independent)) independent PDSes"
        )
    }
}
