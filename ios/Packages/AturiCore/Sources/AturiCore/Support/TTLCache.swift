import Foundation

/// A small expiring map, the shape of the web's in-memory resolver caches
/// (handle -> DID for five minutes, and the like). Expired entries are
/// dropped lazily on read, which is enough for the handful of keys a screen
/// touches; there is no sweeper.
///
/// The clock is injectable so tests can move time instead of sleeping.
public actor TTLCache<Key: Hashable & Sendable, Value: Sendable> {
    private struct Entry {
        let value: Value
        let expires: Date
    }

    private let ttl: TimeInterval
    private let now: @Sendable () -> Date
    private var entries: [Key: Entry] = [:]

    public init(ttl: TimeInterval, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.ttl = ttl
        self.now = clock
    }

    public func get(_ key: Key) -> Value? {
        guard let entry = entries[key] else { return nil }
        if entry.expires <= now() {
            entries[key] = nil
            return nil
        }
        return entry.value
    }

    public func set(_ key: Key, _ value: Value) {
        entries[key] = Entry(value: value, expires: now().addingTimeInterval(ttl))
    }

    public func remove(_ key: Key) {
        entries[key] = nil
    }

    public func clear() {
        entries.removeAll()
    }

    /// Live entries only; used by tests and by the settings screen's
    /// "clear caches" affordance to say how much it would drop.
    public var count: Int {
        let current = now()
        return entries.values.filter { $0.expires > current }.count
    }
}
