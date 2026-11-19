import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The mutuals' blocks tool's state, port of `MutualBlocks.tsx`,
// `MutualBlocksSave.tsx` and the scan in `mutualsClient.ts`. The logic is in
// `Mutuals`, the requests in `MutualsClient`, the writes in `MutualsSave`;
// this runs them and holds what the page draws.
//
// The scan runs on the main actor and waits on the network, so its state
// is only ever touched from one place. The mutuals' repositories are read
// six at a time, each in a task of its own that hands back everything it
// found; the tally grows a mutual at a time as those come back, and each
// reading mutual's count ticks up as its pages arrive.
//
// What the web leaves out on a phone, and this does too: the orbit map.
// The distribution and the ranked accounts are all here.

/// Where a save has got to.
public struct MutualsSaving: Hashable, Sendable {
    public var listUri: String?
    public var progress: MutualsAddProgress?
    public var outcome: MutualsAddOutcome?
    /// Whether the account is blocking the list.
    public var blocked: Bool
    /// Why blocking the finished list failed.
    public var blockError: String?
    /// Why creating the list failed.
    public var error: String?
    public var running: Bool

    /// Every account asked for is on the list.
    public var finished: Bool {
        outcome?.remaining.isEmpty ?? false
    }
}

@MainActor
@Observable
public final class MutualsModel {
    public enum Phase: Hashable, Sendable {
        case idle
        /// Resolving the account and reading its profile.
        case resolving
        /// Listing who it follows.
        case follows
        /// Finding which follows follow back.
        case mutuals
        /// Reading the mutuals' repositories.
        case blocks
        /// Every mutual has been read, or Stop was pressed.
        case done
        case failed
    }

    /// Rows listed, and added by "Show more".
    public static let pageSize = 50
    /// Block lists described.
    public static let listsShown = 12
    /// Accounts described up front, from the top of the ranking, so the
    /// ones that no longer exist are out of the list before it is drawn.
    public static let describeUpTo = 1000
    /// Mutuals read at once.
    public static let mutualConcurrency = 6
    /// `getRelationships` requests at once.
    public static let appViewConcurrency = 4

    // MARK: Input

    /// The account as the link or the input named it.
    public private(set) var raw = ""
    /// The account parsed out of `raw`, nil when it is not one.
    public private(set) var actor: String?
    public private(set) var inputError: String?

    // MARK: The scan

    public private(set) var phase: Phase = .idle
    public private(set) var runError: String?
    public private(set) var account: MutualsPerson?
    public private(set) var followsCount = 0
    public private(set) var followersCount = 0
    /// How the mutuals were found. Nil until the follows are listed.
    public private(set) var strategy: Mutuals.Strategy?
    /// Follows listed, then follows checked, then mutuals read, for the progress line.
    public private(set) var progress = 0
    /// Some follows or followers were past what is paged through.
    public private(set) var partialMutuals = false
    public private(set) var stopped = false
    public private(set) var isStopping = false
    /// Every account the scanned one follows.
    public private(set) var follows: Set<String> = []
    /// Every account it blocks, or nil when its own repository could not be read.
    public private(set) var ownBlocks: Set<String>?
    public private(set) var mutuals: [MutualsPerson] = []
    /// One per mutual, in the same order.
    public private(set) var states: [MutualsReadState] = []
    /// Blocked account to the mutuals blocking it. Drawn only through
    /// `counts` and `ranked`, which follow it.
    @ObservationIgnored public private(set) var tally: Mutuals.Tally = [:]
    /// Lists blocked wholesale, to the mutuals blocking them.
    public private(set) var listBlocks: Mutuals.Tally = [:]
    /// Block records read across every mutual, the ones still being read included.
    public private(set) var blocksRead = 0
    /// How many accounts are blocked by exactly k mutuals, at index k (`Mutuals.histogram`).
    public private(set) var counts: [Int] = [0]

    // MARK: What the page shows

