import Foundation
import Observation

// MARK: - Collection grouping

/// Two-level hierarchical grouping of a repo's collection NSIDs, the port of
/// `src/components/explore/tabs/collectionGrouping.ts`, plus the pinned
/// partition that `CollectionsTab.tsx` layers on top of it. Pure functions;
/// `RepoModel` composes them with the live state.
public enum CollectionGrouping {
    public struct SubGroup: Hashable, Sendable {
        /// 3rd NSID segment, e.g. "feed", "graph", "actor".
        public var key: String
        /// Composite key used as a stable identity and collapsed-state id.
        public var fullKey: String
        public var items: [String]

        public init(key: String, fullKey: String, items: [String]) {
            self.key = key
            self.fullKey = fullKey
            self.items = items
        }
    }

    public struct MajorGroup: Hashable, Sendable {
        /// First two NSID segments, e.g. "app.bsky", "is.dame".
        public var key: String
        /// 3-segment NSIDs that live directly under the major group (no sub),
        /// plus any sub-group that held a single item.
        public var directItems: [String]
        /// 4+ segment NSIDs grouped by their 3rd segment.
        public var subgroups: [SubGroup]
        /// Total leaf NSIDs across direct + all sub-groups.
        public var totalCount: Int

        public init(key: String, directItems: [String], subgroups: [SubGroup], totalCount: Int) {
            self.key = key
            self.directItems = directItems
            self.subgroups = subgroups
            self.totalCount = totalCount
        }
    }

    /// The first two NSID segments (the reverse-domain root), or the whole
    /// string when there are fewer. Shared by the grouping and by the
    /// "Namespaces" stat so the two counts agree.
    public static func majorKey(_ nsid: String) -> String {
        let segs = nsid.split(separator: ".", omittingEmptySubsequences: false)
        return segs.count >= 2 ? "\(segs[0]).\(segs[1])" : nsid
    }

    /// Distinct major keys, the "Namespaces" tile of the repo stats.
    public static func namespaceCount(_ collections: [String]) -> Int {
        Set(collections.map(majorKey)).count
    }

    /// Two-level hierarchical grouping.
    ///
    ///     app.bsky.feed.post      -> major app.bsky, sub feed, leaf
    ///     app.bsky.actor.profile  -> major app.bsky, sub actor, leaf
    ///     is.dame.now             -> major is.dame, no sub, direct leaf
    ///
    /// NSIDs with fewer than four segments have no third segment to sub-group
    /// by, so they sit under the major group as direct leaves above the
    /// sub-groups. A sub-group with a single item is hoisted into the direct
    /// list: a collapsible group holding one row is wrapper noise.
    ///
    /// Keys are ordered by plain string comparison where the web uses
    /// `localeCompare`; the two agree on the lowercase reverse-domain names
    /// NSIDs are made of.
    public static func groupHierarchically(_ list: [String], filter: String) -> [MajorGroup] {
        let needle = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = needle.isEmpty ? list : list.filter { $0.lowercased().contains(needle) }

        struct Bucket {
            var direct: [String] = []
            var subOrder: [String] = []
            var subs: [String: [String]] = [:]
        }
        var majorOrder: [String] = []
        var majors: [String: Bucket] = [:]
        for nsid in filtered {
            let segs = nsid.split(separator: ".", omittingEmptySubsequences: false)
            let major = majorKey(nsid)
            if majors[major] == nil {
                majors[major] = Bucket()
                majorOrder.append(major)
            }
            if segs.count >= 4 {
                let subKey = String(segs[2])
                if majors[major]!.subs[subKey] == nil {
                    majors[major]!.subs[subKey] = []
                    majors[major]!.subOrder.append(subKey)
                }
                majors[major]!.subs[subKey]!.append(nsid)
            } else {
                majors[major]!.direct.append(nsid)
            }
        }

        return majorOrder.sorted().map { major in
            let bucket = majors[major]!
            var hoisted = bucket.direct
            var subgroups: [SubGroup] = []
            for subKey in bucket.subOrder {
                let items = bucket.subs[subKey]!
                if items.count == 1 {
                    hoisted.append(items[0])
                } else {
                    subgroups.append(SubGroup(key: subKey, fullKey: "\(major).\(subKey)", items: items.sorted()))
                }
            }
            subgroups.sort { $0.key < $1.key }
            let total = hoisted.count + subgroups.reduce(0) { $0 + $1.items.count }
            return MajorGroup(key: major, directItems: hoisted.sorted(), subgroups: subgroups, totalCount: total)
        }
    }

    /// Open-state key for a pinned group block, namespaced so it cannot
    /// collide with a main-list group key of the same prefix.
    public static func pinnedKey(_ entry: String) -> String {
        "pinned:\(entry)"
    }

    /// A pinned NSID group (`prefix.*`) with the collections it surfaces on
    /// this repo.
    public struct PinnedGroup: Hashable, Sendable {
        /// The pin entry as stored, e.g. `app.bsky.feed.*`.
        public var entry: String
        public var prefix: String
        public var items: [String]

        public init(entry: String, prefix: String, items: [String]) {
            self.entry = entry
            self.prefix = prefix
            self.items = items
        }
    }

    /// What the Pinned section shows: group pins first (in pin-list order),
    /// then individually pinned NSIDs. The main grouped list drops
    /// everything in `surfaced` so no collection renders twice.
    public struct PinnedPartition: Hashable, Sendable {
        public var groups: [PinnedGroup]
        public var singles: [String]

