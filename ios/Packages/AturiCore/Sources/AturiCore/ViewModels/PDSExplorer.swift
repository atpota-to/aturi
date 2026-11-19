import Foundation

/// Where the PDS explorer is, read from the address and written back to it,
/// and how it sorts and filters the accounts a host lists. Port of
/// `src/lib/pdsExplorer.ts`; `PDSModel` uses it for the PDS page's accounts
/// table, and its share link carries the same address the web reads.
///
/// A PDS has one route, /explore/pds/{host}, so the rest is in the query,
/// and every view on the web (Workbench, Files and Classic) reads the same
/// one:
///
///   ?tab=overview|accounts|relays   which of the host's views; left off, the
///                                   view's own default (the workbench opens
///                                   on the overview, Files on the accounts)
///   ?status=active|inactive|<name>  accounts by how they stand on the host
///   ?commit=24h|7d|30d|1y|dormant   accounts by when their repo last changed
///   ?sort=handle|commit|status      the order, with ?dir=asc|desc only when
///                                   it isn't that order's natural direction
///   ?account=did:…                  one account open beside the list
///
/// The account parameters belong to the accounts view: any of them implies
/// it, and they are dropped from any other.
///
/// Swift spellings: the web's string unions are enums with the web's
/// values as raw values, its `Record`s are `label` properties, a status
/// filter stays a string (`all`, `active`, `inactive` or a status's name),
/// and the comparators return the sign of the web's number.
public enum PDSExplorer {
    public enum Tab: String, CaseIterable, Hashable, Sendable {
        case overview
        case accounts
        case relays

        public var label: String {
            switch self {
            case .overview: return "Overview"
            case .accounts: return "Accounts"
            case .relays: return "Relays"
            }
        }
    }

    /// When an account's repo last changed, from the TID its head commit
    /// carries as `rev`. The four windows count back from now and include
    /// one another, so "past 7 days" holds the past day too; `dormant` is
    /// everything older than a year. A repo with no readable rev is in none
    /// of them.
    public enum CommitWindow: String, CaseIterable, Hashable, Sendable {
        case day = "24h"
        case week = "7d"
        case month = "30d"
        case year = "1y"
        case dormant

        public var label: String {
            switch self {
            case .day: return "Past 24 hours"
            case .week: return "Past 7 days"
            case .month: return "Past 30 days"
            case .year: return "Past year"
            case .dormant: return "Over a year ago"
            }
        }

        /// How far back the window reaches; nil for `dormant`, which is
        /// what the year leaves.
        public var span: TimeInterval? {
            let day: TimeInterval = 24 * 60 * 60
            switch self {
            case .day: return day
            case .week: return 7 * day
            case .month: return 30 * day
            case .year: return 365 * day
            case .dormant: return nil
            }
        }
    }

    /// The orders the accounts list can take. `listed` is the order the
    /// host lists them in, which on the reference PDS is the order the
    /// accounts were created, oldest first (its listRepos cursor is a
    /// creation time).
    public enum AccountSort: String, CaseIterable, Hashable, Sendable {
        case listed
        case handle
        case commit
        case status

        /// Each order's natural direction: newest commit first, everything
        /// else A to Z. `SORT_DESC_BY_DEFAULT`.
        public var descByDefault: Bool {
            self == .commit
        }
    }

    public struct Location: Hashable, Sendable {
        /// The host as the route spells it.
        public var host: String
        /// The view named in the address; nil for the layout's own default.
        public var tab: Tab?
        /// `all`, `active`, `inactive`, or one inactive status by its name.
        public var status: String
        public var commit: CommitWindow?
        public var sort: AccountSort
        public var desc: Bool
        /// The DID of the account open beside the list.
        public var account: String?

        public init(
            host: String,
            tab: Tab? = nil,
            status: String = "all",
            commit: CommitWindow? = nil,
            sort: AccountSort = .listed,
            desc: Bool = false,
            account: String? = nil
        ) {
            self.host = host
            self.tab = tab
            self.status = status
            self.commit = commit
            self.sort = sort
            self.desc = desc
            self.account = account
        }

        /// Whether it says anything about the accounts beyond the defaults.
        public var narrowsAccounts: Bool {
            status != "all" || commit != nil || sort != .listed || desc != sort.descByDefault || account != nil
        }
    }

    static let basePath = "/explore/pds"

