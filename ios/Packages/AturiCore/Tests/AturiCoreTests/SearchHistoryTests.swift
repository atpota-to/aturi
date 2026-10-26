import Foundation
import XCTest
@testable import AturiCore

@MainActor
final class SearchHistoryTests: XCTestCase {
    private final class Clock {
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        func tick(_ seconds: TimeInterval = 1) { now = now.addingTimeInterval(seconds) }
    }

    nonisolated(unsafe) private var suiteName = ""
    nonisolated(unsafe) private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AturiCoreTests.history.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func makeStore(clock: Clock = Clock()) -> SearchHistoryStore {
        SearchHistoryStore(defaults: defaults, now: { clock.now })
    }

    private func entry(_ path: String, label: String = "x", did: String? = nil, avatar: String? = nil, count: Int = 1, at: Double = 1) -> SearchHistoryEntry {
        SearchHistoryEntry(path: path, label: label, avatar: avatar, did: did, count: count, lastVisited: at)
    }

    // MARK: Pure helpers

    func testNormalizePathKeyTouchesOnlyTheActorSegment() async {
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/@Dame.is"), "/explore/dame.is")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/@@dame.is"), "/explore/dame.is")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/DAME.IS/app.bsky.feed.post/AbC"), "/explore/dame.is/app.bsky.feed.post/AbC")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/%40Dame.is"), "/explore/dame.is")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/did:plc:ABC"), "/explore/did:plc:abc")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/pds/Bsky.Social"), "/explore/pds/Bsky.Social", "the tail is left intact")
        XCTAssertEqual(SearchHistory.normalizePathKey("/Explore/dame.is"), "/Explore/dame.is")
        XCTAssertEqual(SearchHistory.normalizePathKey("/profile/Dame.is"), "/profile/Dame.is")
        XCTAssertEqual(SearchHistory.normalizePathKey("/explore/%E0%A4%A"), "/explore/%e0%a4%a", "invalid percent-encoding keeps the raw segment")
    }

    func testIsActorLevelPath() async {
        XCTAssertTrue(SearchHistory.isActorLevelPath("/explore/dame.is"))
        XCTAssertFalse(SearchHistory.isActorLevelPath("/explore/dame.is/app.bsky.feed.post"))
        XCTAssertFalse(SearchHistory.isActorLevelPath("/profile/dame.is"))
    }

    func testMergePrefersTheNewestForMetadataAndSumsCounts() async {
        let old = SearchHistoryEntry(path: "/explore/dame.is", label: "Dame", sublabel: "@dame.is", avatar: "old.png", did: "did:plc:x", handle: "dame.is", count: 2, lastVisited: 100)
        let new = SearchHistoryEntry(path: "/explore/@Dame.is", label: "", sublabel: nil, avatar: nil, did: nil, handle: nil, count: 1, lastVisited: 200)
        let merged = SearchHistory.merge(old, new)
        XCTAssertEqual(merged.path, "/explore/@Dame.is")
        XCTAssertEqual(merged.label, "Dame", "an empty newest label falls back")
        XCTAssertEqual(merged.sublabel, "@dame.is")
        XCTAssertEqual(merged.avatar, "old.png")
        XCTAssertEqual(merged.did, "did:plc:x")
        XCTAssertEqual(merged.count, 3)
        XCTAssertEqual(merged.lastVisited, 200)
        XCTAssertEqual(SearchHistory.merge(new, old), merged, "argument order does not matter")
        let tie = SearchHistory.merge(entry("/a", label: "A", at: 5), entry("/b", label: "B", at: 5))
        XCTAssertEqual(tie.path, "/b", "ties favour the second entry")
    }

    func testDedupeFoldsPathVariantsAndSharedDids() async {
        let entries = [
            entry("/explore/dame.is", label: "one", did: "did:plc:X", count: 1, at: 1),
            entry("/explore/@Dame.is", label: "two", count: 1, at: 2),
            entry("/explore/did:plc:x", label: "three", did: "did:plc:x", count: 3, at: 3),
            entry("/explore/other.test", label: "four", count: 1, at: 4),
            entry("/explore/dame.is/app.bsky.feed.post/a", label: "rec a", did: "did:plc:x", at: 5),
            entry("/explore/dame.is/app.bsky.feed.post/b", label: "rec b", did: "did:plc:x", at: 6),
        ]
        let deduped = SearchHistory.dedupe(entries)
        XCTAssertEqual(deduped.map(\.label), ["three", "four", "rec a", "rec b"], "first-seen order, newest label")
        XCTAssertEqual(deduped[0].count, 5)
        XCTAssertEqual(deduped[0].path, "/explore/did:plc:x")
        XCTAssertEqual(deduped[0].lastVisited, 3)
    }

    func testRecordLevelPathsNeverMergeAcrossDids() async {
        let deduped = SearchHistory.dedupe([
            entry("/explore/dame.is/app.bsky.feed.post/a", did: "did:plc:x"),
            entry("/explore/did:plc:x/app.bsky.feed.post/a", did: "did:plc:x"),
        ])
        XCTAssertEqual(deduped.count, 2)
    }

    func testParseTolerantlyDropsJunkRows() async {
        let data = Data(#"[{"path": "/explore/a.test", "label": "A", "count": 2, "lastVisited": 10}, {"path": 1}, "nope", null, {"path": "/explore/b.test", "label": "B", "count": "2", "lastVisited": 10}]"#.utf8)
        let parsed = SearchHistory.parse(data)
        XCTAssertEqual(parsed.map(\.path), ["/explore/a.test"])
        XCTAssertEqual(parsed.first?.count, 2)
        XCTAssertEqual(SearchHistory.parse(Data(#"{"path": "x"}"#.utf8)), [])
        XCTAssertEqual(SearchHistory.parse(Data("junk".utf8)), [])
        let roundTrip = SearchHistory.parse(SearchHistory.serialize(parsed))
        XCTAssertEqual(roundTrip, parsed)
    }

    func testActorFromPath() async {
        XCTAssertEqual(SearchHistory.actorFromPath("/explore/dame.is"), "dame.is")
        XCTAssertEqual(SearchHistory.actorFromPath("/explore/did%3Aplc%3Ax/app.bsky.feed.post/r"), "did:plc:x")
        XCTAssertEqual(SearchHistory.actorFromPath("/explore/@Dame.is"), "@Dame.is", "not normalised; callers resolve it")
        XCTAssertNil(SearchHistory.actorFromPath("/explore/pds/bsky.social"))
        XCTAssertNil(SearchHistory.actorFromPath("/explore/"))
        XCTAssertNil(SearchHistory.actorFromPath("/explore//x"))
        XCTAssertNil(SearchHistory.actorFromPath("/profile/dame.is"))
    }

    func testRecentsAndFrequentRanking() async {
        let entries = [
            entry("/a", label: "a", count: 1, at: 10),
            entry("/b", label: "b", count: 3, at: 5),
            entry("/c", label: "c", count: 3, at: 8),
            entry("/d", label: "d", count: 2, at: 20),
            entry("/e", label: "e", count: 1, at: 10),
        ]
        XCTAssertEqual(SearchHistory.recents(entries, limit: 3).map(\.label), ["d", "a", "e"], "newest first, ties keep order")
        XCTAssertEqual(SearchHistory.recents(entries, limit: 0), [])
        XCTAssertEqual(SearchHistory.frequent(entries, limit: 10).map(\.label), ["c", "b", "d"], "busiest first, then recency; single visits excluded")
        XCTAssertEqual(SearchHistory.frequent(entries, limit: 1).map(\.label), ["c"])
        XCTAssertEqual(SearchHistory.frequentMinCount, 2)
        XCTAssertEqual(SearchHistory.maxEntries, 50)
        XCTAssertEqual(SearchHistory.storageKey, "aturi.searchHistory.v1")
    }

    // MARK: Store

    func testRecordActorVisitCreatesAndBumpsAnEntry() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.recordActorVisit(did: "did:plc:x", handle: " dame.is ", displayName: "Dame", avatar: "a.png")
        XCTAssertEqual(store.entries.count, 1)
        let first = store.entries[0]
        XCTAssertEqual(first.path, "/explore/dame.is")
        XCTAssertEqual(first.label, "Dame")
        XCTAssertEqual(first.sublabel, "@dame.is")
        XCTAssertEqual(first.avatar, "a.png")
        XCTAssertEqual(first.did, "did:plc:x")
        XCTAssertEqual(first.handle, "dame.is")
        XCTAssertEqual(first.count, 1)
        XCTAssertEqual(first.lastVisited, 1_700_000_000_000)

        clock.tick()
        store.recordActorVisit(handle: "@Dame.is")
        XCTAssertEqual(store.entries.count, 1, "the @ and casing variants fold into the first entry")
        let second = store.entries[0]
        XCTAssertEqual(second.count, 2)
        XCTAssertEqual(second.label, "@Dame.is", "a visit without a display name labels by handle")
        XCTAssertEqual(second.avatar, "a.png", "a previously known avatar is kept")
        XCTAssertEqual(second.did, "did:plc:x")
        XCTAssertEqual(second.lastVisited, 1_700_000_001_000)
        XCTAssertEqual(second.path, "/explore/dame.is", "the stored path stays canonical")
    }

    func testAVisitByDidFoldsIntoAPriorHandleVisit() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.recordActorVisit(did: "did:plc:x", handle: "dame.is")
        clock.tick()
        // Same account reached under a new handle: the DID matches
        // case-insensitively and the stored entry is actor-level, so it folds.
        store.recordActorVisit(did: "DID:PLC:X", handle: "dame.bsky.social", displayName: "Dame")
        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].count, 2)
        XCTAssertEqual(store.entries[0].path, "/explore/dame.is", "the first path is kept")
        XCTAssertEqual(store.entries[0].label, "Dame")
        XCTAssertEqual(store.entries[0].handle, "dame.bsky.social")
        XCTAssertEqual(store.entries[0].did, "DID:PLC:X")
        // A query visit carries no DID, so a DID-spelled path is its own entry
        // until a later actor visit folds it (the web behaves the same way).
        clock.tick()
        store.recordQueryVisit("did:plc:X", path: "/explore/did:plc:X")
        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.entries[0].path, "/explore/did:plc:x")
        // A record path under the same DID is its own destination.
        store.recordQueryVisit("a post", path: "/explore/did:plc:x/app.bsky.feed.post/3k")
        XCTAssertEqual(store.entries.count, 3)
    }

    func testRecordQueryVisitTrimsAndIgnoresBlanks() async {
        let store = makeStore()
        store.recordQueryVisit("   ", path: "/explore/dame.is")
        store.recordQueryVisit("dame", path: "  ")
        XCTAssertTrue(store.entries.isEmpty)
        store.recordQueryVisit("  dame  ", path: " /explore/pds/bsky.social ")
        XCTAssertEqual(store.entries.map(\.label), ["dame"])
        XCTAssertEqual(store.entries[0].path, "/explore/pds/bsky.social")
        XCTAssertNil(store.entries[0].sublabel)
        store.recordActorVisit(handle: "   ")
        XCTAssertEqual(store.entries.count, 1)
    }

    func testTheListIsCappedAtTheNewestFifty() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        for i in 0..<55 {
            store.recordQueryVisit("q\(i)", path: "/explore/user\(i).test")
            clock.tick()
        }
        XCTAssertEqual(store.entries.count, 50)
        XCTAssertEqual(store.entries.first?.label, "q54", "newest first")
        XCTAssertEqual(store.entries.last?.label, "q5", "the five oldest were dropped")
        XCTAssertEqual(store.recents(limit: 2).map(\.label), ["q54", "q53"])
        XCTAssertEqual(store.frequent(limit: 5), [])
    }

    func testFrequentFromTheStore() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.recordActorVisit(handle: "a.test")
        clock.tick()
        store.recordActorVisit(handle: "b.test")
        clock.tick()
        store.recordActorVisit(handle: "a.test")
        clock.tick()
        store.recordActorVisit(handle: "c.test")
        XCTAssertEqual(store.frequent(limit: 5).map(\.handle), ["a.test"])
        XCTAssertEqual(store.recents(limit: 5).map(\.handle), ["c.test", "a.test", "b.test"])
    }

    func testEnrichPatchesMetadataOnly() async {
        let clock = Clock()
        let store = makeStore(clock: clock)
        store.recordQueryVisit("dame", path: "/explore/dame.is")
        clock.tick(100)
        XCTAssertTrue(store.enrich(path: "/explore/dame.is", patch: SearchHistoryPatch(avatar: "a.png", handle: "dame.is")))
        XCTAssertEqual(store.entries[0].avatar, "a.png")
        XCTAssertEqual(store.entries[0].handle, "dame.is")
        XCTAssertEqual(store.entries[0].label, "dame")
        XCTAssertEqual(store.entries[0].count, 1)
        XCTAssertEqual(store.entries[0].lastVisited, 1_700_000_000_000, "recency untouched")
        XCTAssertFalse(store.enrich(path: "/explore/nobody.test", patch: SearchHistoryPatch(avatar: "x")))
        XCTAssertFalse(store.enrich(path: "/explore/@Dame.is", patch: SearchHistoryPatch(avatar: "x")), "matches the stored path exactly")
        XCTAssertEqual(SearchHistoryStore(defaults: defaults).entries[0].avatar, "a.png", "persisted")
    }

    func testPersistenceAcrossStoresAndClear() async {
        let store = makeStore()
        store.recordActorVisit(handle: "dame.is", displayName: "Dame")
        let again = SearchHistoryStore(defaults: defaults)
        XCTAssertEqual(again.entries, store.entries)
        XCTAssertNotNil(defaults.data(forKey: SearchHistory.storageKey))
        let raw = try! JSONValue.parse(defaults.data(forKey: SearchHistory.storageKey)!)
        XCTAssertEqual(raw[0]?["path"]?.stringValue, "/explore/dame.is")
        XCTAssertEqual(raw[0]?["count"]?.intValue, 1)
        store.recordActorVisit(handle: "other.test")
        again.reload()
        XCTAssertEqual(again.entries.count, 2)
        store.clear()
        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertNil(defaults.data(forKey: SearchHistory.storageKey))
        XCTAssertTrue(SearchHistoryStore(defaults: defaults).entries.isEmpty)
    }

    func testStoreDedupesWhatItReads() async {
        let rows: [SearchHistoryEntry] = [
            entry("/explore/dame.is", label: "one", count: 1, at: 1),
            entry("/explore/@dame.is", label: "two", count: 2, at: 2),
        ]
        defaults.set(SearchHistory.serialize(rows), forKey: SearchHistory.storageKey)
        let store = makeStore()
        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].count, 3)
        XCTAssertEqual(store.entries[0].lastVisitedDate, Date(timeIntervalSince1970: 0.002))
    }
}
