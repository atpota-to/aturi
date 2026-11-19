import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The label and visibility checks of an account, port of
// src/components/explore/useAccountChecks.ts and the shared runs under it
// (src/lib/tools/runCache.ts, src/components/tools/checkRuns.ts).
//
// The account card's two rows, the repo page's Labels and Visibility tabs
// and the author card on a record page all read one `AccountChecksModel`
// per DID, handed out by `AccountChecksStore`, so they share the requests
// instead of each sending their own: one first label answer, one scan of
// every labeler and one visibility run per account, kept ten minutes.
//
// Three runs, as on the web:
//
//   - Labels, first answer: Bluesky's moderation service, which also says
//     whether Bluesky has the account at all.
//   - Labels, scan: every labeler the relay lists, as soon as the first
//     answer is in and Bluesky described the account.
//   - Visibility: waits for the first label answer, a few hundred
//     milliseconds, which keeps its twenty or so requests out of the way of
//     the page's own first ones, and is skipped when Bluesky has no profile
//     for the account or it is deactivated (plan D4 and D5).
//
// A run nobody is watching is not worth finishing: when the last view lets
// go of an account with a run in flight, the run is cancelled after a short
// grace, long enough for a view to come straight back to it (a tab switch,
// a push and pop) without starting over.

@MainActor
@Observable
public final class AccountChecksModel {
    /// Ten minutes: long enough to come back to an account, short enough to
    /// stay current. `SHARED_RUN_TTL`.
    public nonisolated static let ttl: TimeInterval = 10 * 60
    /// How long an unwatched, unsettled run is given before it is cancelled.
    public nonisolated static let defaultGrace: TimeInterval = 2

    public enum RunStatus: String, Hashable, Sendable {
        case idle
        case loading
        case done
        case error
    }

    /// One run's state, `RunSnapshot` with the hook's `idle`.
    public struct Run<Value> {
        public var status: RunStatus
        /// What the run has published so far, or its result. A failed run
        /// keeps what it had.
        public var data: Value?
        public var error: String?
        /// When the run settled. Nil while it runs.
        public var settledAt: Date?

        public init(status: RunStatus = .idle, data: Value? = nil, error: String? = nil, settledAt: Date? = nil) {
            self.status = status
            self.data = data
            self.error = error
            self.settledAt = settledAt
        }
    }

    /// Where the label check has got to, for the card's row.
    public enum LabelCheckState: Hashable, Sendable {
        case asking
        case scanning(summary: AccountChecks.LabelSummary, progress: Labels.ScanProgress?)
        case done(summary: AccountChecks.LabelSummary, progress: Labels.ScanProgress, stopped: Bool, settledAt: Date?)
        /// Bluesky would not describe the account at all.
        case absent(absence: AccountChecks.ProfileAbsence, message: String)
        case error(message: String, summary: AccountChecks.LabelSummary?)
    }

    /// Where the visibility check has got to.
    public enum VisibilityCheckState: Hashable, Sendable {
        /// Waiting for the label check's first answer, which says whether to run.
        case waiting
        /// Nothing for an AppView to hide (no Bluesky profile, or deactivated).
        case absent(AccountChecks.ProfileAbsence)
        case running(AccountChecks.VisibilitySummary)
        case done(AccountChecks.VisibilitySummary, settledAt: Date?)
        case error(message: String)
    }

    public let identity: IdentityBundle
    public var did: String { identity.did }

    public private(set) var base: Run<LabelsClient.BaseResult> = Run()
    public private(set) var scan: Run<LabelsClient.ScanResult> = Run()
    public private(set) var visibility: Run<Shadowban.Evidence> = Run()

    @ObservationIgnored private let labelsClient: LabelsClient
    @ObservationIgnored private let shadowbanClient: ShadowbanClient
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let grace: TimeInterval
    @ObservationIgnored private var baseTask: Task<Void, Never>?
    @ObservationIgnored private var scanTask: Task<Void, Never>?
    @ObservationIgnored private var visibilityTask: Task<Void, Never>?
    @ObservationIgnored private var scanControl: LabelScanControl?
    @ObservationIgnored private var baseGeneration = 0
    @ObservationIgnored private var scanGeneration = 0
    @ObservationIgnored private var visibilityGeneration = 0
    @ObservationIgnored private var watchers = 0
    @ObservationIgnored private var abortTask: Task<Void, Never>?

