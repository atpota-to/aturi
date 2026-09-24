import Foundation
import Observation
import AturiCore

/// The Links tab's own history: the pages that resolved here, newest
/// first. Kept apart from `SearchHistoryStore` on purpose: that list holds
/// explorer paths ranked for the search box, and a pasted post link is not
/// a search. One instance serves the app; the input screen and the preview
/// screen both use it, and because it is observable the list on the input
/// screen updates as soon as a link resolves.
@MainActor
@Observable
final class RecentLinksStore {
    struct Entry: Codable, Hashable, Identifiable {
        /// What gets resolved again on tap: the aturi.to link of the page.
        var input: String
        /// "@alice.test" or a shortened DID.
        var label: String
        /// The record's collection, nil for a profile.
        var detail: String?
        var visitedAt: Date

        var id: String { input }
    }

    static let shared = RecentLinksStore()

    static let storageKey = "aturi.recentLinks.v1"
    static let maxEntries = 20

    private(set) var entries: [Entry] = []

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var loaded = false

    /* Nonisolated so the shared instance can be a static; nothing is read
       until `reload()` runs on the main actor. */
    nonisolated init(defaults: UserDefaults = PreferencesStore.appGroupDefaults()) {
        self.defaults = defaults
    }

    /// Re-read from storage. Also called on every appearance of the Links
    /// tab, since the preview screen writes through the same instance but
    /// another process (the share extension) may have written the key.
    func reload() {
        loaded = true
        guard let data = defaults.data(forKey: Self.storageKey),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data)
        else {
            entries = []
            return
        }
        entries = decoded
    }

    func record(input: String, label: String, detail: String? = nil) {
        if !loaded {
            reload()
        }
        var next = entries.filter { $0.input != input }
        next.insert(Entry(input: input, label: label, detail: detail, visitedAt: Date()), at: 0)
        if next.count > Self.maxEntries {
            next.removeLast(next.count - Self.maxEntries)
        }
        entries = next
        persist()
    }

    func remove(_ entry: Entry) {
        entries.removeAll { $0.id == entry.id }
        persist()
    }

    func clear() {
        entries = []
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}
