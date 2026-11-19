import Foundation

/// The mutuals' blocks tool's logic. Port of `src/lib/tools/mutuals.ts`.
///
/// A block on Bluesky is a public record: `app.bsky.graph.block`, written in
/// the blocker's own repository, naming the account blocked. So the accounts
/// an account's mutuals block can be read straight from their repositories,
/// and an account that many of them block independently stands out.
///
/// The run, in order (the requests are in `MutualsClient`, the run itself in
/// `MutualsModel`):
///
///   1. Who the account follows, from the AppView, with a profile for each.
///   2. Which of those follow back. Either every follower is listed and the
///      two sets are intersected, or the follows are checked thirty at a
///      time with `getRelationships`; `mutualStrategy` picks whichever costs
///      fewer requests for this account.
///   3. Each mutual's block records, read from its own PDS, every page. Each
///      blocked account is tallied against the mutuals that block it.
///   4. Each mutual's `app.bsky.graph.listblock` records: the moderation
///      lists it blocks wholesale. They are counted per list, not expanded
///      into their members, which would take a request per hundred members
///      of every list.
///
/// What comes out is a tally from blocked account to the mutuals blocking
/// it. Everything the page draws is a view of that tally at a threshold: the
/// distribution of counts and the ranked accounts. Saving writes the chosen
/// accounts into a new moderation list in the signed-in account's
/// repository.
///
/// Everything here is pure. The web's session-storage snapshot is not
/// ported: signing in on the phone happens in a sheet over the page, so the
/// scan is never thrown away by it.
public enum Mutuals {
    public static let blockCollection = "app.bsky.graph.block"
    public static let listBlockCollection = "app.bsky.graph.listblock"
    public static let listCollection = "app.bsky.graph.list"
    public static let listItemCollection = "app.bsky.graph.listitem"
    public static let modlistPurpose = "app.bsky.graph.defs#modlist"

    /// `getFollows` and `getFollowers` return at most this many a page.
    public static let graphPageSize = 100
    /// Pages of follows, or of followers, read at most: 20,000 accounts. An
    /// account following more than that is rare, and its mutuals are
    /// reported as partial rather than read without end.
    public static let graphPageLimit = 200
    /// `getRelationships` takes at most this many accounts a request.
    public static let relationshipsChunk = 30
    /// `applyWrites` takes at most this many writes a call.
    public static let applyWritesMax = AuthenticatedPDS.applyWritesMax
    /// A create costs three of a PDS's write points (`WriteThrottle`).
    public static let createPoints = 3

    /// The lexicon's limits for a list's name (UTF-8 bytes) and description (graphemes).
    public static let listNameMaxBytes = 64
    public static let listDescriptionMaxGraphemes = 300
    public static let defaultListName = "Blocked by my mutuals"

    // MARK: - Input

    public enum AccountInput: Hashable, Sendable {
        case ok(actor: String)
        case invalid(reason: String)
    }

    static let accountsOnly = "Mutuals belong to accounts. Enter a handle or a DID."