        public static let empty = PinnedPartition(groups: [], singles: [])

        public init(groups: [PinnedGroup], singles: [String]) {
            self.groups = groups
            self.singles = singles
        }

        public var surfaced: Set<String> {
            var set = Set(singles)
            for group in groups {
                set.formUnion(group.items)
            }
            return set
        }

        public var count: Int {
            singles.count + groups.reduce(0) { $0 + $1.items.count }
        }

        public var isEmpty: Bool {
            groups.isEmpty && singles.isEmpty
        }
    }

    /// The pinned partition of `CollectionsTab.tsx`: group pins subsumed by
    /// a broader one (`app.bsky.feed.*` beside `app.bsky.*`) are dropped so
    /// members never render twice, groups with no match on this repo are
    /// dropped, and a single pin already covered by a group pin is left to
    /// the group. The filter applies to both.
    public static func pinnedPartition(collections: [String], pinList: [String], filter: String) -> PinnedPartition {
        let needle = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matchesFilter: (String) -> Bool = { needle.isEmpty || $0.lowercased().contains(needle) }
        let repoSet = Set(collections)

        let prefixes = pinList.filter(PinnedLexicons.isGroup).map(PinnedLexicons.groupPrefix)
        let groups = prefixes
            .filter { prefix in !prefixes.contains { other in other != prefix && prefix.hasPrefix("\(other).") } }
            .map { prefix -> PinnedGroup in
                let entry = prefix + PinnedLexicons.groupSuffix
                let items = collections
                    .filter { PinnedLexicons.matches(entry: entry, nsid: $0) }
                    .filter(matchesFilter)
                    .sorted()
                return PinnedGroup(entry: entry, prefix: prefix, items: items)
            }
            .filter { !$0.items.isEmpty }

        let singles = pinList
            .filter { !PinnedLexicons.isGroup($0) }
            .filter { repoSet.contains($0) }
            .filter { !PinnedLexicons.covered(by: pinList, nsid: $0) }
            .filter(matchesFilter)

        return PinnedPartition(groups: groups, singles: singles)
    }
}

/// Cross-repo narrowing of the Lexicons tab, meaningful only when signed in
/// and viewing someone else's repo: everything, only NSIDs the viewer also
/// has, or only NSIDs the viewer does not have yet.
public enum CollectionCommonFilter: String, CaseIterable, Hashable, Sendable {
    case all
    case mutual
    case notMine

    /// The segmented control's label.
    public var label: String {
        switch self {
        case .all: return "all"
        case .mutual: return "in common"
        case .notMine: return "i don't have"
        }
    }
}

// MARK: - Error text

/// The message an explorer screen prints for a failed read. Mirrors the
/// string the web's `fetchJson` throws (status, URL and the first 200
/// characters of the body, so a `RepoTakendown` body stays visible) and
/// names the package's own pre-request errors the way the TypeScript did.
public enum ExploreErrorText {
    public static func describe(_ error: Error) -> String {
        if let http = error as? HTTPError {
            return "HTTP \(http.status) for \(http.url.absoluteString) :: \(http.body.prefix(200))"
        }
        if let failure = error as? HTTPFailure {
            switch failure {
            case .tooLarge(let bytes): return "Response too large (\(bytes) bytes)"
            case .invalidResponse: return "Invalid response"
            case .redirectRefused(let url): return "Refused a redirect to \(url.host ?? url.absoluteString)"
            }
        }
        if let identity = error as? IdentityResolverError {
            switch identity {
            case .emptyInput: return "resolveIdentifier: empty input"
            case .unresolvable(let input): return "Could not resolve \(input)"
            case .unsupportedDIDMethod(let method): return "Unsupported DID method: \(method)"
            case .invalidDIDWeb(let did): return "Not a valid did:web: \(did)"
            }
        }
        if let pds = error as? PDSClientError, case .invalidBase(let base) = pds {
            return "Not a valid PDS host: \(base)"
        }
        if error is PLCClientError {
            return "missing did"
        }
        if error is CancellationError {
            return "Cancelled"
        }
        return error.localizedDescription
    }
}

// MARK: - Derived value types

/// The head commit rev and where it came from. A rev from the account's own
/// PDS is its head commit; a rev from a relay (the only source once a repo
/// goes inactive) is the newest one that relay holds, which reads as the
/// last write but is not the PDS saying so.
public struct RepoHeadRev: Hashable, Sendable {
    public var rev: String
    public var fromRelay: Bool

    public init(rev: String, fromRelay: Bool) {
        self.rev = rev
        self.fromRelay = fromRelay
    }

    public var date: Date? { TID.date(from: rev) }
}

/// The "Repo at a glance" numbers, port of `Stats` in `AccountStats.tsx`.
/// Both repo counts are nil when the repo will not serve reads: zero is a
/// real answer (a repo with no records) and reporting it for a repo nobody
/// is allowed to read would state as fact something never learned.
public struct RepoStats: Hashable, Sendable {
    /// Unique 2-segment NSID prefixes (e.g. "net.anisota").
    public var namespaces: Int?
    /// Total distinct NSIDs / record types.
    public var collections: Int?
    /// PLC operations count; nil for non-did:plc and when the log failed.
    public var auditOps: Int?
    /// Earliest PLC operation timestamp.
    public var createdAt: String?
    /// Inbound atproto references via Constellation; nil when unreachable.
    public var backlinks: Int?
    public var headRev: String?
    public var headRevFromRelay: Bool
    /// Hosting status ('takendown', 'deactivated', ...) when the repo is inactive.
    public var inactive: String?

