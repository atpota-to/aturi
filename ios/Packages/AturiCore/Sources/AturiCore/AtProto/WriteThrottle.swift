import Foundation

/// Client-side pacing for AT Protocol repo writes. Port of
/// `src/utils/atproto/writeThrottle.ts`.
///
/// Bluesky's PDS rate-limits writes on a points budget: CREATE = 3,
/// UPDATE = 2, DELETE = 1 point, capped at 5,000 points/hour (and
/// 35,000/day) per account. `applyWrites` batching cuts the request count
/// but still spends one point per operation, so a large bulk delete can
/// exhaust the hourly budget and 429.
///
/// This tracks points spent per DID in a rolling one-hour window,
/// persisted to UserDefaults (the app group suite by default, so the app
/// and the extension share one ledger the way the web's localStorage spans
/// tabs) and answers "how long until spending N more points stays under
/// budget?" Callers pace their batches against it so they never trip the
/// limit, keeping the reactive 429 handler as a backstop for the abnormal
/// case (writes from elsewhere).
///
/// `@unchecked`: `UserDefaults` is documented thread-safe but is not marked
/// `Sendable` in corelibs Foundation, and the struct holds nothing else.
public struct WriteThrottle: @unchecked Sendable {
    /// Rolling one hour.
    public static let pointsWindow: TimeInterval = 60 * 60

    /// Bluesky's real hourly ceiling, exported for user-facing copy.
    public static let hourlyPointBudget = 5000

    /// We pace to stay under this rather than the true 5,000, leaving
    /// headroom for clock skew and any other writes the account makes, so
    /// the reactive 429 stop effectively never has to fire.
    public static let throttlePointBudget = 4500

    /// Point cost of a single delete: one applyWrites#delete op.
    public static let deletePointCost = 1

    /// One recorded spend: when, and how many points.
    struct Spend: Codable, Equatable {
        var t: Double
        var n: Int
    }

    private let defaults: UserDefaults

    /// - Parameter defaults: where the ledger lives; the app group suite by
    ///   default so every process of the app paces against one budget.
    public init(defaults: UserDefaults = PreferencesStore.appGroupDefaults()) {
        self.defaults = defaults
    }

    /// The same key spelling as the web, so the intent reads across.
    static func storageKey(_ did: String) -> String {
        "aturi:writeSpend:\(did)"
    }

    private func readSpends(_ did: String) -> [Spend] {
        guard let data = defaults.data(forKey: Self.storageKey(did)),
            let parsed = try? JSONDecoder().decode([Spend].self, from: data)
        else { return [] }
        return parsed.filter { $0.n > 0 }
    }

    private func writeSpends(_ did: String, _ spends: [Spend]) {
        /* A ledger that will not encode is not worth failing a delete over;
           pacing degrades to the 429 backstop, as it does on the web when
           localStorage is unavailable. */
        guard let data = try? JSONEncoder().encode(spends) else { return }
        defaults.set(data, forKey: Self.storageKey(did))
    }

    /// Drop spends that have aged out of the trailing window.
    private static func prune(_ spends: [Spend], now: Date) -> [Spend] {
        let cutoff = now.timeIntervalSince1970 - pointsWindow
        return spends.filter { $0.t > cutoff }
    }

    /// Points spent in the trailing hour for this DID.
    public func pointsSpent(_ did: String, now: Date = Date()) -> Int {
        Self.prune(readSpends(did), now: now).reduce(0) { $0 + $1.n }
    }

    /// Points still available under the throttle budget right now.
    public func pointsAvailable(_ did: String, now: Date = Date()) -> Int {
        max(0, Self.throttlePointBudget - pointsSpent(did, now: now))
    }

    /// Record that `points` write-points were just spent.
    public func recordSpend(_ did: String, points: Int, now: Date = Date()) {
        guard points > 0 else { return }
        var spends = Self.prune(readSpends(did), now: now)
        spends.append(Spend(t: now.timeIntervalSince1970, n: points))
        writeSpends(did, spends)
    }

    /// Seconds to wait before spending `needed` more points keeps the
    /// trailing-hour total at or under the throttle budget. 0 when there
    /// is room right now. Assumes `needed` <= `throttlePointBudget` (true
    /// for one batch).
    public func secondsUntilBudget(_ did: String, needed: Int, now: Date = Date()) -> TimeInterval {
        let spends = Self.prune(readSpends(did), now: now).sorted { $0.t < $1.t }
        let spent = spends.reduce(0) { $0 + $1.n }
        if spent + needed <= Self.throttlePointBudget { return 0 }
        let nowSeconds = now.timeIntervalSince1970
        // Each spend frees its points when it ages out at t + window. Walk
        // oldest-first until enough has freed to fit `needed` under budget.
        let mustFree = spent + needed - Self.throttlePointBudget
        var freed = 0
        for spend in spends {
            freed += spend.n
            if freed >= mustFree {
                return max(0, spend.t + Self.pointsWindow - nowSeconds)
            }
        }
        // Unreachable while needed <= budget, but stay safe: wait for a
        // full window past the newest spend.
        guard let last = spends.last else { return 0 }
        return max(0, last.t + Self.pointsWindow - nowSeconds)
    }

    /// Forget the ledger for a DID (tests, and a sign-out that should not
    /// carry one account's spend into the next).
    public func clear(_ did: String) {
        defaults.removeObject(forKey: Self.storageKey(did))
    }
}
