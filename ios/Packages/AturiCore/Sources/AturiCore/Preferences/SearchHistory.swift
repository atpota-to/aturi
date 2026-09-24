import Foundation
import Observation

// Port of src/utils/searchHistory.ts: the device-local history of explorer
// searches that powers the "recent" and "frequent" rows under the search
// box. Nothing here touches the network or the user's PDS; it lives in the
// app group's UserDefaults so the share extension sees the same list, and
// never leaves the device.

/// One remembered destination. `path` doubles as the dedup key.
public struct SearchHistoryEntry: Codable, Hashable, Sendable, Identifiable {
    /// Destination explorer path, stored in canonical form.
    public var path: String
    /// Primary line: display name, handle, or the raw query.
    public var label: String
    /// Secondary line, usually `@handle`.
    public var sublabel: String?
    public var avatar: String?
    public var did: String?
    public var handle: String?
    /// Total recorded visits.
    public var count: Int
    /// Epoch milliseconds of the most recent visit, the web's `Date.now()`.
    public var lastVisited: Double

    public var id: String { path }

    public init(path: String, label: String, sublabel: String? = nil, avatar: String? = nil, did: String? = nil, handle: String? = nil, count: Int, lastVisited: Double) {
        self.path = path
        self.label = label
        self.sublabel = sublabel
        self.avatar = avatar
        self.did = did
        self.handle = handle
        self.count = count
        self.lastVisited = lastVisited
    }

    /// `isEntry`: string path and label, numeric count and lastVisited.
    public init?(json: JSONValue) {
        guard let path = json["path"]?.stringValue,
              let label = json["label"]?.stringValue,
              let count = json["count"]?.doubleValue,
              let lastVisited = json["lastVisited"]?.doubleValue else { return nil }
        self.init(
            path: path,
            label: label,
            sublabel: json["sublabel"]?.stringValue,
            avatar: json["avatar"]?.stringValue,
            did: json["did"]?.stringValue,
            handle: json["handle"]?.stringValue,
            count: Int(count),
            lastVisited: lastVisited
        )
    }

    public var jsonValue: JSONValue {
        var object: [String: JSONValue] = [
            "path": .string(path),
            "label": .string(label),
            "count": .number(Double(count)),
            "lastVisited": .number(lastVisited),
        ]
        if let sublabel { object["sublabel"] = .string(sublabel) }
        if let avatar { object["avatar"] = .string(avatar) }
        if let did { object["did"] = .string(did) }
        if let handle { object["handle"] = .string(handle) }
        return .object(object)
    }

    public var lastVisitedDate: Date {
        Date(timeIntervalSince1970: lastVisited / 1000)
    }
}

/// Display metadata to patch onto a stored entry without touching its visit
/// count or recency. Nil fields are left as they were.
public struct SearchHistoryPatch: Hashable, Sendable {
    public var label: String?
    public var sublabel: String?
    public var avatar: String?
    public var did: String?
    public var handle: String?

    public init(label: String? = nil, sublabel: String? = nil, avatar: String? = nil, did: String? = nil, handle: String? = nil) {
        self.label = label
        self.sublabel = sublabel
        self.avatar = avatar
        self.did = did
        self.handle = handle
    }
}

/// The pure half: normalisation, merging and ranking, exposed for tests and
/// for callers that hold their own entry list.
public enum SearchHistory {
    public static let storageKey = "aturi.searchHistory.v1"
    /// Cap on the stored list so the key cannot grow without bound.
    public static let maxEntries = 50
    /// Visits a path needs before it counts as "frequent".
    public static let frequentMinCount = 2
    static let explorePrefix = "/explore/"

    /// Canonical form of a path for dedup. Only the leading actor segment is
    /// touched: its `@` prefix is stripped and it is lowercased, so
    /// `/explore/@Dame.is` and `/explore/DAME.IS` collapse to one key. The
    /// collection/rkey tail is left intact because rkeys are case-sensitive.
    public static func normalizePathKey(_ path: String) -> String {
        guard path.hasPrefix(explorePrefix) else { return path }
        let rest = path.dropFirst(explorePrefix.count)
        let rawSegment: Substring
        let tail: Substring
        if let slash = rest.firstIndex(of: "/") {
            rawSegment = rest[rest.startIndex..<slash]
            tail = rest[slash...]
        } else {
            rawSegment = rest
            tail = ""
        }
        var actor = String(rawSegment).removingPercentEncoding ?? String(rawSegment)
        while actor.hasPrefix("@") { actor.removeFirst() }
        return explorePrefix + actor.lowercased() + tail
    }