    /// The threshold chosen, nil to follow the suggestion.
    public private(set) var askedThreshold: Int?
    /// The mutual whose blocks alone are shown.
    public private(set) var focus: Int?
    public private(set) var shownCount = MutualsModel.pageSize
    /// The account whose blockers are listed under its row.
    public private(set) var expanded: String?
    /// Ticks the person changed, over the defaults.
    public private(set) var ticks: [String: Bool] = [:]
    /// Accounts at or past the threshold, most blocked first. Ranked once
    /// the scan has finished.
    public private(set) var ranked: [Mutuals.Candidate] = []
    public private(set) var profiles: [String: MutualsPerson] = [:]
    /// Accounts the AppView has no profile for.
    public private(set) var missingProfiles: Set<String> = []
    /// Accounts whose profile request failed; shown by DID.
    public private(set) var failedProfiles: Set<String> = []
    public private(set) var lists: [String: MutualsListDescription] = [:]

    // MARK: Saving

    public var listName = Mutuals.defaultListName
    /// Nil until the person edits it, so the default follows the threshold.
    public var editedDescription: String?
    public var blockAfterSaving = false
    public private(set) var saving: MutualsSaving?

    @ObservationIgnored private let client: MutualsClient
    @ObservationIgnored private let throttle: WriteThrottle
    @ObservationIgnored private let sleep: @Sendable (TimeInterval) async -> Void
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var scanTask: Task<Void, Never>?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var stopper = MutualsStopper()
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var askedProfiles: Set<String> = []
    @ObservationIgnored private var askedLists = false
    @ObservationIgnored private var liveRecords: [Int: Int] = [:]
    @ObservationIgnored private var saveStopped = false