    public init(
        identity: IdentityBundle,
        http: HTTPClient = .shared,
        clock: @escaping () -> Date = { Date() },
        grace: TimeInterval = AccountChecksModel.defaultGrace
    ) {
        self.identity = identity
        labelsClient = LabelsClient(http: http)
        shadowbanClient = ShadowbanClient(http: http)
        self.clock = clock
        self.grace = grace
    }

    // MARK: Watching

    /// A view showing this account's checks appeared: keep its runs going,
    /// and start (or retry, or refresh) whatever it needs.
    public func retain() {
        watchers += 1
        abortTask?.cancel()
        abortTask = nil
        ensure()
    }

    /// That view went away. With nobody left watching, a run still in
    /// flight is cancelled after the grace.
    public func release() {
        watchers = max(0, watchers - 1)
        guard watchers == 0, isRunning else { return }
        abortTask?.cancel()
        let delay = UInt64(max(0, grace) * 1_000_000_000)
        abortTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            self?.abortUnwatched()
        }
    }

    /// Any of the three runs is in flight.
    public var isRunning: Bool {
        base.status == .loading || scan.status == .loading || visibility.status == .loading
    }

    /// Nobody is watching and nothing kept is worth keeping: the store drops
    /// such a model rather than hold every account ever opened.
    var isDisposable: Bool {
        guard watchers == 0, !isRunning else { return false }
        let settled = [base.settledAt, scan.settledAt, visibility.settledAt].compactMap { $0 }
        guard let newest = settled.max() else { return true }
        return clock().timeIntervalSince(newest) >= Self.ttl
    }

    private func abortUnwatched() {
        abortTask = nil
        guard watchers == 0 else { return }
        // An unsettled run is dropped, so the next view to ask starts it
        // over; a settled one is kept for the TTL.
        if base.status == .loading {
            baseGeneration += 1
            baseTask?.cancel()
            base = Run()
        }
        if scan.status == .loading {
            scanGeneration += 1
            scanTask?.cancel()
            scan = Run()
        }
        if visibility.status == .loading {
            visibilityGeneration += 1
            visibilityTask?.cancel()
            visibility = Run()
        }
    }

    // MARK: Runs

    /// No run, a failed run, or a result older than the TTL: start one.
    private func needsRun<Value>(_ run: Run<Value>) -> Bool {
        switch run.status {
        case .idle, .error:
            return true
        case .loading:
            return false
        case .done:
            guard let settledAt = run.settledAt else { return false }
            return clock().timeIntervalSince(settledAt) >= Self.ttl
        }
    }

    /// Make sure every run this account needs is going or kept. A new first
    /// answer starts the other two over, since both follow from it.
    public func ensure() {
        if needsRun(base) {
            startBase()
            return
        }
        advance()
    }

    /// The first label answer is in: start the scan when Bluesky described
    /// the account, and the visibility check when there is anything to compare.
    private func advance() {
        guard base.status == .done || base.status == .error else { return }
        if base.status == .done, let data = base.data, data.unavailable == nil, needsRun(scan) {
            startScan(data)
        }
        if AccountChecks.visibilityApplies(absence), needsRun(visibility) {
            startVisibility()
        }
    }

    /// Why Bluesky would not describe the account, once the first answer says so.
    public var absence: AccountChecks.ProfileAbsence? {
        guard let unavailable = base.data?.unavailable else { return nil }
        return AccountChecks.profileAbsence(unavailable)
    }

    private func startBase() {
        baseGeneration += 1
        scanGeneration += 1
        visibilityGeneration += 1
        baseTask?.cancel()
        scanTask?.cancel()
        visibilityTask?.cancel()
        scan = Run()
        visibility = Run()
        base = Run(status: .loading)
        let gen = baseGeneration
        let client = labelsClient
        let target = Labels.LabelTarget.account(actor: did)
        baseTask = Task { [weak self] in
            do {
                let result = try await client.checkBase(target: target)
                self?.finishBase(gen, result)
            } catch {
                self?.failBase(gen, error)
            }
        }
    }

    private func finishBase(_ gen: Int, _ result: LabelsClient.BaseResult) {
        guard gen == baseGeneration else { return }
        base = Run(status: .done, data: result, settledAt: clock())
        advance()
    }

    private func failBase(_ gen: Int, _ error: Error) {
        guard gen == baseGeneration, !(error is CancellationError) else { return }
        base = Run(status: .error, error: AccountCheckError.describe(error), settledAt: clock())
        advance()
    }

    private func startScan(_ data: LabelsClient.BaseResult) {
        scanGeneration += 1
        scanTask?.cancel()
        let gen = scanGeneration
        let control = LabelScanControl()
        scanControl = control
        scan = Run(status: .loading)
        let client = labelsClient
        scanTask = Task { [weak self] in
            do {
                let result = try await client.scanEveryLabeler(base: data, control: control) { snapshot in
                    self?.publishScan(gen, snapshot)
                }
                self?.finishScan(gen, result)
            } catch {
                self?.failScan(gen, error)
            }
        }
    }

    private func publishScan(_ gen: Int, _ snapshot: LabelsClient.ScanResult) {
        guard gen == scanGeneration else { return }
        scan = Run(status: .loading, data: snapshot)
    }

    private func finishScan(_ gen: Int, _ result: LabelsClient.ScanResult) {
        guard gen == scanGeneration else { return }
        scan = Run(status: .done, data: result, settledAt: clock())
    }

    private func failScan(_ gen: Int, _ error: Error) {
        guard gen == scanGeneration, !(error is CancellationError) else { return }
        scan = Run(status: .error, data: scan.data, error: AccountCheckError.describe(error), settledAt: clock())
    }

    private func startVisibility() {
        visibilityGeneration += 1
        visibilityTask?.cancel()
        let gen = visibilityGeneration
        visibility = Run(status: .loading)
        let client = shadowbanClient
        let target = Shadowban.ShadowbanTarget.account(actor: did)
        let known = Shadowban.Identity(bundle: identity)
        let started = clock()
        visibilityTask = Task { [weak self] in
            do {
                let evidence = try await client.investigate(
                    target: target,
                    appview: Shadowban.defaultAppView,
                    identity: known,
                    now: started
                ) { snapshot in
                    self?.publishVisibility(gen, snapshot)
                }
                self?.finishVisibility(gen, evidence)
            } catch {
                self?.failVisibility(gen, error)
            }
        }
    }

    private func publishVisibility(_ gen: Int, _ evidence: Shadowban.Evidence) {
        guard gen == visibilityGeneration else { return }
        visibility = Run(status: .loading, data: evidence)
    }

    private func finishVisibility(_ gen: Int, _ evidence: Shadowban.Evidence) {
        guard gen == visibilityGeneration else { return }
        visibility = Run(status: .done, data: evidence, settledAt: clock())
    }

    private func failVisibility(_ gen: Int, _ error: Error) {
        guard gen == visibilityGeneration, !(error is CancellationError) else { return }
        visibility = Run(status: .error, data: visibility.data, error: AccountCheckError.describe(error), settledAt: clock())
    }

    // MARK: Actions

    /// Retry on the Labels row: the first answer if that failed, else the scan.
    public func retryLabels() {
        if base.status == .error {
            startBase()
        } else if let data = base.data, data.unavailable == nil {
            startScan(data)
        }
    }

    /// "Scan again" in the Labels tab.
    public func rescan() {
        guard base.status == .done, let data = base.data, data.unavailable == nil else { return }
        startScan(data)
    }

    /// "Stop" in the Labels tab: end the scan early and keep what it found.
    public func stopScan() {
        guard scan.status == .loading else { return }
        scanControl?.stop()
    }

    /// Retry on the Visibility row, and "Check again" in its tab.
    public func recheckVisibility() {
        guard base.status == .done || base.status == .error, AccountChecks.visibilityApplies(absence) else { return }
        startVisibility()
    }

    /// Cancel everything, for a pull to refresh that starts over.
    public func restart() {
        startBase()
    }

    /// Wait for the runs in flight, the ones they start included. For tests.
    func waitForRuns() async {
        await baseTask?.value
        await scanTask?.value
        await visibilityTask?.value
    }

    // MARK: What the card says

    /// The label check as the card's row draws it.
    public func labelState(now: Date) -> LabelCheckState {
        switch base.status {
        case .error:
            return .error(message: base.error ?? "Something went wrong", summary: nil)
        case .idle, .loading:
            return .asking
        case .done:
            break
        }
        guard let baseData = base.data else { return .asking }
        if let unavailable = baseData.unavailable {
            return .absent(absence: AccountChecks.profileAbsence(unavailable), message: unavailable)
        }
        let merged = Labels.mergeLabels(baseData.labels, scan.data?.labels ?? [])
        let summary = AccountChecks.labelSummary(merged, subjectDid: did, now: now)
        switch scan.status {
        case .error:
            return .error(message: scan.error ?? "Something went wrong", summary: summary)
        case .done:
            guard let data = scan.data else { return .scanning(summary: summary, progress: nil) }
            return .done(summary: summary, progress: data.progress, stopped: data.stopped, settledAt: scan.settledAt)
        case .idle, .loading:
            return .scanning(summary: summary, progress: scan.data?.progress)
        }
    }

    /// The visibility check as the card's row draws it.
    public func visibilityState(now: Date) -> VisibilityCheckState {
        if let absence, !AccountChecks.visibilityApplies(absence) {
            return .absent(absence)
        }
        switch visibility.status {
        case .idle:
            return .waiting
        case .error:
            return .error(message: visibility.error ?? "Something went wrong")
        case .loading, .done:
            // The checker measures its grace periods from when the run
            // started; the summary does the same, so the card and the tab agree.
            let evidence = visibility.data
                ?? Shadowban.Evidence(target: .account(actor: did), appview: Shadowban.defaultAppView)
            let summary = AccountChecks.visibilitySummary(evidence, now: evidence.checkedAt ?? now)
            if visibility.status == .done {
                return .done(summary, settledAt: visibility.settledAt)
            }
            return .running(summary)
        }
    }

    /// Every label found so far, the first answer and the scan together.
    public var allLabels: [Labels.Label] {
        Labels.mergeLabels(base.data?.labels ?? [], scan.data?.labels ?? [])
    }

    /// Everyone named so far: the labelers asked first, and those the scan found.
    public var labelers: [String: LabelsClient.LabelerInfo] {
        var out = base.data?.labelers ?? [:]
        for (did, info) in scan.data?.labelers ?? [:] {
            out[did] = info
        }
        return out
    }
}

/// The shared runs: one `AccountChecksModel` per DID, so every view of an
/// account joins the same three runs. Port of the page's one `RunCache`.
@MainActor
public final class AccountChecksStore {
    public static let shared = AccountChecksStore()

    private var models: [String: AccountChecksModel] = [:]
    private let http: HTTPClient
    private let clock: () -> Date
    private let grace: TimeInterval

    public init(
        http: HTTPClient = .shared,
        clock: @escaping () -> Date = { Date() },
        grace: TimeInterval = AccountChecksModel.defaultGrace
    ) {
        self.http = http
        self.clock = clock
        self.grace = grace
    }

    /// The account's model, kept from earlier when there is one. Views call
    /// `retain()` on it when they appear, which starts what it needs.
    public func model(for identity: IdentityBundle) -> AccountChecksModel {
        prune()
        if let existing = models[identity.did] {
            return existing
        }
        let model = AccountChecksModel(identity: identity, http: http, clock: clock, grace: grace)
        models[identity.did] = model
        return model
    }

    /// Drop the models nobody is watching whose results are past the TTL.
    private func prune() {
        models = models.filter { !$0.value.isDisposable }
    }

    /// How many accounts are kept. For tests.
    var count: Int { models.count }
}