    /// An `/explore/<actor>` path with no tail: the only shape where a shared
    /// DID means the same destination and merging is safe.
    public static func isActorLevelPath(_ pathKey: String) -> Bool {
        pathKey.hasPrefix(explorePrefix) && !pathKey.dropFirst(explorePrefix.count).contains("/")
    }

    /// Combine two entries for one destination: the newest wins for display
    /// metadata, counts sum, recency is the later of the two.
    public static func merge(_ a: SearchHistoryEntry, _ b: SearchHistoryEntry) -> SearchHistoryEntry {
        let newest = b.lastVisited >= a.lastVisited ? b : a
        let oldest = b.lastVisited >= a.lastVisited ? a : b
        return SearchHistoryEntry(
            path: newest.path,
            label: newest.label.isEmpty ? oldest.label : newest.label,
            sublabel: newest.sublabel ?? oldest.sublabel,
            avatar: newest.avatar ?? oldest.avatar,
            did: newest.did ?? oldest.did,
            handle: newest.handle ?? oldest.handle,
            count: a.count + b.count,
            lastVisited: max(a.lastVisited, b.lastVisited)
        )
    }

    /// Collapse entries that point at the same account: first by canonical
    /// path, then by shared DID for actor-level paths. Record-level paths
    /// never merge across DIDs so distinct records of one author stay apart.
    /// First-seen order is preserved.
    public static func dedupe(_ entries: [SearchHistoryEntry]) -> [SearchHistoryEntry] {
        var byKey: [String: SearchHistoryEntry] = [:]
        var keyOrder: [String] = []
        var didToKey: [String: String] = [:]
        for raw in entries {
            let pathKey = normalizePathKey(raw.path)
            let didKey = isActorLevelPath(pathKey) ? raw.did?.lowercased() : nil
            var key = pathKey
            if let didKey, let existing = didToKey[didKey] { key = existing }
            if let previous = byKey[key] {
                byKey[key] = merge(previous, raw)
            } else {
                byKey[key] = raw
                keyOrder.append(key)
            }
            if let didKey, didToKey[didKey] == nil { didToKey[didKey] = key }
        }
        return keyOrder.compactMap { byKey[$0] }
    }

    /// Parse the stored JSON array, dropping malformed rows and folding
    /// duplicates. Anything that is not an array is an empty history.
    public static func parse(_ data: Data) -> [SearchHistoryEntry] {
        guard let json = try? JSONValue.parse(data), let rows = json.arrayValue else { return [] }
        return dedupe(rows.compactMap(SearchHistoryEntry.init(json:)))
    }

    public static func serialize(_ entries: [SearchHistoryEntry]) -> Data {
        Data(JSONValue.array(entries.map(\.jsonValue)).compactString().utf8)
    }

    /// The actor identifier (handle or DID) of an `/explore/<repo>` path, for
    /// avatar enrichment. Nil for PDS paths and anything that is not a repo
    /// destination.
    public static func actorFromPath(_ path: String) -> String? {
        guard path.hasPrefix(explorePrefix) else { return nil }
        let rest = path.dropFirst(explorePrefix.count)
        guard !rest.isEmpty, !rest.hasPrefix("pds/") else { return nil }
        let segment = rest.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        guard !segment.isEmpty else { return nil }
        return segment.removingPercentEncoding ?? segment
    }

    /// Most recently visited entries, newest first.
    public static func recents(_ entries: [SearchHistoryEntry], limit: Int) -> [SearchHistoryEntry] {
        Array(stableSorted(entries) { $0.lastVisited > $1.lastVisited }.prefix(max(0, limit)))
    }

    /// Most-visited entries, busiest first with recency as the tiebreak. Only
    /// repeat visits qualify so the row stays distinct from "recent".
    public static func frequent(_ entries: [SearchHistoryEntry], limit: Int) -> [SearchHistoryEntry] {
        let repeated = entries.filter { $0.count >= frequentMinCount }
        let sorted = stableSorted(repeated) { a, b in
            a.count != b.count ? a.count > b.count : a.lastVisited > b.lastVisited
        }
        return Array(sorted.prefix(max(0, limit)))
    }