    /// A handle, a DID, an at:// URI of an account, or a profile link.
    public static func parseAccountInput(_ raw: String) -> AccountInput {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .invalid(reason: "Enter a handle or a DID.")
        }
        switch Labels.parseSubjectInput(raw) {
        case .invalid(let reason):
            return .invalid(reason: reason == Labels.notLabelled ? accountsOnly : reason)
        case .ok(let target):
            switch target {
            case .account(let actor): return .ok(actor: actor)
            case .post: return .invalid(reason: accountsOnly)
            }
        }
    }

    /// The threshold as the query string holds it. Nil when absent or not a
    /// whole number from 1.
    public static func parseThreshold(_ raw: String) -> Int? {
        guard (1...5).contains(raw.utf8.count), raw.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              let value = Int(raw), value >= 1
        else { return nil }
        return value
    }

    // MARK: - Finding the mutuals

    /// How to tell which follows follow back.
    ///
    ///     followers      list every follower and intersect. A request per
    ///                    hundred followers.
    ///     relationships  ask about the follows thirty at a time. A request
    ///                    per thirty follows.
    ///
    /// An account with a modest following is cheapest to read through its
    /// followers; one with a large following, through its follows. Followers
    /// past what can be paged through are never complete, so they rule the
    /// first out.
    public enum Strategy: String, Hashable, Sendable {
        case followers
        case relationships
    }

    public static func mutualStrategy(follows: Int, followers: Int) -> Strategy {
        if followers > graphPageSize * graphPageLimit { return .relationships }
        let viaFollowers = (followers + graphPageSize - 1) / graphPageSize
        let viaRelationships = (min(follows, graphPageSize * graphPageLimit) + relationshipsChunk - 1) / relationshipsChunk
        return viaFollowers <= viaRelationships ? .followers : .relationships
    }

    /// `handle.invalid` is what the AppView says when a handle no longer resolves.
    public static func cleanHandle(_ handle: String?) -> String? {
        guard let handle, !handle.isEmpty, handle != "handle.invalid" else { return nil }
        return handle
    }

    /// The AppView's full-size avatar URL, swapped for its thumbnail where it is one.
    public static func avatarThumb(_ url: String?) -> String? {
        guard let url, !url.isEmpty else { return nil }
        guard let range = url.range(of: "/img/avatar/plain/") else { return url }
        return url.replacingCharacters(in: range, with: "/img/avatar_thumbnail/plain/")
    }

    // MARK: - Reading the blocks

    /// `^did:[a-z]+:[a-zA-Z0-9._:%-]{1,2048}$`
    static func isDidShaped(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count > 4, value.hasPrefix("did:") else { return false }
        var index = 4
        let methodStart = index
        while index < bytes.count, bytes[index] >= 0x61, bytes[index] <= 0x7a {
            index += 1
        }
        guard index > methodStart, index < bytes.count, bytes[index] == UInt8(ascii: ":") else { return false }
        let rest = bytes[(index + 1)...]
        guard (1...2048).contains(rest.count) else { return false }
        return rest.allSatisfy { byte in
            switch byte {
            // 0-9, A-Z, a-z
            case 0x30...0x39, 0x41...0x5a, 0x61...0x7a: return true
            // . _ : % -
            case 0x2e, 0x5f, 0x3a, 0x25, 0x2d: return true
            default: return false
            }
        }
    }

    /// The account a block record names, or nil for a record that is not one.
    public static func readBlockSubject(_ value: JSONValue?) -> String? {
        guard let subject = value?["subject"]?.stringValue, isDidShaped(subject) else { return nil }
        return subject
    }

    /// The list a listblock record names, or nil for a record that is not one.
    public static func readListBlockSubject(_ value: JSONValue?) -> String? {
        guard let subject = value?["subject"]?.stringValue, listUriParts(subject) != nil else { return nil }
        return subject
    }

    /// `^at://(did:[^/]+)/app.bsky.graph.list/([^/]+)$`: the creator's DID and the rkey.
    static func listUriParts(_ uri: String) -> (did: String, rkey: String)? {
        guard uri.hasPrefix("at://") else { return nil }
        let parts = uri.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].hasPrefix("did:"), parts[0].count > 4,
              parts[1] == "app.bsky.graph.list", !parts[2].isEmpty
        else { return nil }
        return (String(parts[0]), String(parts[2]))
    }

    /// Blocked account (or list) to the indexes of the mutuals blocking it.
    public typealias Tally = [String: [Int]]

    /// Count one record against one mutual. `seen` holds what this mutual
    /// has already been counted for: an account blocked twice by the same
    /// person, by two records, is still one person's block. Returns whether
    /// it was counted.
    @discardableResult
    public static func tallyBlock(_ tally: inout Tally, seen: inout Set<String>, mutual: Int, subject: String) -> Bool {
        guard seen.insert(subject).inserted else { return false }
        tally[subject, default: []].append(mutual)
        return true
    }

    // MARK: - The distribution

    /// How many accounts are blocked by exactly k mutuals, at index k. Index
    /// 0 is always 0, so the array's length is one more than the highest count.
    public static func histogram(_ tally: Tally, exclude: Set<String>? = nil) -> [Int] {
        var counts = [0]
        for (subject, blockers) in tally {
            if exclude?.contains(subject) == true { continue }
            let k = blockers.count
            while counts.count <= k {
                counts.append(0)
            }
            counts[k] += 1
        }
        return counts
    }

    /// Accounts blocked by at least `threshold` mutuals.
    public static func countAtLeast(_ counts: [Int], _ threshold: Int) -> Int {
        var total = 0
        var k = max(1, threshold)
        while k < counts.count {
            total += counts[k]
            k += 1
        }
        return total
    }

    /// The most mutuals blocking any one account. 0 when nothing is blocked.
    public static func highestCount(_ counts: [Int]) -> Int {
        var k = counts.count - 1
        while k >= 1 {
            if counts[k] > 0 { return k }
            k -= 1
        }
        return 0
    }

    public struct Bin: Hashable, Sendable, Identifiable {
        /// The lowest and highest count the bin covers, inclusive.
        public var from: Int
        public var to: Int
        /// Accounts in it.
        public var count: Int

        public var id: Int { from }

        public init(from: Int, to: Int, count: Int) {
            self.from = from
            self.to = to
            self.count = count
        }
    }

    /// The distribution in at most `maxBins` columns, one count per column
    /// while it fits and equal ranges once it does not. Runs to the highest
    /// count, so the last column always holds something.
    public static func histogramBins(_ counts: [Int], maxBins: Int = 40) -> [Bin] {
        let top = highestCount(counts)
        if top == 0 { return [] }
        let width = max(1, (top + maxBins - 1) / maxBins)
        var bins: [Bin] = []
        var from = 1
        while from <= top {
            let to = min(top, from + width - 1)
            var count = 0
            for k in from...to where k < counts.count {
                count += counts[k]
            }
            bins.append(Bin(from: from, to: to, count: count))
            from += width
        }
        return bins
    }

    /// A starting threshold: one in twenty of the mutuals read, from 2 to
    /// 10, lowered until at least one account meets it. Two mutuals blocking
    /// the same account is the least that says anything; ten is enough that
    /// the list is short for anyone.
    public static func suggestThreshold(mutualsRead: Int, counts: [Int]) -> Int {
        var threshold = min(10, max(2, (mutualsRead + 19) / 20))
        while threshold > 1, countAtLeast(counts, threshold) == 0 {
            threshold -= 1
        }
        return threshold
    }

    // MARK: - The ranked accounts

    public struct Candidate: Hashable, Sendable, Identifiable {
        public var did: String
        public var blockers: [Int]

        public var id: String { did }

        public init(did: String, blockers: [Int]) {
            self.did = did
            self.blockers = blockers
        }
    }

    /// Accounts blocked by at least `threshold` mutuals, most blocked first.
    public static func rankCandidates(_ tally: Tally, threshold: Int, exclude: Set<String>? = nil) -> [Candidate] {
        var out: [Candidate] = []
        for (did, blockers) in tally where blockers.count >= threshold {
            if exclude?.contains(did) == true { continue }
            out.append(Candidate(did: did, blockers: blockers))
        }
        out.sort { a, b in
            if a.blockers.count != b.blockers.count { return a.blockers.count > b.blockers.count }
            return a.did < b.did
        }
        return out
    }

    /// What the scanned account already has to do with a candidate.
    public struct CandidateFlags: Hashable, Sendable {
        /// It follows the candidate.
        public var followed: Bool
        /// The candidate is one of its mutuals.
        public var mutual: Bool
        /// It already blocks the candidate.
        public var blocked: Bool
        /// The AppView has no profile for the candidate: deleted, deactivated or taken down.
        public var missing: Bool

        public init(followed: Bool = false, mutual: Bool = false, blocked: Bool = false, missing: Bool = false) {
            self.followed = followed
            self.mutual = mutual
            self.blocked = blocked
            self.missing = missing
        }
    }

    /// Whether a candidate starts out ticked for the list. An account the
    /// person follows, or a mutual, is something they chose, and a missing
    /// account cannot be shown to anyone; those start unticked. One already
    /// blocked stays ticked: the list is also for sharing.
    public static func selectedByDefault(_ flags: CandidateFlags) -> Bool {
        !flags.followed && !flags.mutual && !flags.missing
    }

    // MARK: - Block lists

    public struct ListSubscription: Hashable, Sendable, Identifiable {
        public var uri: String
        public var subscribers: [Int]

        public var id: String { uri }

        public init(uri: String, subscribers: [Int]) {
            self.uri = uri
            self.subscribers = subscribers
        }
    }

    /// Lists blocked by at least `min` mutuals, most subscribed first.
    public static func rankListBlocks(_ listBlocks: Tally, min: Int = 1) -> [ListSubscription] {
        listBlocks
            .filter { $0.value.count >= min }
            .map { ListSubscription(uri: $0.key, subscribers: $0.value) }
            .sorted { a, b in
                if a.subscribers.count != b.subscribers.count { return a.subscribers.count > b.subscribers.count }
                return a.uri < b.uri
            }
    }

    // MARK: - Saving as a moderation list

    /// Why a list name will not do, or nil when it will.
    public static func listNameProblem(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Give the list a name." }
        if trimmed.utf8.count > listNameMaxBytes { return "That name is too long for a list." }
        return nil
    }

    /// Why a description will not do, or nil when it will.
    public static func listDescriptionProblem(_ description: String) -> String? {
        let graphemes = description.trimmingCharacters(in: .whitespacesAndNewlines).count
        if graphemes > listDescriptionMaxGraphemes {
            return "The description is \(graphemes) characters; a list allows \(listDescriptionMaxGraphemes)."
        }
        return nil
    }

    /// What the list says about itself, until the person changes it.
    public static func defaultListDescription(threshold: Int, mutualsRead: Int, date: Date) -> String {
        let day = Formatting.isoDay(date)
        let who = threshold == 1 ? "at least one" : "at least \(threshold)"
        return "Accounts blocked by \(who) of the \(count(mutualsRead)) mutuals I checked on \(day), found with aturi.to/tools/mutuals."
    }

    /// The `app.bsky.graph.list` record: a moderation list.
    public static func listRecord(name: String, description: String, createdAt: String) -> JSONValue {
        var record: [String: JSONValue] = [
            "$type": .string(listCollection),
            "purpose": .string(modlistPurpose),
            "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "createdAt": .string(createdAt),
        ]
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            record["description"] = .string(text)
        }
        return .object(record)
    }

    /// One `app.bsky.graph.listitem` record: an account on a list.
    public static func listItemRecord(list: String, subject: String, createdAt: String) -> JSONValue {
        .object([
            "$type": .string(listItemCollection),
            "subject": .string(subject),
            "list": .string(list),
            "createdAt": .string(createdAt),
        ])
    }

    /// One `applyWrites` create per account, for a list.
    public static func listItemWrites(list: String, subjects: [String], createdAt: String) -> [JSONValue] {
        subjects.map { subject in
            JSONValue.object([
                "$type": .string("com.atproto.repo.applyWrites#create"),
                "collection": .string(listItemCollection),
                "value": listItemRecord(list: list, subject: subject, createdAt: createdAt),
            ])
        }
    }

    /// The `app.bsky.graph.listblock` record that blocks everyone on a list.
    public static func listBlockRecord(list: String, createdAt: String) -> JSONValue {
        .object([
            "$type": .string(listBlockCollection),
            "subject": .string(list),
            "createdAt": .string(createdAt),
        ])
    }

    public static func chunk<T>(_ items: [T], size: Int) -> [[T]] {
        guard size > 0 else { return [items] }
        return stride(from: 0, to: items.count, by: size).map { start in
            Array(items[start..<min(start + size, items.count)])
        }
    }

    /// Write points a list of `members` costs: the list, each member, and the block if asked for.
    public static func savePoints(members: Int, block: Bool) -> Int {
        (1 + members + (block ? 1 : 0)) * createPoints
    }

    /// The list's page on Bluesky. Nil for a URI that is not a list.
    public static func bskyListUrl(_ listUri: String) -> String? {
        guard let parts = listUriParts(listUri) else { return nil }
        return "https://bsky.app/profile/\(parts.did)/lists/\(parts.rkey)"
    }

    // MARK: - The summary

    /// "1,204 accounts are blocked by at least 3 of 312 mutuals"
    public static func summary(matching: Int, threshold: Int, mutualsRead: Int) -> String {
        let accounts = matching == 1 ? "1 account is" : "\(count(matching)) accounts are"
        let mutuals = mutualsRead == 1 ? "1 mutual" : "\(count(mutualsRead)) mutuals"
        let least = threshold <= 1 ? "at least one" : "at least \(count(threshold))"
        return "\(accounts) blocked by \(least) of \(mutuals)"
    }

    // MARK: - Whether the session may write the list

    /// Whether a granted OAuth scope lets this app create records in every
    /// one of `collections`. True for the old catch-all
    /// `transition:generic`, and for a `repo:` grant naming the collection
    /// (or `*`) with no action, which means every action, or with
    /// `action=create`. Nil when the scope is not known, which the page
    /// treats as "try, and say so if the PDS refuses".
    public static func scopeAllowsCreate(_ scope: String?, collections: [String]) -> Bool? {
        guard let scope else { return nil }
        let tokens = scope.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
        if tokens.contains("transition:generic") { return true }
        func allowed(_ collection: String) -> Bool {
            tokens.contains { token in
                // `repo:<collection>?…`, or `repo?collection=…&…` for several.
                guard token.hasPrefix("repo:") || token.hasPrefix("repo?") else { return false }
                var rest = String(token.dropFirst("repo".count))
                if rest.hasPrefix(":") {
                    rest.removeFirst()
                }
                let pieces = rest.split(separator: "?", omittingEmptySubsequences: false)
                let target = pieces.first.map(String.init) ?? ""
                let query = pieces.count > 1 ? String(pieces[1]) : ""
                let params = queryPairs(query)
                let targets = ([target] + params.filter { $0.0 == "collection" }.map { $0.1 }).filter { !$0.isEmpty }
                guard targets.contains(where: { $0 == "*" || $0 == collection }) else { return false }
                let actions = params.filter { $0.0 == "action" }.map { $0.1 }
                return actions.isEmpty || actions.contains("create")
            }
        }
        return collections.allSatisfy(allowed)
    }

    /// `URLSearchParams` over a query string: pairs in order, `+` read as a
    /// space and percent escapes decoded.
    static func queryPairs(_ query: String) -> [(String, String)] {
        query.split(separator: "&").map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            func decode(_ text: Substring) -> String {
                let spaced = text.replacingOccurrences(of: "+", with: " ")
                return spaced.removingPercentEncoding ?? spaced
            }
            let name = decode(parts[0])
            let value = parts.count > 1 ? decode(parts[1]) : ""
            return (name, value)
        }
    }

    /// A count the way `toLocaleString('en-US')` writes it: 1,234,567.
    public static func count(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, char) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 {
                out.append(",")
            }
            out.append(char)
        }
        return n < 0 ? "-" + out : out
    }

    /// An account as the page names it: its handle with an @, or its DID.
    public static func who(_ person: MutualsPerson) -> String {
        person.handle.map { "@" + $0 } ?? person.did
    }
}