    public init(
        namespaces: Int? = nil,
        collections: Int? = nil,
        auditOps: Int? = nil,
        createdAt: String? = nil,
        backlinks: Int? = nil,
        headRev: String? = nil,
        headRevFromRelay: Bool = false,
        inactive: String? = nil
    ) {
        self.namespaces = namespaces
        self.collections = collections
        self.auditOps = auditOps
        self.createdAt = createdAt
        self.backlinks = backlinks
        self.headRev = headRev
        self.headRevFromRelay = headRevFromRelay
        self.inactive = inactive
    }

    public var createdDate: Date? { createdAt.flatMap(Formatting.isoDate) }

    /// The head rev decoded into the account's last-active time.
    public var lastActiveDate: Date? { headRev.flatMap(TID.date(from:)) }

    /// Tooltip for the "Last active" tile, hedged when the rev came from a
    /// relay rather than the account's own PDS.
    public var lastActiveHint: String {
        guard let date = lastActiveDate else {
            if let inactive {
                return "No rev available: this repo is \(inactive)"
            }
            return "Timestamp of the repo's most recent commit (head rev)"
        }
        if headRevFromRelay {
            return "Newest rev the relay holds for this repo · \(Formatting.isoTimestamp(date))"
        }
        return "Repo's most recent commit · \(Formatting.isoTimestamp(date))"
    }

    /// One coarse phrase for the age of the earliest PLC operation ("3 years
    /// old", "2 months old", "12 days old"). Port of `relativeAge`.
    public func createdRelativeAge(now: Date = Date()) -> String? {
        guard let created = createdDate else { return nil }
        let seconds = now.timeIntervalSince(created)
        if seconds < 0 { return "in the future" }
        let days = Int((seconds / 86_400).rounded(.down))
        if days < 1 { return "today" }
        if days == 1 { return "1 day old" }
        if days < 30 { return "\(days) days old" }
        let months = days / 30
        if months < 12 { return "\(months) month\(months == 1 ? "" : "s") old" }
        let years = days / 365
        let remainingMonths = (days - years * 365) / 30
        if remainingMonths > 0 {
            return "\(years) yr \(remainingMonths) mo old"
        }
        return "\(years) year\(years == 1 ? "" : "s") old"
    }
}

/// The banner copy for a repo whose host will not serve reads, port of
/// `STATUS_COPY` in `RepoStatusNotice.tsx`. Deliberately says nothing about
/// why an account is in one of these states: the protocol does not carry a
/// reason, so neither does the explorer.
public struct RepoStatusNotice: Hashable, Sendable {
    /// `status` from the PDS, or "inactive" when it sent none.
    public var status: String
    public var headline: String
    public var detail: String

    /// The paragraph every state shares: a dead repo is not a dead identity.
    public static let reassurance =
        "Its identity is untouched. The DID document, the PLC audit log and every record elsewhere in the Atmosphere that points at this DID live outside the PDS, so the ID, LOG and BACKLINKS tabs below all still work."

    public init(status: String?) {
        let status = status.flatMap { $0.isEmpty ? nil : $0 } ?? "inactive"
        self.status = status
        switch status {
        case "takendown":
            headline = "This repo has been taken down."
            detail = "Its host refuses every record read. A takedown is the host’s own action and carries no public reason with it."
        case "suspended":
            headline = "This repo is suspended."
            detail = "Its host refuses every record read. The status is all the PDS reports — there is no duration or reason attached to it."
        case "deactivated":
            headline = "This account is deactivated."
            detail = "Deactivation is usually the account holder’s own switch: it is how you step away from a host, and how a repo looks part-way through migrating between two. Records return if it is reactivated."
        case "deleted":
            headline = "This repo has been deleted."
            detail = "Its host reports the repo gone, so there are no records left to read from it."
        default:
            headline = "This repo is marked \(status)."
            detail = "Its host refuses record reads while the repo is in this state."
        }
    }

    public var accessibilityLabel: String { "Repo status: \(status)" }
}

/// The three facts under the status banner, port of `StatusFacts`: what the
/// host said, whether the handle still points here, and when the repo was
/// last written to. Only the status arrives with the page; the other two
/// each cost a request to somebody else and fill in behind it, so each
/// carries a `checked` flag that separates "still looking" from "nothing".
public struct RepoStatusFacts: Hashable, Sendable {
    public var status: String
    /// Bare hostname of the PDS that answered, so the status has an author.
    public var hostname: String
    public var handle: String?
    public var revChecked: Bool
    public var rev: String?
    public var handleChecked: Bool
    /// True when the handle still resolves to this DID, false when it now
    /// resolves elsewhere, nil when the lookup gave no answer.
    public var handleVerified: Bool?

    public init(
        status: String,
        hostname: String,
        handle: String?,
        revChecked: Bool = false,
        rev: String? = nil,
        handleChecked: Bool = false,
        handleVerified: Bool? = nil
    ) {
        self.status = status
        self.hostname = hostname
        self.handle = handle
        self.revChecked = revChecked
        self.rev = rev
        self.handleChecked = handleChecked
        self.handleVerified = handleVerified
    }

