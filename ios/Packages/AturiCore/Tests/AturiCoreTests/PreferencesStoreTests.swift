import Foundation
import XCTest
@testable import AturiCore

/// Covers the local-first lifecycle the web's PreferencesProvider implements:
/// storage on every update, the debounced sync hook, and sign-in
/// reconciliation with the PDS copy.
@MainActor
final class PreferencesStoreTests: XCTestCase {
    private final class SyncSpy: PreferencesSync {
        var received: [Preferences] = []
        func preferencesDidChange(_ prefs: Preferences) {
            received.append(prefs)
        }
    }

    private final class Clock {
        var now = Date(timeIntervalSince1970: 1_758_276_000)
    }

    nonisolated(unsafe) private var suiteName = ""
    nonisolated(unsafe) private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AturiCoreTests.prefs.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func makeStore(debounce: TimeInterval = 0.05, clock: Clock = Clock()) -> PreferencesStore {
        PreferencesStore(defaults: defaults, debounce: debounce, now: { clock.now })
    }

    func testStartsWithDefaultsWhenNothingIsStored() async {
        let store = makeStore()
        XCTAssertEqual(store.prefs, .defaults)
        XCTAssertFalse(store.hasPendingSync)
    }

    func testUpdateStampsUpdatedAtPersistsAndReloads() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .tide }
        XCTAssertEqual(store.prefs.colorScheme, .tide)
        XCTAssertEqual(store.prefs.updatedAt, "2025-09-19T10:00:00.000Z")

        let again = PreferencesStore(defaults: defaults, debounce: 0)
        XCTAssertEqual(again.prefs, store.prefs)

        // The stored blob is the web's localStorage shape.
        let raw = try! JSONValue.parse(defaults.data(forKey: Preferences.localStorageKey)!)
        XCTAssertEqual(raw["colorScheme"]?.stringValue, "tide")
        XCTAssertEqual(raw["updatedAt"]?.stringValue, "2025-09-19T10:00:00.000Z")
        XCTAssertNotNil(raw["waypointGroups"]?.arrayValue)
        XCTAssertNotNil(raw["minimalPostPreview"]?.boolValue)
        XCTAssertNil(raw["$type"])
    }

    func testCorruptStorageFallsBackToDefaults() async {
        defaults.set(Data("{not json".utf8), forKey: Preferences.localStorageKey)
        XCTAssertEqual(makeStore().prefs, .defaults)
        defaults.set(Data("[1,2]".utf8), forKey: Preferences.localStorageKey)
        XCTAssertEqual(makeStore().prefs, .defaults)
    }

    func testReloadPicksUpAWriteFromAnotherProcess() async {
        let store = makeStore()
        var other = Preferences.defaults
        other.colorScheme = .noir
        defaults.set(Data(other.jsonValue().compactString().utf8), forKey: Preferences.localStorageKey)
        XCTAssertEqual(store.prefs.colorScheme, .moss)
        store.reload()
        XCTAssertEqual(store.prefs.colorScheme, .noir)
    }

    func testResetReturnsToDefaultsWithAFreshStamp() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .bloom; $0.autoRedirect = true }
        clock.now = clock.now.addingTimeInterval(60)
        store.reset()
        XCTAssertEqual(store.prefs.colorScheme, .moss)
        XCTAssertFalse(store.prefs.autoRedirect)
        XCTAssertEqual(store.prefs.updatedAt, "2025-09-19T10:01:00.000Z")
        XCTAssertTrue(Preferences.preferencesAreEqual(store.prefs, PreferencesStore(defaults: defaults, debounce: 0).prefs))
    }

    func testNoSyncIsScheduledWithoutAHook() async {
        let store = makeStore()
        store.update { $0.colorScheme = .sol }
        XCTAssertFalse(store.hasPendingSync)
    }

    func testDebounceCoalescesABurstIntoOneSync() async throws {
        let spy = SyncSpy()
        let store = makeStore(debounce: 0.05)
        store.sync = spy
        store.update { $0.colorScheme = .ember }
        store.update { $0.autoRedirect = true }
        store.update { $0.setFavorite(for: .blueskySocial, waypointId: "deer") }
        XCTAssertTrue(store.hasPendingSync)
        XCTAssertTrue(spy.received.isEmpty, "nothing is delivered before the debounce elapses")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(spy.received.count, 1)
        XCTAssertEqual(spy.received.first, store.prefs)
        XCTAssertEqual(spy.received.first?.favoriteByFamily, [.blueskySocial: "deer"])
        XCTAssertFalse(store.hasPendingSync)
    }

    func testEachQuietPeriodSyncsAgain() async throws {
        let spy = SyncSpy()
        let store = makeStore(debounce: 0.02)
        store.sync = spy
        store.update { $0.colorScheme = .ember }
        try await Task.sleep(nanoseconds: 150_000_000)
        store.update { $0.colorScheme = .dusk }
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(spy.received.map(\.colorScheme), [.ember, .dusk])
    }

    func testFlushDeliversImmediatelyAndCancelsTheTimer() async throws {
        let spy = SyncSpy()
        let store = makeStore(debounce: 0.2)
        store.sync = spy
        store.flushPendingSync()
        XCTAssertTrue(spy.received.isEmpty, "nothing pending, nothing sent")
        store.update { $0.waypointLayout = .grid }
        store.flushPendingSync()
        XCTAssertEqual(spy.received.count, 1)
        XCTAssertFalse(store.hasPendingSync)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(spy.received.count, 1, "the cancelled timer does not fire a second time")
    }

    func testSyncHookIsHeldWeakly() async {
        let store = makeStore()
        var spy: SyncSpy? = SyncSpy()
        store.sync = spy
        XCTAssertNotNil(store.sync)
        spy = nil
        XCTAssertNil(store.sync)
    }

    // MARK: load(fromRemote:)

    func testMissingRemoteKeepsLocalAndAsksForAPushOnlyWhenCustomized() async {
        let store = makeStore()
        XCTAssertEqual(store.load(fromRemote: nil), .keptLocal(pushToRemote: false))
        store.update { $0.colorScheme = .tide }
        XCTAssertEqual(store.load(fromRemote: nil), .keptLocal(pushToRemote: true))
        XCTAssertEqual(store.prefs.colorScheme, .tide)
    }

    func testNewerRemoteOverwritesLocalAndIsPersisted() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .tide }
        var remote = Preferences.defaults
        remote.colorScheme = .bloom
        remote.updatedAt = "2025-09-20T00:00:00.000Z"
        XCTAssertEqual(store.load(fromRemote: remote), .adoptedRemote)
        XCTAssertEqual(store.prefs, remote)
        XCTAssertEqual(PreferencesStore(defaults: defaults, debounce: 0).prefs, remote)
        XCTAssertFalse(store.hasPendingSync, "adopting the PDS copy does not write it back")
    }

    func testOlderRemoteKeepsLocalAndAsksForAPush() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .tide }
        var remote = Preferences.defaults
        remote.colorScheme = .bloom
        remote.updatedAt = "2025-09-18T00:00:00.000Z"
        XCTAssertEqual(store.load(fromRemote: remote), .keptLocal(pushToRemote: true))
        XCTAssertEqual(store.prefs.colorScheme, .tide)
    }

    func testEqualTimestampsPreferTheRemoteCopy() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .tide }
        var remote = store.prefs
        remote.colorScheme = .noir
        XCTAssertEqual(store.load(fromRemote: remote), .adoptedRemote)
        XCTAssertEqual(store.prefs.colorScheme, .noir)
    }

    func testIdenticalRemoteIsANoOp() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.update { $0.colorScheme = .tide }
        let before = defaults.data(forKey: Preferences.localStorageKey)
        XCTAssertEqual(store.load(fromRemote: store.prefs), .adoptedRemote)
        XCTAssertEqual(defaults.data(forKey: Preferences.localStorageKey), before)
    }

    func testFreshInstallAdoptsAnyExistingRecord() async {
        // Local is the epoch-stamped defaults, so even an old record is newer.
        let store = makeStore()
        var remote = Preferences.defaults
        remote.colorScheme = .ember
        remote.updatedAt = "2024-01-01T00:00:00.000Z"
        XCTAssertEqual(store.load(fromRemote: remote), .adoptedRemote)
        XCTAssertEqual(store.prefs.colorScheme, .ember)
    }

    func testAppGroupDefaultsNeverReturnsNil() async {
        _ = PreferencesStore.appGroupDefaults()
        XCTAssertEqual(PreferencesStore.appGroupSuite, "group.to.aturi.app")
        XCTAssertEqual(PreferencesStore.syncDebounce, 1.5)
    }
}