/// An account as the page shows it.
public struct MutualsPerson: Hashable, Sendable, Identifiable {
    public var did: String
    public var handle: String?
    public var displayName: String?
    public var avatar: String?

    public var id: String { did }

    public init(did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil) {
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
    }

    /// A profile view from the AppView. Nil without a DID.
    public init?(profile: JSONValue?, did fallback: String? = nil) {
        guard let did = profile?["did"]?.stringValue ?? fallback, !did.isEmpty else { return nil }
        self.did = did
        handle = Mutuals.cleanHandle(profile?["handle"]?.stringValue)
        let name = profile?["displayName"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        displayName = (name?.isEmpty ?? true) ? nil : name
        avatar = Mutuals.avatarThumb(profile?["avatar"]?.stringValue)
    }
}

/// Where a mutual's reading has got to.
public enum MutualsReadState: Hashable, Sendable {
    case queued
    case reading(blocks: Int)
    case done(blocks: Int, listBlocks: Int)
    /// Its repository was not read to the end: gone, deactivated, its PDS
    /// did not answer, or (`stopped`) the scan was stopped first.
    case skipped(blocks: Int, reason: String, stopped: Bool)

    /// Accounts counted against this mutual so far.
    public var blocks: Int {
        switch self {
        case .queued: return 0
        case .reading(let blocks): return blocks
        case .done(let blocks, _): return blocks
        case .skipped(let blocks, _, _): return blocks
        }
    }