    public var revDate: Date? { rev.flatMap(TID.date(from:)) }
    public var handleLabel: String { handle.map { "@\($0)" } ?? "—" }
    public var revLabel: String { rev ?? "—" }

    public var handleNote: String {
        guard handle != nil else { return "no at:// entry in the DID document" }
        guard handleChecked else { return "checking…" }
        switch handleVerified {
        case .some(true): return "still resolves to this DID"
        case .some(false): return "now resolves to a different DID"
        case .none: return "claimed in the DID document, could not be verified"
        }
    }

    /// Hedged on purpose: this is the newest rev a relay holds for the repo,
    /// which reads as the account's last write, but nothing here confirmed
    /// that a relay leaves it alone when an account event arrives.
    public func revNote(now: Date = Date()) -> String {
        guard revChecked else { return "checking…" }
        if let date = revDate {
            return "last rev seen by the relay · \(TID.formatRelative(date, now: now))"
        }
        return "no rev available"
    }
}

/// Extension fields read straight from the `app.bsky.actor.profile` record
/// on the PDS, which do not round-trip through the AppView.
public struct ProfileRecordExtras: Hashable, Sendable {
    public var website: String?
    public var pronouns: String?

    public init(website: String? = nil, pronouns: String? = nil) {
        self.website = website
        self.pronouns = pronouns
    }

    /// Only string-typed fields count, as `typeof v.website === 'string'` did.
    public init(recordValue: JSONValue?) {
        website = recordValue?["website"]?.stringValue
        pronouns = recordValue?["pronouns"]?.stringValue
    }
}

/// What the profile card at the top of the repo page shows, port of the
/// derivations in `ProfileHeader.tsx`: the AppView profile merged with the
/// PDS record's extras, and the website the handle doubles as.
public struct RepoProfileHeader: Hashable, Sendable {
    public var profile: BskyProfile
    public var displayName: String?
    public var description: String?
    public var pronouns: String?
    /// The explicit `website` field of the profile record, trimmed.
    public var website: String?
    public var handle: String?
    /// Where the handle links: the profile's website, else `https://<handle>`
    /// when the handle looks like a domain.
    public var websiteHref: String?
    public var websiteLabel: String?
    /// Path of the universal link page for this profile.
    public var universalLinkPath: String

    public init(profile: BskyProfile, identity: IdentityBundle, extras: ProfileRecordExtras = ProfileRecordExtras()) {
        self.profile = profile
        displayName = Self.nonBlank(profile.displayName)
        description = Self.nonBlank(profile.description)
        pronouns = Self.nonBlank(profile.pronouns) ?? Self.nonBlank(extras.pronouns)
        website = Self.nonBlank(extras.website)
        handle = identity.handle ?? Self.nonBlank(profile.handle)
        // Prefer the explicit website; otherwise many self-hosted handles
        // (dame.is, anisota.net) are their own website and never fill in the
        // separate field.
        websiteHref = Self.normalizeUrl(website) ?? Self.handleAsWebsite(handle)
        websiteLabel = websiteHref.map(Self.prettyHostname)
        universalLinkPath = "/profile/\(handle ?? identity.did)"
    }

    public var hasStats: Bool {
        profile.followersCount != nil || profile.followsCount != nil || profile.postsCount != nil
    }

    /// Nothing interesting to show: the signal that this DID is not a
    /// Bluesky-style account, so the card is skipped and the identity row
    /// below covers it.
    public var isEmpty: Bool {
        displayName == nil && description == nil && profile.avatar == nil && pronouns == nil && website == nil
    }

    private static func nonBlank(_ s: String?) -> String? {
        guard let trimmed = s?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// Normalize a user-supplied URL. Accepts `example.com`,
    /// `https://example.com`, `//example.com`. Rejects javascript:, data:,
    /// mailto: and anything that is not a URL. Output is the `new URL(...)`
    /// spelling: lowercase scheme and host, a `/` path when there was none.
    public static func normalizeUrl(_ input: String?) -> String? {
        guard let trimmed = input?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        let lower = trimmed.lowercased()
        let candidate: String
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            candidate = trimmed
        } else {
            candidate = "https://" + trimmed.drop(while: { $0 == "/" })
        }
        guard var components = URLComponents(string: candidate),
            let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
            let host = components.host, !host.isEmpty
        else { return nil }
        components.scheme = scheme
        components.host = host.lowercased()
        if components.path.isEmpty {
            components.path = "/"
        }
        return components.string
    }

    /// `hostname + pathname` without a trailing slash; the href itself when
    /// it does not parse.
    public static func prettyHostname(_ href: String) -> String {
        guard let components = URLComponents(string: href), let host = components.host else { return href }
        var text = host + components.path
        if text.hasSuffix("/") {
            text.removeLast()
        }
        return text
    }

    /// Treat the handle as a potential website when it parses as a domain.
    /// Filters out nil, DIDs and bare strings without a dot; everything else
    /// tries `https://<handle>` and must round-trip as the hostname, which
    /// guards against characters that are not valid in one.
    public static func handleAsWebsite(_ handle: String?) -> String? {
        guard let handle, !handle.isEmpty, !handle.hasPrefix("did:"), handle.contains(".") else { return nil }
        guard let components = URLComponents(string: "https://\(handle)"),
            components.scheme == "https",
            let host = components.host, !host.isEmpty,
            host.lowercased() == handle.lowercased()
        else { return nil }
        return "https://\(host.lowercased())/"
    }
}