    /// JavaScript's sort is stable; Swift's only promises it in practice, so
    /// ties are broken by original position explicitly.
    static func stableSorted(_ entries: [SearchHistoryEntry], by before: (SearchHistoryEntry, SearchHistoryEntry) -> Bool) -> [SearchHistoryEntry] {
        entries.enumerated()
            .sorted { lhs, rhs in
                if before(lhs.element, rhs.element) { return true }
                if before(rhs.element, lhs.element) { return false }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}

/// The stored history: reads on init, rewrites the UserDefaults key on every
/// change, and publishes `entries` for the search screen to observe.
@MainActor
@Observable
public final class SearchHistoryStore {
    public private(set) var entries: [SearchHistoryEntry] = []

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let storageKey: String
    @ObservationIgnored private let now: () -> Date

    /// `defaults` should be the app group suite so the extension sees the
    /// same list; `now` is injectable for tests.
    public init(defaults: UserDefaults, storageKey: String = SearchHistory.storageKey, now: @escaping () -> Date = { Date() }) {
        self.defaults = defaults
        self.storageKey = storageKey
        self.now = now
        entries = SearchHistoryStore.read(from: defaults, key: storageKey)
    }

    private static func read(from defaults: UserDefaults, key: String) -> [SearchHistoryEntry] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return SearchHistory.parse(data)
    }

    private func write(_ next: [SearchHistoryEntry]) {
        entries = next
        defaults.set(SearchHistory.serialize(next), forKey: storageKey)
    }

    /// Re-read from storage, for when another process (the extension) wrote.
    public func reload() {
        entries = SearchHistoryStore.read(from: defaults, key: storageKey)
    }

    public func clear() {
        entries = []
        defaults.removeObject(forKey: storageKey)
    }

    /// Record one navigation. An existing entry for the destination (matched
    /// by canonical path, or by DID for actor-level paths) has its count
    /// bumped and metadata refreshed: new non-nil values win, a previously
    /// known avatar or handle is kept when the new visit lacks one.
    private func recordVisit(path rawPath: String, label rawLabel: String, sublabel: String? = nil, avatar: String? = nil, did: String? = nil, handle: String? = nil) {
        let trimmedPath = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = rawLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty, !label.isEmpty else { return }
        // Store the canonical path so trivial variants never create a second
        // entry in the first place.
        let path = SearchHistory.normalizePathKey(trimmedPath)
        var next = entries
        let stamp = now().timeIntervalSince1970 * 1000
        let inDid = did?.lowercased()
        let existing = next.firstIndex { entry in
            let key = SearchHistory.normalizePathKey(entry.path)
            if key == path { return true }
            guard let inDid, let entryDid = entry.did?.lowercased() else { return false }
            return entryDid == inDid && SearchHistory.isActorLevelPath(key)
        }
        if let existing {
            var entry = next[existing]
            entry.label = label
            entry.sublabel = sublabel ?? entry.sublabel
            entry.avatar = avatar ?? entry.avatar
            entry.did = did ?? entry.did
            entry.handle = handle ?? entry.handle
            entry.count += 1
            entry.lastVisited = stamp
            next[existing] = entry
        } else {
            next.append(SearchHistoryEntry(path: path, label: label, sublabel: sublabel, avatar: avatar, did: did, handle: handle, count: 1, lastVisited: stamp))
        }
        // Keep the most recent entries so the key stays bounded.
        let sorted = SearchHistory.stableSorted(next) { $0.lastVisited > $1.lastVisited }
        write(Array(sorted.prefix(SearchHistory.maxEntries)))
    }

    /// Record a visit to an actor, e.g. a typeahead pick.
    public func recordActorVisit(did: String? = nil, handle rawHandle: String, displayName: String? = nil, avatar: String? = nil) {
        let handle = rawHandle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !handle.isEmpty else { return }
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        recordVisit(
            path: "/explore/\(encodeRepo(handle))",
            label: name.isEmpty ? handle : name,
            sublabel: "@\(handle)",
            avatar: avatar,
            did: did,
            handle: handle
        )
    }

    /// Record a free-text search whose resolved destination is known.
    public func recordQueryVisit(_ rawQuery: String, path: String) {
        recordVisit(path: path, label: rawQuery.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Patch an entry's display metadata in place (avatar backfill) without
    /// touching its count or recency. Matches the stored path exactly.
    /// Returns whether an entry was updated.
    @discardableResult
    public func enrich(path: String, patch: SearchHistoryPatch) -> Bool {
        guard let index = entries.firstIndex(where: { $0.path == path }) else { return false }
        var next = entries
        var entry = next[index]
        if let label = patch.label { entry.label = label }
        if let sublabel = patch.sublabel { entry.sublabel = sublabel }
        if let avatar = patch.avatar { entry.avatar = avatar }
        if let did = patch.did { entry.did = did }
        if let handle = patch.handle { entry.handle = handle }
        next[index] = entry
        write(next)
        return true
    }

    public func recents(limit: Int) -> [SearchHistoryEntry] {
        SearchHistory.recents(entries, limit: limit)
    }

    public func frequent(limit: Int) -> [SearchHistoryEntry] {
        SearchHistory.frequent(entries, limit: limit)
    }
}