    /// - Parameters:
    ///   - throttle: the write ledger the list's writes are paced against.
    ///   - sleep: how the write pacing waits; tests pass a no-op.
    public init(
        client: MutualsClient = MutualsClient(),
        throttle: WriteThrottle? = nil,
        sleep: @escaping @Sendable (TimeInterval) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
        },
        clock: @escaping () -> Date = { Date() }
    ) {
        self.client = client
        self.throttle = throttle ?? WriteThrottle()
        self.sleep = sleep
        self.clock = clock
    }

    // MARK: - Derived

    public var isRunning: Bool {
        switch phase {
        case .resolving, .follows, .mutuals, .blocks: return true
        case .idle, .done, .failed: return false
        }
    }

    public var isDone: Bool { phase == .done }

    /// Mutuals whose blocks are in the counts: every one read to the end, and
    /// any being read or stopped partway through, so a count never exceeds it.
    public var mutualsRead: Int {
        states.filter(\.countsAsRead).count
    }

    /// Mutuals whose repositories could not be read, apart from those the
    /// scan was stopped before reaching, which are not a failure of anything.
    public var unreadableCount: Int {
        states.filter(\.isUnreadable).count
    }

    public var notReachedCount: Int {
        states.filter(\.isStopped).count
    }

    public var neverStartedCount: Int {
        states.filter { $0.isStopped && $0.blocks == 0 }.count
    }

    public var highest: Int {
        Mutuals.highestCount(counts)
    }

    public var threshold: Int {
        max(1, askedThreshold ?? Mutuals.suggestThreshold(mutualsRead: mutualsRead, counts: counts))
    }

    public var matching: Int {
        Mutuals.countAtLeast(counts, threshold)
    }

    public var summary: String {
        Mutuals.summary(matching: matching, threshold: threshold, mutualsRead: mutualsRead)
    }

    public var bins: [Mutuals.Bin] {
        Mutuals.histogramBins(counts)
    }

    /// The ranking, or the accounts the focused mutual blocks.
    public var shownCandidates: [Mutuals.Candidate] {
        guard let focus else { return ranked }
        return ranked.filter { $0.blockers.contains(focus) }
    }

    /// The top of the ranking has been described, so the list can be drawn
    /// once rather than reshuffled as answers come in.
    public var described: Bool {
        shownCandidates.prefix(Self.describeUpTo).allSatisfy { candidate in
            profiles[candidate.did] != nil || missingProfiles.contains(candidate.did) || failedProfiles.contains(candidate.did)
        }
    }

    /// The accounts on show: the ones that still exist.
    public var present: [Mutuals.Candidate] {
        let shown = shownCandidates
        guard !missingProfiles.isEmpty else { return shown }
        return shown.filter { !missingProfiles.contains($0.did) }
    }

    /// Accounts left out because they no longer exist.
    public var goneCount: Int {
        guard !missingProfiles.isEmpty else { return 0 }
        return shownCandidates.filter { missingProfiles.contains($0.did) }.count
    }

    public var rows: [Mutuals.Candidate] {
        Array(present.prefix(shownCount))
    }

    public func flags(_ did: String) -> Mutuals.CandidateFlags {
        Mutuals.CandidateFlags(
            followed: follows.contains(did),
            mutual: mutuals.contains { $0.did == did },
            blocked: ownBlocks?.contains(did) ?? false,
            missing: missingProfiles.contains(did)
        )
    }

    public func isTicked(_ did: String) -> Bool {
        ticks[did] ?? Mutuals.selectedByDefault(flags(did))
    }

    /// The ticked accounts, in ranked order: what the list will hold.
    public var selected: [String] {
        let mutualSet = Set(mutuals.map(\.did))
        return ranked.filter { candidate in
            if let tick = ticks[candidate.did] { return tick }
            let flags = Mutuals.CandidateFlags(
                followed: follows.contains(candidate.did),
                mutual: mutualSet.contains(candidate.did),
                blocked: ownBlocks?.contains(candidate.did) ?? false,
                missing: missingProfiles.contains(candidate.did)
            )
            return Mutuals.selectedByDefault(flags)
        }.map(\.did)
    }

    /// The lists the mutuals block wholesale, most subscribed first.
    public var listSubscriptions: [Mutuals.ListSubscription] {
        guard isDone else { return [] }
        return Mutuals.rankListBlocks(listBlocks)
    }

    /// What the account is called on the page.
    public var name: String {
        account.map { Mutuals.who($0) } ?? ""
    }

    /// The line over the progress bar while the scan runs.
    public var progressLine: String {
        switch phase {
        case .follows:
            return "Listing who \(name) follows: \(Mutuals.count(progress)) of \(Mutuals.count(followsCount))"
        case .mutuals:
            if strategy == .followers {
                return "Listing followers to find the mutuals: \(Mutuals.count(progress)) of \(Mutuals.count(followersCount))"
            }
            return "Checking which follows follow back: \(Mutuals.count(progress)) of \(Mutuals.count(follows.count))"
        case .blocks:
            return "Reading blocks: \(Mutuals.count(progress)) of \(Mutuals.count(mutuals.count)) mutuals, \(Mutuals.count(blocksRead)) records"
        case .resolving:
            return "Looking up \(actor ?? raw)"
        case .idle, .done, .failed:
            return ""
        }
    }

    public var progressRatio: Double {
        let ratio: Double
        switch phase {
        case .follows:
            ratio = followsCount > 0 ? Double(progress) / Double(followsCount) : 0
        case .mutuals:
            let of = strategy == .followers ? followersCount : follows.count
            ratio = of > 0 ? Double(progress) / Double(of) : 0
        case .blocks:
            ratio = mutuals.isEmpty ? 0 : Double(progress) / Double(mutuals.count)
        case .idle, .resolving, .done, .failed:
            ratio = 0
        }
        return min(1, max(0, ratio))
    }

    /// The finished scan's heading.
    public var doneTitle: String {
        mutualsRead == 0 ? "No mutuals\u{2019} blocks could be read for \(name)" : summary
    }

    /// The finished scan's line under the heading.
    public var doneDetail: String {
        if mutuals.isEmpty {
            return "\(name) has no mutuals: nobody they follow follows them back."
        }
        var parts = ["\(name) has \(Mutuals.count(mutuals.count)) \(mutuals.count == 1 ? "mutual" : "mutuals")"]
        if unreadableCount > 0 {
            parts.append("\(Mutuals.count(unreadableCount)) could not be read")
        }
        if stopped {
            parts.append("the scan was stopped with \(Mutuals.count(notReachedCount)) not read to the end")
        }
        if partialMutuals {
            parts.append("only the first 20,000 follows were looked at")
        }
        return parts.joined(separator: "; ") + "."
    }

    /// The list's description: what the person wrote, or the default.
    public var listDescription: String {
        editedDescription ?? Mutuals.defaultListDescription(threshold: threshold, mutualsRead: mutualsRead, date: clock())
    }

    public var listNameProblem: String? {
        Mutuals.listNameProblem(listName)
    }

    public var listDescriptionProblem: String? {
        Mutuals.listDescriptionProblem(listDescription)
    }

    /// The collections the save writes to.
    public var saveCollections: [String] {
        blockAfterSaving
            ? [Mutuals.listCollection, Mutuals.listItemCollection, Mutuals.listBlockCollection]
            : [Mutuals.listCollection, Mutuals.listItemCollection]
    }

    // MARK: - Running

    /// Scan the account a link or the input names. `min` is the threshold
    /// the link kept, if any.
    public func start(_ raw: String, min: String? = nil) {
        cancel()
        self.raw = raw
        askedThreshold = min.flatMap { Mutuals.parseThreshold($0) }
        guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actor = nil
            inputError = nil
            phase = .idle
            return
        }
        switch Mutuals.parseAccountInput(raw) {
        case .invalid(let reason):
            actor = nil
            inputError = reason
            phase = .idle
        case .ok(let parsed):
            actor = parsed
            inputError = nil
            run(parsed)
        }
    }

    /// Read everything again.
    public func rescan() {
        guard actor != nil else { return }
        let kept = askedThreshold
        start(raw)
        askedThreshold = kept
    }

    /// End the scan after the pages in flight, keeping what was read.
    public func stop() {
        guard isRunning else { return }
        stopper.stop()
        isStopping = true
    }

    /// Throw the scan away: the page is going.
    public func cancel() {
        scanTask?.cancel()
        scanTask = nil
        generation += 1
        stopper = MutualsStopper()
        resetScan()
    }

    private func resetScan() {
        phase = .idle
        runError = nil
        account = nil
        followsCount = 0
        followersCount = 0
        strategy = nil
        progress = 0
        partialMutuals = false
        stopped = false
        isStopping = false
        follows = []
        ownBlocks = nil
        mutuals = []
        states = []
        tally = [:]
        listBlocks = [:]
        blocksRead = 0
        counts = [0]
        focus = nil
        shownCount = Self.pageSize
        expanded = nil
        ticks = [:]
        ranked = []
        profiles = [:]
        missingProfiles = []
        failedProfiles = []
        lists = [:]
        askedProfiles = []
        askedLists = false
        liveRecords = [:]
        editedDescription = nil
        resetSaving()
    }

    private func run(_ actor: String) {
        let gen = generation
        phase = .resolving
        scanTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.scan(actor, gen: gen)
            } catch {
                guard gen == self.generation, !(error is CancellationError) else { return }
                self.runError = (error as? MutualsError)?.message ?? ExploreErrorText.describe(error)
                self.phase = .failed
            }
        }
    }

    /// Whether the scan `gen` is still the page's, after an await.
    private func check(_ gen: Int) throws {
        if gen != generation || Task.isCancelled { throw CancellationError() }
    }

    private func scan(_ actor: String, gen: Int) async throws {
        let client = self.client
        let stopper = self.stopper
        let loaded = try await client.loadAccount(actor)
        try check(gen)
        account = loaded.account
        followsCount = loaded.followsCount
        followersCount = loaded.followersCount
        let did = loaded.account.did

        // The account's own blocks, read beside everything else.
        async let own = client.readOwnBlocks(did)

        phase = .follows
        progress = 0
        var people: [MutualsPerson] = []
        var cursor: String?
        var partial = true
        for _ in 0..<Mutuals.graphPageLimit {
            if stopper.isStopped { break }
            let page = try await client.followsPage(did, cursor: cursor)
            try check(gen)
            people.append(contentsOf: page.people)
            progress = people.count
            guard let next = page.cursor else {
                partial = false
                break
            }
            cursor = next
        }
        follows = Set(people.map(\.did))
        partialMutuals = partial && !stopper.isStopped

        let chosen = Mutuals.mutualStrategy(follows: people.count, followers: followersCount)
        strategy = chosen
        phase = .mutuals
        progress = 0

        let others = people.filter { $0.did != did }
        var back = Set<String>()
        if chosen == .followers {
            var followerCursor: String?
            var followersPartial = true
            for _ in 0..<Mutuals.graphPageLimit {
                if stopper.isStopped { break }
                let page = try await client.followersPage(did, cursor: followerCursor)
                try check(gen)
                back.formUnion(page.dids)
                progress = back.count
                guard let next = page.cursor else {
                    followersPartial = false
                    break
                }
                followerCursor = next
            }
            if followersPartial, !stopper.isStopped {
                partialMutuals = true
            }
        } else {
            back = try await followBacks(did, others: others.map(\.did), gen: gen)
        }

        mutuals = others.filter { back.contains($0.did) }
        states = Array(repeating: .queued, count: mutuals.count)
        phase = .blocks
        progress = 0

        try await readMutuals(scanned: did, gen: gen)

        for index in states.indices where states[index].isQueued {
            states[index] = .skipped(blocks: 0, reason: "stopped before it was read", stopped: true)
        }
        let ownBlocks = await own
        try check(gen)
        self.ownBlocks = ownBlocks
        stopped = stopper.isStopped
        isStopping = false
        phase = .done
        rerank()
    }

    /// Which follows follow back, thirty at a time, a few requests at once.
    private func followBacks(_ did: String, others: [String], gen: Int) async throws -> Set<String> {
        let chunks = Mutuals.chunk(others, size: Mutuals.relationshipsChunk)
        guard !chunks.isEmpty else { return [] }
        let client = self.client
        let stopper = self.stopper
        var back = Set<String>()
        var checked = 0
        try await withThrowingTaskGroup(of: (count: Int, back: [String]).self) { group in
            var next = 0
            func enqueue() {
                let chunk = chunks[next]
                next += 1
                group.addTask {
                    if stopper.isStopped { return (count: 0, back: []) }
                    let found = try await client.followBacks(did, others: chunk)
                    return (count: chunk.count, back: found)
                }
            }
            for _ in 0..<min(Self.appViewConcurrency, chunks.count) {
                enqueue()
            }
            while let result = try await group.next() {
                try self.check(gen)
                back.formUnion(result.back)
                checked += result.count
                self.progress = checked
                if next < chunks.count {
                    enqueue()
                }
            }
        }
        return back
    }

    /// Each mutual's blocks and the lists it blocks, six at a time.
    private func readMutuals(scanned: String, gen: Int) async throws {
        let client = self.client
        let stopper = self.stopper
        let people = mutuals
        guard !people.isEmpty else { return }
        try await withThrowingTaskGroup(of: (index: Int, result: MutualsReadResult).self) { group in
            var next = 0
            // Returns the index it started. The state change is made by the
            // caller, in the group's body, which runs on the main actor; a
            // nested function does not inherit that isolation.
            func enqueue() -> Int {
                let index = next
                next += 1
                let did = people[index].did
                // Each page's count, back on the main actor. A late one is
                // dropped once the mutual has its final state.
                let report: @Sendable (Int, Int) -> Void = { blocks, records in
                    Task { @MainActor in
                        self.noteReading(index, blocks: blocks, records: records, gen: gen)
                    }
                }
                group.addTask {
                    let result = try await client.readMutual(did, scanned: scanned, stopper: stopper, onProgress: report)
                    return (index: index, result: result)
                }
                return index
            }
            for _ in 0..<min(Self.mutualConcurrency, people.count) {
                let started = enqueue()
                self.states[started] = .reading(blocks: 0)
            }
            while let finished = try await group.next() {
                try self.check(gen)
                self.record(finished.index, finished.result)
                if next < people.count, !stopper.isStopped {
                    let started = enqueue()
                    self.states[started] = .reading(blocks: 0)
                }
            }
        }
    }

    /// A page of a mutual's blocks arrived while it is still being read.
    private func noteReading(_ index: Int, blocks: Int, records: Int, gen: Int) {
        guard gen == generation, states.indices.contains(index), case .reading = states[index] else { return }
        states[index] = .reading(blocks: blocks)
        let before = liveRecords[index] ?? 0
        if records > before {
            liveRecords[index] = records
            blocksRead += records - before
        }
    }

    /// One mutual read to the end (or as far as it went): its blocks into the tally.
    private func record(_ index: Int, _ result: MutualsReadResult) {
        var newCounts = counts
        var seen = Set<String>()
        for subject in result.subjects {
            guard Mutuals.tallyBlock(&tally, seen: &seen, mutual: index, subject: subject) else { continue }
            // The account moves from k blockers to k + 1.
            let after = tally[subject]?.count ?? 1
            if after > 1 {
                newCounts[after - 1] -= 1
            }
            while newCounts.count <= after {
                newCounts.append(0)
            }
            newCounts[after] += 1
        }
        counts = newCounts
        var lists = Set<String>()
        for uri in result.listSubjects {
            Mutuals.tallyBlock(&listBlocks, seen: &lists, mutual: index, subject: uri)
        }
        let live = liveRecords.removeValue(forKey: index) ?? 0
        blocksRead += result.records - live
        states[index] = result.state
        progress += 1
    }

    // MARK: - The view of the tally

    /// Set the threshold: everything follows.
    public func setThreshold(_ value: Int) {
        let clamped = max(1, value)
        guard clamped != threshold || askedThreshold == nil else { return }
        askedThreshold = clamped
        shownCount = Self.pageSize
        rerank()
    }

    /// Show only the accounts one mutual blocks, or everyone again.
    public func setFocus(_ index: Int?) {
        focus = index
        shownCount = Self.pageSize
        ensureProfiles()
    }

    public func showMore() {
        shownCount += Self.pageSize
        ensureProfiles()
    }

    public func toggleExpanded(_ did: String) {
        expanded = expanded == did ? nil : did
    }

    public func tick(_ did: String, _ value: Bool) {
        ticks[did] = value
    }

    /// Tick or untick every account on show.
    public func tickAll(_ value: Bool) {
        for candidate in present {
            ticks[candidate.did] = value
        }
    }

    /// Forget the ticks changed by hand.
    public func resetTicks() {
        ticks = [:]
    }

    private func rerank() {
        guard isDone else { return }
        ranked = Mutuals.rankCandidates(tally, threshold: threshold)
        ensureProfiles()
        ensureLists()
    }

    /// Profiles for the top of the ranking, and for every row shown past it.
    /// Requests are not cancelled when what is wanted changes, only ignored
    /// once the scan they were for is no longer the one on the page.
    private func ensureProfiles() {
        guard isDone else { return }
        let limit = max(Self.describeUpTo, shownCount + Self.pageSize)
        let wanted = shownCandidates.prefix(limit).map(\.did).filter { did in
            !askedProfiles.contains(did) && profiles[did] == nil && !missingProfiles.contains(did) && !failedProfiles.contains(did)
        }
        guard !wanted.isEmpty else { return }
        askedProfiles.formUnion(wanted)
        let gen = generation
        let client = self.client
        Task { [weak self] in
            let answer = await client.loadProfiles(wanted)
            guard let self, gen == self.generation else { return }
            for did in wanted {
                if let person = answer.profiles[did] {
                    self.profiles[did] = person
                } else if answer.failed.contains(did) {
                    self.failedProfiles.insert(did)
                } else {
                    self.missingProfiles.insert(did)
                }
            }
        }
    }

    private func ensureLists() {
        guard isDone, !askedLists else { return }
        let uris = Array(listSubscriptions.prefix(Self.listsShown).map(\.uri))
        guard !uris.isEmpty else { return }
        askedLists = true
        let gen = generation
        let client = self.client
        Task { [weak self] in
            let described = await client.describeLists(uris)
            guard let self, gen == self.generation else { return }
            self.lists = described
        }
    }

    // MARK: - Saving

    /// Whether the signed-in session's scope lets it write the list: nil
    /// when the scope is not known, which means try and say so if refused.
    public func scopeAllows(_ scope: String?) -> Bool? {
        Mutuals.scopeAllowsCreate(scope, collections: saveCollections)
    }

    /// Write points the save costs.
    public var savePoints: Int {
        Mutuals.savePoints(members: selected.count, block: blockAfterSaving)
    }

    /// Save the ticked accounts as a new moderation list.
    public func save(with writer: MutualsListWriter) {
        guard saving?.running != true else { return }
        let subjects = selected
        guard !subjects.isEmpty, listNameProblem == nil, listDescriptionProblem == nil else { return }
        write(subjects, listUri: nil, writer: writer)
    }

    /// Add what a stopped or refused save left out to the same list.
    public func addRemaining(with writer: MutualsListWriter) {
        guard let saving, !saving.running, let uri = saving.listUri, let outcome = saving.outcome, !outcome.remaining.isEmpty else { return }
        write(outcome.remaining, listUri: uri, writer: writer)
    }

    /// Stop the save after the batch in flight.
    public func stopSaving() {
        saveStopped = true
    }

    /// Put the save away, to make another list.
    public func resetSaving() {
        saveTask?.cancel()
        saveTask = nil
        saveStopped = false
        saving = nil
    }

    private func write(_ subjects: [String], listUri: String?, writer: MutualsListWriter) {
        let already = saving?.blocked ?? false
        let name = listName
        let description = listDescription
        let block = blockAfterSaving
        let throttle = self.throttle
        let sleep = self.sleep
        saveStopped = false
        saving = MutualsSaving(listUri: listUri, progress: nil, outcome: nil, blocked: already, blockError: nil, error: nil, running: true)
        saveTask = Task { [weak self] in
            var uri = listUri
            if uri == nil {
                do {
                    uri = try await MutualsSave.createModList(writer: writer, name: name, description: description, throttle: throttle)
                } catch {
                    guard let self else { return }
                    self.saving?.error = MutualsSave.describe(error)
                    self.saving?.running = false
                    return
                }
                self?.saving?.listUri = uri
            }
            guard let listAt = uri else { return }
            let outcome = await MutualsSave.addMembers(
                writer: writer,
                list: listAt,
                subjects: subjects,
                throttle: throttle,
                sleep: sleep,
                isStopped: { self?.saveStopped ?? true },
                onProgress: { progress in self?.saving?.progress = progress }
            )
            var blocked = already
            var blockError: String?
            if block, !already, outcome.remaining.isEmpty {
                do {
                    try await MutualsSave.blockList(writer: writer, list: listAt, throttle: throttle)
                    blocked = true
                } catch {
                    blockError = MutualsSave.describe(error)
                }
            }
            guard let self else { return }
            self.saving?.listUri = listAt
            self.saving?.outcome = outcome
            self.saving?.blocked = blocked
            self.saving?.blockError = blockError
            self.saving?.running = false
        }
    }
}