/// One PLC audit entry as the Log tab lists it: newest first, with the
/// human-readable diff against the chronologically previous operation.
public struct RepoAuditEntry: Hashable, Sendable, Identifiable {
    public var id: String
    public var entry: PlcAuditEntry
    /// The operation type, or "create" / "update" inferred from `prev`
    /// for legacy entries that carry none.
    public var type: String
    public var changes: [String]

    public init(id: String, entry: PlcAuditEntry, type: String, changes: [String]) {
        self.id = id
        self.entry = entry
        self.type = type
        self.changes = changes
    }

    /// The `AuditTab` list: reverse chronological, each entry diffed against
    /// the one before it in time.
    public static func list(from log: [PlcAuditEntry]) -> [RepoAuditEntry] {
        log.reversed().enumerated().map { index, entry in
            let previous = log.count - index - 2 >= 0 ? log[log.count - index - 2] : nil
            let operation = entry.operation
            let type = operation.type ?? (operation.prev == nil ? "create" : "update")
            let id = entry.cid.flatMap { $0.isEmpty ? nil : $0 } ?? "\(entry.createdAt)-\(index)"
            return RepoAuditEntry(
                id: id,
                entry: entry,
                type: type,
                changes: PLCClient.diffOps(prev: previous?.operation, next: operation)
            )
        }
    }
}

// MARK: - Model

/// The repo page: identity, profile card, "at a glance" stats, the status
/// banner for an inactive repo, and the four tabs (Lexicons, ID, Log,
/// Backlinks). Port of the state in `RepoExplorer.tsx`, `ProfileHeader.tsx`,
/// `AccountStats.tsx`, `RepoStatusNotice.tsx`, `CollectionsTab.tsx`,
/// `IdentityTab.tsx` and `AuditTab.tsx`.
///
/// Identity resolves first; everything else fans out from the bundle and
/// degrades independently, one failure never blocking another. `load()`
/// cancels whatever a previous load still had in flight.
@MainActor
@Observable
public final class RepoModel {
    /// The identifier the screen was opened with: a handle, a DID or an
    /// `at://` URI.
    public let input: String

    public private(set) var identity: Loadable<IdentityBundle> = .idle
    /// Nil inside `.loaded` when the AppView knows no profile for the DID.
    public private(set) var profile: Loadable<RepoProfileHeader?> = .idle
    /// Sorted collection NSIDs from describeRepo.
    public private(set) var collections: Loadable<[String]> = .idle
    /// Nil inside `.loaded` when neither the PDS nor a relay had a rev.
    public private(set) var headRev: Loadable<RepoHeadRev?> = .idle
    /// Nil inside `.loaded` for a DID that is not did:plc.
    public private(set) var plcDocument: Loadable<PlcDocument?> = .idle
    /// Empty for a DID that is not did:plc; see `isPlc`.
    public private(set) var auditLog: Loadable<[RepoAuditEntry]> = .idle
    /// `.failed` when Constellation was unreachable; an empty array means
    /// nothing links here.
    public private(set) var backlinkSources: Loadable<[BacklinkSource]> = .idle
    /// Nil inside `.loaded` when cred.blue has not scored the account.
    public private(set) var credBlue: Loadable<CredBlueScore?> = .idle
    /// Present only for an inactive repo.
    public private(set) var statusFacts: RepoStatusFacts?
    /// The signed-in viewer's own collection set, for the "in common"
    /// filter. Nil while signed out, on the viewer's own repo, or until the
    /// lookup lands.
    public private(set) var viewerCollections: Set<String>?
    /// The signed-in DID, if any. Drives own-repo detection, the pin scope
    /// and the cross-repo filter.
    public private(set) var viewerDid: String?

    /// Lexicon filter text.
    public var filter = ""
    public var commonFilter: CollectionCommonFilter = .all
    /// Per-group open-state overrides keyed by group key; a missing key
    /// falls back to the `collectionGroupsCollapsedByDefault` preference.
    public private(set) var openOverrides: [String: Bool] = [:]

    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let pds: PDSClient
    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let plc: PLCClient
    @ObservationIgnored private let constellation: ConstellationClient
    @ObservationIgnored private let credBlueClient: CredBlueClient
    @ObservationIgnored private let preferences: PreferencesStore?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var viewerTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    /// `http` feeds every client; the shared resolver and PLC client keep
    /// their caches only when the shared HTTP client is in use, so a test
    /// with a fake transport never sees another test's cache.
    public init(
        input: String,
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        plc: PLCClient? = nil,
        preferences: PreferencesStore? = nil,
        viewerDid: String? = nil
    ) {
        self.input = input
        let usesShared = http === HTTPClient.shared
        self.resolver = resolver ?? (usesShared ? .shared : IdentityResolver(http: http))
        self.plc = plc ?? (usesShared ? .shared : PLCClient(http: http))
        pds = PDSClient(http: http)
        appView = AppViewClient(client: http)
        constellation = ConstellationClient(http: http)
        credBlueClient = CredBlueClient(http: http)
        self.preferences = preferences
        self.viewerDid = viewerDid
    }

    // MARK: Loading

    /// Resolve the identifier and fan out every read. The returned task
    /// finishes when all of them have settled (or were cancelled).
    @discardableResult
    public func load() -> Task<Void, Never> {
        cancel()
        generation += 1
        let gen = generation
        identity = .loading
        profile = .idle
        collections = .idle
        headRev = .idle
        plcDocument = .idle
        auditLog = .idle
        backlinkSources = .idle
        credBlue = .idle
        statusFacts = nil
        viewerCollections = nil
        openOverrides = [:]
        let task = Task { [weak self] in
            _ = await self?.run(generation: gen)
        }
        loadTask = task
        return task
    }