    /// A status name as listRepos might send one: lower-case letters and dashes.
    static func isStatusName(_ value: String) -> Bool {
        value.wholeMatch(of: #/[a-z][a-z0-9-]{0,39}/#) != nil
    }

    /// True for /explore/pds/{host}, and nothing else.
    public static func isPdsPath(_ path: String?) -> Bool {
        guard let path else { return false }
        let parts = path.components(separatedBy: "/")
        return parts.count == 4 && parts[0].isEmpty && parts[1] == "explore" && parts[2] == "pds" && !parts[3].isEmpty
    }

    /// Reads a PDS address: its percent-encoded path and its decoded query.
    /// Nil for anything that isn't the PDS route. Values the explorer
    /// doesn't know are ignored rather than refused, so a mistyped `?sort=`
    /// still opens the page.
    public static func parse(path: String?, query: [String: String]) -> Location? {
        guard let path, isPdsPath(path) else { return nil }
        let segment = path.components(separatedBy: "/")[3]
        let host = segment.removingPercentEncoding ?? segment

        let statusParam = (query["status"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let accountParam = (query["account"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let sort = query["sort"].flatMap { AccountSort(rawValue: $0) } ?? .listed
        let desc: Bool
        switch query["dir"] ?? "" {
        case "desc": desc = true
        case "asc": desc = false
        default: desc = sort.descByDefault
        }
        let accounts = Location(
            host: host,
            status: isStatusName(statusParam) ? statusParam : "all",
            commit: query["commit"].flatMap { CommitWindow(rawValue: $0) },
            sort: sort,
            desc: desc,
            account: accountParam.hasPrefix("did:") ? accountParam : nil
        )

        let named = query["tab"].flatMap { Tab(rawValue: $0) }
        let tab: Tab? = named ?? (accounts.narrowsAccounts ? .accounts : nil)
        if tab == .accounts {
            var loc = accounts
            loc.tab = .accounts
            return loc
        }
        return Location(host: host, tab: tab)
    }

    /// The address of a location: the shortest one that reads back the
    /// same. `defaultTab` is the view the layout opens on, which the
    /// address can leave unsaid.
    public static func address(_ loc: Location, defaultTab: Tab? = nil) -> String {
        var query: [(String, String)] = []
        let tab = loc.tab ?? defaultTab
        if tab == .accounts {
            if !loc.narrowsAccounts && defaultTab != .accounts {
                query.append(("tab", "accounts"))
            }
            if loc.status != "all" { query.append(("status", loc.status)) }
            if let commit = loc.commit { query.append(("commit", commit.rawValue)) }
            if loc.sort != .listed { query.append(("sort", loc.sort.rawValue)) }
            if loc.desc != loc.sort.descByDefault { query.append(("dir", loc.desc ? "desc" : "asc")) }
            if let account = loc.account { query.append(("account", account)) }
        } else if let tab, tab != defaultTab {
            query.append(("tab", tab.rawValue))
        }
        let path = basePath + "/" + URIEncoding.encodeComponent(loc.host)
        guard !query.isEmpty else { return path }
        let qs = query
            .map { URIEncoding.encodeComponent($0.0) + "=" + URIEncoding.encodeComponent($0.1) }
            .joined(separator: "&")
        return path + "?" + qs
    }

    /// A location with the account parameters back at their defaults.
    public static func withoutAccountParams(_ loc: Location) -> Location {
        Location(host: loc.host, tab: loc.tab)
    }

    /// What the page's title says, in the words the route's own metadata uses.
    public static func title(host: String, tab: Tab) -> String {
        let base = "\(host) · PDS · Atmosphere Explorer"
        return tab == .overview ? base : "\(tab.label) · \(base)"
    }

    // MARK: - Standing

    /// How an account stands on its host, from listRepos' `active` and
    /// `status`: `active`, or the status the host gave for an inactive one.
    /// Hosts older than the account-status fields send neither, and serve
    /// every repo they list, so those count as active.
    public static func standing(active: Bool?, status: String?) -> String {
        let named = (status ?? "").lowercased()
        if active == false { return named.isEmpty ? "inactive" : named }
        if !named.isEmpty && named != "active" { return named }
        return "active"
    }

    public static func standing(of repo: PDSServer.RepoEntry) -> String {
        standing(active: repo.active, status: repo.status)
    }

    public static func matchesStatus(_ standing: String, _ filter: String) -> Bool {
        switch filter {
        case "all": return true
        case "active": return standing == "active"
        case "inactive": return standing != "active"
        default: return standing == filter
        }
    }

    static let statusLabels: [String: String] = [
        "active": "Active",
        "inactive": "Inactive",
        "deactivated": "Deactivated",
        "takendown": "Taken down",
        "suspended": "Suspended",
        "deleted": "Deleted",
        "desynchronized": "Desynchronized",
        "throttled": "Throttled",
    ]

    /// A status in words. The lexicon leaves the set open, so an unknown
    /// one is shown as sent, capitalised.
    public static func statusLabel(_ status: String) -> String {
        if let label = statusLabels[status] { return label }
        return status.prefix(1).uppercased() + String(status.dropFirst())
    }

    static let statusMeanings: [String: String] = [
        "active": "The host serves this repo’s records.",
        "inactive": "The host lists this repo but won’t serve its records.",
        "deactivated": "Paused by the account holder, who can come back to it. Until then its records aren’t served.",
        "takendown": "Taken down by the host’s operator. Its records aren’t served.",
        "suspended": "Suspended for a time by the host’s operator. Its records aren’t served meanwhile.",
        "deleted": "The account was deleted. The host keeps only a marker that it existed.",
        "desynchronized": "The host’s copy of this repo has fallen out of step with the network.",
        "throttled": "The host is limiting how fast this repo can change.",
    ]

    /// What a status means for the repo, in a sentence.
    public static func statusMeaning(_ status: String) -> String {
        statusMeanings[status] ?? "The host gives this repo the status “\(status)” and won’t serve its records."
    }

    /// How loud a status is: `good` for active, `warn` for one the account
    /// holder chose (deactivated), `bad` for one imposed on them, `quiet`
    /// for the rest. The tone is never shown without the status's name.
    public enum StatusTone: String, Hashable, Sendable {
        case good
        case warn
        case bad
        case quiet
    }

    public static func statusTone(_ status: String) -> StatusTone {
        switch status {
        case "active": return .good
        case "deactivated": return .warn
        case "takendown", "suspended", "deleted": return .bad
        default: return .quiet
        }
    }

    /// Active first, then the inactive statuses by how severe, then the rest by name.
    static let statusOrder = ["active", "deactivated", "suspended", "takendown", "deleted"]

    public static func compareStatus(_ a: String, _ b: String) -> Int {
        let x = statusOrder.firstIndex(of: a) ?? -1
        let y = statusOrder.firstIndex(of: b) ?? -1
        if x != y {
            return (x < 0 ? statusOrder.count : x) - (y < 0 ? statusOrder.count : y)
        }
        return localeOrder(a, b)
    }

    /// `a.localeCompare(b)` as far as handles and status names need it:
    /// case-blind first, lower case ahead of upper on a tie, as the default
    /// collation has it. Deterministic, unlike the device locale's.
    static func localeOrder(_ a: String, _ b: String) -> Int {
        let x = a.lowercased()
        let y = b.lowercased()
        if x != y { return x < y ? -1 : 1 }
        if a == b { return 0 }
        return a > b ? -1 : 1
    }

    // MARK: - Last commit

    public static func matchesCommit(_ date: Date?, _ window: CommitWindow?, now: Date = Date()) -> Bool {
        guard let window else { return true }
        guard let date else { return false }
        let age = now.timeIntervalSince(date)
        guard let span = window.span else {
            return age >= (CommitWindow.year.span ?? 0)
        }
        return age < span
    }

    // MARK: - Counting

    public struct Facets: Hashable, Sendable {
        /// Accounts within the commit filter, whatever their status.
        public var statusAll: Int
        /// Those accounts by standing.
        public var byStatus: [String: Int]
        /// Accounts within the status filter, whatever their last commit.
        public var commitAll: Int
        /// Those accounts by commit window.
        public var byCommit: [CommitWindow: Int]

        public init(statusAll: Int = 0, byStatus: [String: Int] = [:], commitAll: Int = 0, byCommit: [CommitWindow: Int] = [:]) {
            self.statusAll = statusAll
            self.byStatus = byStatus
            self.commitAll = commitAll
            self.byCommit = byCommit
        }

        /// The count for a window, zero when none fall in it.
        public func count(_ window: CommitWindow) -> Int {
            byCommit[window] ?? 0
        }

        /// The count for a standing, zero when none have it.
        public func count(standing: String) -> Int {
            byStatus[standing] ?? 0
        }
    }

    /// How many accounts each filter would show, as a faceted search
    /// counts: each facet's counts honour the other facet's choice but not
    /// its own, so picking "Active" shows how many active accounts committed
    /// this week, and the status counts still say how many of each there are.
    public static func countFacets(
        _ rows: [(standing: String, date: Date?)],
        status: String,
        commit: CommitWindow?,
        now: Date = Date()
    ) -> Facets {
        var facets = Facets()
        for window in CommitWindow.allCases {
            facets.byCommit[window] = 0
        }
        for row in rows {
            if matchesCommit(row.date, commit, now: now) {
                facets.statusAll += 1
                facets.byStatus[row.standing, default: 0] += 1
            }
            if matchesStatus(row.standing, status) {
                facets.commitAll += 1
                for window in CommitWindow.allCases where matchesCommit(row.date, window, now: now) {
                    facets.byCommit[window, default: 0] += 1
                }
            }
        }
        return facets
    }

    // MARK: - Sorting

    /// What sorting needs of an account.
    public struct SortableAccount: Hashable, Sendable {
        /// Its place in the host's listing.
        public var index: Int
        public var standing: String
        public var date: Date?
        /// The handle, once known.
        public var handle: String?

        public init(index: Int, standing: String, date: Date? = nil, handle: String? = nil) {
            self.index = index
            self.standing = standing
            self.date = date
            self.handle = handle
        }
    }

    /// Orders two accounts: negative when `a` goes first. Accounts with
    /// nothing to sort by (no handle yet, no readable commit date) go last
    /// in either direction, and ties keep the host's order, so the list
    /// doesn't shuffle as handles fill in.
    public static func compareAccounts(_ a: SortableAccount, _ b: SortableAccount, sort: AccountSort, desc: Bool) -> Int {
        let dir = desc ? -1 : 1
        let listed = a.index - b.index
        func orListed(_ value: Int) -> Int {
            value != 0 ? value : listed
        }
        switch sort {
        case .listed:
            return dir * listed
        case .status:
            return orListed(dir * compareStatus(a.standing, b.standing))
        case .handle:
            let x = a.handle.flatMap { $0.isEmpty ? nil : $0 }
            let y = b.handle.flatMap { $0.isEmpty ? nil : $0 }
            guard let x, let y else {
                return orListed(x != nil ? -1 : (y != nil ? 1 : 0))
            }
            return orListed(dir * localeOrder(x, y))
        case .commit:
            guard let x = a.date, let y = b.date else {
                return orListed(a.date != nil ? -1 : (b.date != nil ? 1 : 0))
            }
            let order = x < y ? -1 : (x > y ? 1 : 0)
            return orListed(dir * order)
        }
    }

    /// One order the list can take, for a sort menu.
    public struct SortChoice: Hashable, Sendable, Identifiable {
        public var sort: AccountSort
        public var desc: Bool
        public var label: String

        public var id: String { sort.rawValue + (desc ? ":desc" : ":asc") }

        public init(sort: AccountSort, desc: Bool, label: String) {
            self.sort = sort
            self.desc = desc
            self.label = label
        }
    }

    /// Every order the list can take, for the narrow pane's sort menu.
    /// `SORT_CHOICES` in `explore/pds/parts.tsx`.
    public static let sortChoices: [SortChoice] = [
        SortChoice(sort: .listed, desc: false, label: "As listed"),
        SortChoice(sort: .listed, desc: true, label: "As listed, reversed"),
        SortChoice(sort: .commit, desc: true, label: "Newest commit"),
        SortChoice(sort: .commit, desc: false, label: "Oldest commit"),
        SortChoice(sort: .handle, desc: false, label: "Handle, A to Z"),
        SortChoice(sort: .handle, desc: true, label: "Handle, Z to A"),
        SortChoice(sort: .status, desc: false, label: "Active first"),
        SortChoice(sort: .status, desc: true, label: "Inactive first"),
    ]

    /// The menu's label for an order.
    public static func sortLabel(_ sort: AccountSort, desc: Bool) -> String {
        sortChoices.first { $0.sort == sort && $0.desc == desc }?.label ?? "As listed"
    }

    // MARK: - The server

    /// Where a host's accounts sign in, from its OAuth protected-resource
    /// metadata: on the PDS itself, or through an entryway in front of it
    /// (bsky.social is one).
    public enum SignIn: Hashable, Sendable {
        case onThisPDS
        /// The authorization server's host, for its own PDS page.
        case through(host: String)
    }

    /// The authorization servers worth showing: the http(s) ones, in order.
    /// Nil when there are none, which the page reads as "not said".
    /// `startServer` in `explore/pds/usePdsData.ts`.
    public static func authorizationServers(_ servers: [String]?) -> [String]? {
        let list = (servers ?? []).filter { $0.hasPrefix("https://") || $0.hasPrefix("http://") }
        return list.isEmpty ? nil : list
    }

    /// Each authorization server as the server card names it: "On this
    /// PDS" when it is the PDS's own origin, else the host to go through.
    public static func signIn(authServers: [String], base: String) -> [SignIn] {
        let origin = base.lowercased()
        return authServers.map { server -> SignIn in
            var trimmed = server
            if trimmed.hasSuffix("/") {
                trimmed.removeLast()
            }
            if trimmed.lowercased() == origin { return .onThisPDS }
            return .through(host: PDSServer.pdsHostname(server))
        }
    }

    /// Only http(s): the host writes its policy links, and a `javascript:`
    /// URL is not a policy. `OutLink` in `explore/pds/PdsOverview.tsx`.
    public static func isWebLink(_ href: String) -> Bool {
        let lower = href.lowercased()
        return lower.hasPrefix("https://") || lower.hasPrefix("http://")
    }
}