    public var isDone: Bool {
        if case .done = self { return true }
        return false
    }

    public var isQueued: Bool {
        if case .queued = self { return true }
        return false
    }

    /// Skipped by the scan's Stop, rather than unreadable.
    public var isStopped: Bool {
        if case .skipped(_, _, let stopped) = self { return stopped }
        return false
    }

    /// Not read to the end for a reason of its own: gone, deactivated, a PDS that did not answer.
    public var isUnreadable: Bool {
        if case .skipped(_, _, let stopped) = self { return !stopped }
        return false
    }

    /// Whether its blocks are in the counts: read to the end, or being read
    /// or stopped partway with something counted, so a count never exceeds it.
    public var countsAsRead: Bool {
        switch self {
        case .done: return true
        case .reading(let blocks): return blocks > 0
        case .skipped(let blocks, _, let stopped): return stopped && blocks > 0
        case .queued: return false
        }
    }

    /// What the mutual's mark says, `stateTitle` in `MutualBlocksCharts.tsx`.
    public func title(for person: MutualsPerson) -> String {
        let name = Mutuals.who(person)
        switch self {
        case .queued:
            return "\(name): waiting"
        case .reading(let blocks):
            return "\(name): reading, \(Mutuals.count(blocks)) blocks so far"
        case .done(let blocks, let listBlocks):
            var text = "\(name): \(Mutuals.count(blocks)) \(blocks == 1 ? "block" : "blocks")"
            if listBlocks > 0 {
                text += ", \(listBlocks) block \(listBlocks == 1 ? "list" : "lists")"
            }
            return text
        case .skipped(let blocks, let reason, let stopped):
            if stopped {
                return blocks > 0 ? "\(name): \(reason), \(Mutuals.count(blocks)) blocks read" : "\(name): \(reason)"
            }
            return "\(name): not read, \(reason)"
        }
    }
}