    /// Stop every in-flight read. State keeps whatever had landed.
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        viewerTask?.cancel()
        viewerTask = nil
    }

    /// Set (or clear) the signed-in DID. Refetches the viewer's collection
    /// set when the repo is someone else's.
    @discardableResult
    public func setViewer(did: String?) -> Task<Void, Never>? {
        viewerDid = did
        viewerTask?.cancel()
        viewerTask = nil
        viewerCollections = nil
        commonFilter = .all
        guard let bundle = identity.value else { return nil }
        return startViewerLookup(bundle)
    }

    private func run(generation gen: Int) async {
        let bundle: IdentityBundle
        do {
            bundle = try await resolver.resolveIdentifier(input)
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            identity = .failed(ExploreErrorText.describe(error))
            return
        }
        guard gen == generation, !Task.isCancelled else { return }
        identity = .loaded(bundle)
        profile = .loading
        collections = .loading
        headRev = .loading
        plcDocument = .loading
        auditLog = .loading
        backlinkSources = .loading
        credBlue = .loading
        if let status = bundle.repoStatus {
            statusFacts = RepoStatusFacts(
                status: RepoStatusNotice(status: status.status).status,
                hostname: Self.hostname(of: bundle.pds),
                handle: bundle.handle
            )
        }
        startViewerLookup(bundle)

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadProfile(bundle, gen) }
            group.addTask { await self.loadCollections(bundle, gen) }
            group.addTask { await self.loadHeadRev(bundle, gen) }
            group.addTask { await self.loadPlc(bundle, gen) }
            group.addTask { await self.loadBacklinks(bundle, gen) }
            group.addTask { await self.loadCredBlue(bundle, gen) }
            if bundle.repoStatus != nil {
                group.addTask { await self.verifyStatusHandle(bundle, gen) }
            }
        }
    }

    /// The two halves of the profile card, fetched side by side.
    private enum ProfilePiece: Sendable {
        case appView(BskyProfile?)
        case record(AtRecord?)
    }

    private func loadProfile(_ bundle: IdentityBundle, _ gen: Int) async {
        let appView = appView
        let pds = pds
        var fetchedProfile: BskyProfile?
        var fetchedRecord: AtRecord?
        // A task group rather than `async let`: the pair is awaited as a
        // whole either way, and the group keeps the runtime's task
        // allocator happy when one branch fails fast.
        await withTaskGroup(of: ProfilePiece.self) { group in
            group.addTask { .appView(await appView.getProfile(bundle.did)) }
            // The raw record surfaces extension fields like `website`; an
            // account with no profile record simply yields no extras.
            group.addTask {
                .record(try? await pds.getRecord(
                    pds: bundle.pds, repo: bundle.did, collection: "app.bsky.actor.profile", rkey: "self"
                ))
            }
            for await piece in group {
                switch piece {
                case .appView(let value): fetchedProfile = value
                case .record(let value): fetchedRecord = value
                }
            }
        }
        guard gen == generation, !Task.isCancelled else { return }
        let extras = ProfileRecordExtras(recordValue: fetchedRecord?.value)
        profile = .loaded(fetchedProfile.map { RepoProfileHeader(profile: $0, identity: bundle, extras: extras) })
    }

    private func loadCollections(_ bundle: IdentityBundle, _ gen: Int) async {
        do {
            let description = try await pds.describeRepo(pds: bundle.pds, repo: bundle.did)
            guard gen == generation, !Task.isCancelled else { return }
            collections = .loaded(description.collections.sorted())
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            collections = .failed(ExploreErrorText.describe(error))
        }
    }

    /// getLatestCommit is one of the reads an inactive repo refuses, so for
    /// those the head rev comes from a relay instead.
    private func loadHeadRev(_ bundle: IdentityBundle, _ gen: Int) async {
        if bundle.repoStatus != nil {
            let rev = await resolver.inactiveRepoRev(bundle.did)
            guard gen == generation, !Task.isCancelled else { return }
            headRev = .loaded(rev.map { RepoHeadRev(rev: $0, fromRelay: true) })
            statusFacts?.rev = rev
            statusFacts?.revChecked = true
            return
        }
        let commit = try? await pds.getLatestCommit(pds: bundle.pds, did: bundle.did)
        guard gen == generation, !Task.isCancelled else { return }
        let rev = commit?.rev.isEmpty == false ? commit?.rev : nil
        headRev = .loaded(rev.map { RepoHeadRev(rev: $0, fromRelay: false) })
    }

    private func loadPlc(_ bundle: IdentityBundle, _ gen: Int) async {
        guard bundle.did.hasPrefix("did:plc:") else {
            plcDocument = .loaded(nil)
            auditLog = .loaded([])
            return
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadPlcDocument(bundle.did, gen) }
            group.addTask { await self.loadAuditLog(bundle.did, gen) }
        }
    }

    private func loadPlcDocument(_ did: String, _ gen: Int) async {
        do {
            let document = try await plc.document(did: did)
            guard gen == generation, !Task.isCancelled else { return }
            plcDocument = .loaded(document)
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            plcDocument = .failed(ExploreErrorText.describe(error))
        }
    }

    private func loadAuditLog(_ did: String, _ gen: Int) async {
        do {
            let log = try await plc.auditLog(did: did)
            guard gen == generation, !Task.isCancelled else { return }
            auditLog = .loaded(RepoAuditEntry.list(from: log))
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            auditLog = .failed(ExploreErrorText.describe(error))
        }
    }

    private func loadBacklinks(_ bundle: IdentityBundle, _ gen: Int) async {
        let sources = await constellation.sources(for: bundle.did)
        guard gen == generation, !Task.isCancelled else { return }
        if let sources {
            backlinkSources = .loaded(sources)
        } else {
            backlinkSources = .failed("Backlinks unavailable (constellation).")
        }
    }

    private func loadCredBlue(_ bundle: IdentityBundle, _ gen: Int) async {
        let score = await credBlueClient.fetchCachedScore(bundle.handle ?? bundle.did)
        guard gen == generation, !Task.isCancelled else { return }
        credBlue = .loaded(score)
    }

    /// A takedown leaves DNS, the DID document and the PLC directory alone,
    /// so a handle often keeps resolving long after the repo stops
    /// answering. It can also have been picked up by somebody else, which
    /// is the case worth flagging.
    private func verifyStatusHandle(_ bundle: IdentityBundle, _ gen: Int) async {
        guard let handle = bundle.handle else {
            statusFacts?.handleChecked = true
            statusFacts?.handleVerified = nil
            return
        }
        let resolved = await resolver.resolveHandle(handle)
        guard gen == generation, !Task.isCancelled else { return }
        statusFacts?.handleChecked = true
        statusFacts?.handleVerified = resolved.map { $0 == bundle.did }
    }

    /// The viewer's collection set, skipped when signed out or on the
    /// viewer's own repo (100% mutual by definition). Failures leave it nil
    /// so the filter control simply stays hidden.
    @discardableResult
    private func startViewerLookup(_ bundle: IdentityBundle) -> Task<Void, Never>? {
        guard let viewerDid, viewerDid != bundle.did else { return nil }
        let gen = generation
        let task = Task { [weak self] in
            guard let self else { return }
            let list = await self.resolver.fetchRepoCollections(viewerDid)
            guard gen == self.generation, !Task.isCancelled, self.viewerDid == viewerDid else { return }
            self.viewerCollections = list.map(Set.init)
        }
        viewerTask = task
        return task
    }

    private static func hostname(of pds: String) -> String {
        guard let host = URLComponents(string: pds)?.host, !host.isEmpty else { return pds }
        return host
    }

    // MARK: Identity row

    public var isPlc: Bool { identity.value?.did.hasPrefix("did:plc:") ?? false }
    public var did: String? { identity.value?.did }
    public var handle: String? { identity.value?.handle }
    public var pdsHost: String? { identity.value.map { PDSServer.pdsHostname($0.pds) } }
    /// Universal link for the profile.
    public var sharePath: String? { identity.value.map { "/profile/\($0.handle ?? $0.did)" } }
    /// The `/explore/...` path segment for this repo.
    public var repoSegment: String? { identity.value.map { encodeRepo($0.handle ?? $0.did) } }

    /// The not-found panel body when the identifier did not resolve.
    public var notFoundMessage: String? {
        identity.errorMessage.map {
            "We tried to resolve \"\(input)\" and the AT Protocol resolver returned: \($0). Try a handle, DID, or AT URI below."
        }
    }

    /// The banner for an inactive repo; nil in the ordinary case.
    public var statusNotice: RepoStatusNotice? {
        identity.value?.repoStatus.map { RepoStatusNotice(status: $0.status) }
    }

    /// The copy the ID and Log tabs show for a DID that is not did:plc.
    public var plcUnavailableMessage: String? {
        guard let did, !isPlc else { return nil }
        return "\(did) isn’t a did:plc:. PLC directory data isn’t available for this method."
    }

    /// cred.blue's page for the account, the badge's outbound link.
    public var credBlueProfileURL: URL? {
        identity.value.map { CredBlueClient.profileURL(for: $0.handle ?? $0.did) }
    }

    // MARK: Stats

    /// The "Repo at a glance" numbers, once every input has settled; nil
    /// while any is still loading.
    public var stats: RepoStats? {
        guard let bundle = identity.value else { return nil }
        guard collections.isSettled, auditLog.isSettled, backlinkSources.isSettled, headRev.isSettled else { return nil }
        let unreadable = bundle.repoStatus != nil
        let list = collections.value ?? []
        let audit = isPlc ? auditLog.value : nil
        let head = headRev.value ?? nil
        return RepoStats(
            namespaces: unreadable ? nil : CollectionGrouping.namespaceCount(list),
            collections: unreadable ? nil : list.count,
            auditOps: audit?.count,
            createdAt: audit?.last?.entry.createdAt,
            backlinks: backlinkSources.value.map { $0.reduce(0) { $0 + $1.count } },
            headRev: head?.rev,
            headRevFromRelay: head?.fromRelay ?? false,
            inactive: bundle.repoStatus?.status
        )
    }

    // MARK: Lexicons tab

    private var prefs: Preferences { preferences?.prefs ?? .defaults }

    public var isSignedIn: Bool { viewerDid != nil }

    /// Meaningless when signed out: there is no logged-in DID to compare.
    public var isOwnRepo: Bool {
        guard let viewerDid, let did = identity.value?.did else { return false }
        return viewerDid == did
    }

    /// Signed-out users have no "mine vs others" distinction, so pins always
    /// target the primary list; signed in, the scope picker decides.
    public var pinTarget: PinTarget {
        isSignedIn ? PinnedLexicons.target(scope: prefs.pinScope, isOwnRepo: isOwnRepo) : .mine
    }

    /// Which list backs the Pinned section on this repo.
    public var activePinList: [String] {
        if isSignedIn, prefs.pinScope == .split, !isOwnRepo {
            return prefs.pinnedLexiconsOthers
        }
        return prefs.pinnedLexicons
    }

    /// Whether the Pinned section bubbles up on this repo. Signed out,
    /// every repo shows pins: `own` scope would otherwise hide them
    /// everywhere since there is no own repo to be on.
    public var pinsVisibleHere: Bool {
        !isSignedIn || prefs.pinScope == .all || isOwnRepo || prefs.pinScope == .split
    }

    public var pinned: CollectionGrouping.PinnedPartition {
        guard pinsVisibleHere, let list = collections.value else { return .empty }
        return CollectionGrouping.pinnedPartition(collections: list, pinList: activePinList, filter: filter)
    }

    /// Collections the main grouped list is built from: everything the
    /// Pinned section surfaces is dropped, then the cross-repo filter applies.
    public var groupSource: [String] {
        guard let list = collections.value else { return [] }
        let surfaced = pinned.surfaced
        var source = surfaced.isEmpty ? list : list.filter { !surfaced.contains($0) }
        if commonFilter != .all, let mine = viewerCollections {
            source = source.filter { commonFilter == .mutual ? mine.contains($0) : !mine.contains($0) }
        }
        return source
    }

    public var groups: [CollectionGrouping.MajorGroup] {
        CollectionGrouping.groupHierarchically(groupSource, filter: filter)
    }

    /// The cross-repo filter only makes sense when signed in and viewing
    /// someone else's repo with the viewer's set in hand.
    public var showCommonFilter: Bool {
        isSignedIn && !isOwnRepo && viewerCollections != nil
    }

    public var shownCount: Int {
        pinned.count + groups.reduce(0) { $0 + $1.totalCount }
    }

    public var narrowed: Bool {
        !filter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || commonFilter != .all
    }

    /// The chrome bar's count: "shown/total" when narrowed, else the total.
    public var collectionsStatusLabel: String? {
        guard let list = collections.value else { return nil }
        return narrowed ? "\(shownCount)/\(list.count)" : "\(list.count)"
    }

    /// An inactive repo fails describeRepo by design and the banner has
    /// already explained why; repeating the PDS's 400 as a red error reads
    /// as a bug, so the tab states the reason instead. The raw error stays
    /// in `collections.errorMessage`.
    public var collectionsInactiveNotice: String? {
        guard collections.errorMessage != nil, let status = identity.value?.repoStatus else { return nil }
        return "No collections to list: this repo is \(status.status ?? "inactive") and its PDS refuses record reads."
    }

    /// Placeholder copy when the tab has nothing to list.
    public var collectionsEmptyMessage: String? {
        guard let list = collections.value else { return nil }
        if list.isEmpty { return "No collections on this repo." }
        guard groups.isEmpty, pinned.isEmpty else { return nil }
        switch commonFilter {
        case .mutual: return "No collections in common with this repo."
        case .notMine: return "You already have every collection this repo has."
        case .all: return "No collections match \(filter.trimmingCharacters(in: .whitespacesAndNewlines))."
        }
    }

    public func isOpen(_ key: String) -> Bool {
        openOverrides[key] ?? !prefs.collectionGroupsCollapsedByDefault
    }

    public func toggle(_ key: String) {
        openOverrides[key] = !isOpen(key)
    }

    /// Every group key currently rendered, so "expand/collapse all" targets
    /// the visible set rather than stale keys from a previous filter.
    public var allGroupKeys: [String] {
        var keys = pinned.groups.map { CollectionGrouping.pinnedKey($0.entry) }
        for group in groups {
            keys.append(group.key)
            keys.append(contentsOf: group.subgroups.map(\.fullKey))
        }
        return keys
    }

    public var anyOpen: Bool { allGroupKeys.contains { isOpen($0) } }

    public func setAllOpen(_ open: Bool) {
        for key in allGroupKeys {
            openOverrides[key] = open
        }
    }

    public func toggleAllOpen() {
        setAllOpen(!anyOpen)
    }

    // MARK: Pins

    /// Pin buttons work without sign-in: prefs are local-first and only
    /// sync to the PDS once the user signs in.
    public func togglePin(_ nsid: String) {
        let target = pinTarget
        preferences?.update { $0.togglePinnedLexicon(nsid, target: target) }
    }

    /// Pinning a group stores the `prefix.*` wildcard in the same list.
    public func toggleGroupPin(prefix: String) {
        togglePin(prefix + PinnedLexicons.groupSuffix)
    }

    public func isPinned(_ nsid: String) -> Bool {
        activePinList.contains(nsid)
    }

    public func isGroupPinned(prefix: String) -> Bool {
        activePinList.contains(prefix + PinnedLexicons.groupSuffix)
    }
}

extension Loadable {
    /// Loaded or failed: the request came back one way or the other.
    fileprivate var isSettled: Bool {
        switch self {
        case .loaded, .failed: return true
        case .idle, .loading: return false
        }
    }
}
