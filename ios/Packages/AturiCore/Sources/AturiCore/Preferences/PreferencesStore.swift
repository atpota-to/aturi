import Foundation
import Observation

// Port of the local half of src/components/PreferencesProvider.tsx. Writes
// are local-first and instant; the PDS mirror is somebody else's job. The
// store knows nothing about OAuth: the app's session layer implements
// `PreferencesSync` and receives every change after a debounce, so burst
// edits (a drag reorder, typing a group name) collapse into one record put.

/// Implemented by the app's session layer to mirror preferences to the PDS.
/// Called on the main actor after the debounce; the implementation owns the
/// network call and any sync-status UI.
public protocol PreferencesSync: AnyObject {
    @MainActor func preferencesDidChange(_ prefs: Preferences)
}

/// What `load(fromRemote:)` decided, so the caller knows whether the PDS
/// copy needs to catch up with local.
public enum PreferencesLoadOutcome: Hashable, Sendable {
    /// The remote record was at least as new and replaced the local copy.
    case adoptedRemote
    /// Local was kept. `pushToRemote` is true when the caller should write
    /// it to the PDS: the record was missing and local carries customisation,
    /// or local was newer and differs from the record.
    case keptLocal(pushToRemote: Bool)
}

@MainActor
@Observable
public final class PreferencesStore {
    /// The app group both the app and the share extension read from.
    public nonisolated static let appGroupSuite = "group.to.aturi.app"
    /// The web's `PDS_WRITE_DEBOUNCE_MS`.
    public nonisolated static let syncDebounce: TimeInterval = 1.5

    public private(set) var prefs: Preferences

    /// Set by the session layer when signed in; nil means no mirroring.
    @ObservationIgnored public weak var sync: PreferencesSync?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let storageKey: String
    @ObservationIgnored private let debounce: TimeInterval
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var pendingSync: Task<Void, Never>?

    /// The app group suite, falling back to standard defaults when the
    /// entitlement is missing (a simulator build without the group).
    public nonisolated static func appGroupDefaults() -> UserDefaults {
        UserDefaults(suiteName: appGroupSuite) ?? .standard
    }

    public init(
        defaults: UserDefaults = PreferencesStore.appGroupDefaults(),
        storageKey: String = Preferences.localStorageKey,
        debounce: TimeInterval = PreferencesStore.syncDebounce,
        now: @escaping () -> Date = { Date() }
    ) {
        self.defaults = defaults
        self.storageKey = storageKey
        self.debounce = debounce
        self.now = now
        prefs = PreferencesStore.readLocal(from: defaults, key: storageKey)
    }

    // MARK: Local storage

    /// `readLocalPreferences`: the stored blob through `mergeWithDefaults`,
    /// or the defaults when nothing is stored or it does not parse.
    static func readLocal(from defaults: UserDefaults, key: String) -> Preferences {
        guard let data = defaults.data(forKey: key), let json = try? JSONValue.parse(data) else { return .defaults }
        return Preferences.mergeWithDefaults(json)
    }

    /// `writeLocalPreferences`: stamps `updatedAt` when the caller left it empty.
    private func writeLocal(_ value: Preferences) {
        var stamped = value
        if stamped.updatedAt.isEmpty { stamped.updatedAt = Formatting.isoTimestamp(now()) }
        defaults.set(Data(stamped.jsonValue().compactString().utf8), forKey: storageKey)
    }

    /// Re-read from storage, for when another process (the extension) wrote.
    public func reload() {
        prefs = PreferencesStore.readLocal(from: defaults, key: storageKey)
    }

    // MARK: Updates

    /// Apply a change: stamps `updatedAt`, writes storage synchronously, and
    /// schedules the debounced sync when a `PreferencesSync` is attached.
    public func update(_ mutate: (inout Preferences) -> Void) {
        var next = prefs
        mutate(&next)
        next.updatedAt = Formatting.isoTimestamp(now())
        prefs = next
        writeLocal(next)
        scheduleSync(next)
    }

    /// Drop back to defaults locally. Does not delete the PDS record; the
    /// next sync writes the defaults there like any other change.
    public func reset() {
        update { $0 = .defaults }
    }

    private func scheduleSync(_ value: Preferences) {
        pendingSync?.cancel()
        guard sync != nil else { return }
        let delay = debounce
        pendingSync = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard !Task.isCancelled, let self else { return }
            self.pendingSync = nil
            self.sync?.preferencesDidChange(value)
        }
    }

    /// Deliver a pending sync now instead of after the debounce (app going to
    /// background). No-op when nothing is pending.
    public func flushPendingSync() {
        guard pendingSync != nil else { return }
        pendingSync?.cancel()
        pendingSync = nil
        sync?.preferencesDidChange(prefs)
    }

    public var hasPendingSync: Bool { pendingSync != nil }

    // MARK: Sign-in reconciliation

    /// Reconcile with the PDS copy on sign-in, mirroring the provider: a
    /// missing record leaves local standing (and asks for a push when local
    /// carries customisation); an existing record wins when it is at least
    /// as new as local, otherwise local stands and should be pushed if the
    /// two differ. Adopting the remote copy writes it to storage without
    /// re-stamping `updatedAt` and does not schedule a sync, since the PDS
    /// already holds it.
    @discardableResult
    public func load(fromRemote remote: Preferences?) -> PreferencesLoadOutcome {
        guard let remote else {
            return .keptLocal(pushToRemote: prefs.hasLocalCustomization)
        }
        let local = prefs
        let same = Preferences.preferencesAreEqual(local, remote)
        if Preferences.secondIsAtLeastAsNew(local, remote) {
            if !same {
                prefs = remote
                writeLocal(remote)
            }
            return .adoptedRemote
        }
        return .keptLocal(pushToRemote: !same)
    }
}
