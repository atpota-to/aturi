import Foundation
import Observation

/// The label checker tool's two runs, port of `useLabelCheck` in
/// `src/components/tools/checkRuns.ts` as `LabelChecker.tsx` drives it.
///
/// The explorer's `AccountChecksModel` runs the same two for an account
/// with Bluesky's labeler only, and starts the visibility check beside
/// them. The tool page asks about posts too, and about labelers added by
/// hand, and has no visibility check to start, so it keeps its own runs:
///
///   - The first answer: Bluesky's labeler, the subject's self-labels and
///     any labelers added by hand (`LabelsClient.checkBase`).
///   - The scan of every labeler, which starts as soon as the first answer
///     is in and the AppView described the subject. Stop ends it early and
///     keeps what it found.
@MainActor
@Observable
public final class LabelsToolModel {
    public typealias Run<Value> = AccountChecksModel.Run<Value>

    /// What is being checked, and the labelers added to it.
    public private(set) var target: Labels.LabelTarget?
    public private(set) var added: [String] = []
    public private(set) var base: Run<LabelsClient.BaseResult> = .init()
    public private(set) var scan: Run<LabelsClient.ScanResult> = .init()

    @ObservationIgnored private let client: LabelsClient
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var baseTask: Task<Void, Never>?
    @ObservationIgnored private var scanTask: Task<Void, Never>?
    @ObservationIgnored private var scanControl: LabelScanControl?
    @ObservationIgnored private var baseGeneration = 0
    @ObservationIgnored private var scanGeneration = 0

    public init(http: HTTPClient = .shared, resolver: IdentityResolver? = nil, clock: @escaping () -> Date = { Date() }) {
        client = LabelsClient(http: http, resolver: resolver)
        self.clock = clock
    }

    // MARK: Runs

    /// Check a subject with these labelers added. The same subject and
    /// labelers already checked, or being checked, are left as they are; a
    /// failed check is tried again.
    public func check(_ target: Labels.LabelTarget, added: [String]) {
        if target == self.target, added == self.added, base.status == .loading || base.status == .done {
            return
        }
        self.target = target
        self.added = added
        startBase()
    }

    /// Forget the subject, for a cleared field.
    public func clear() {
        baseGeneration += 1
        scanGeneration += 1
        baseTask?.cancel()
        scanTask?.cancel()
        target = nil
        added = []
        base = .init()
        scan = .init()
    }

    private func startBase() {
        scanGeneration += 1
        scanTask?.cancel()
        scan = .init()
        baseGeneration += 1
        baseTask?.cancel()
        guard let target else {
            base = .init()
            return
        }
        base = .init(status: .loading)
        let gen = baseGeneration
        let client = client
        let added = added
        baseTask = Task { [weak self] in
            do {
                let result = try await client.checkBase(target: target, addedValues: added)
                self?.finishBase(gen, result)
            } catch {
                self?.failBase(gen, error)
            }
        }
    }

    private func finishBase(_ gen: Int, _ result: LabelsClient.BaseResult) {
        guard gen == baseGeneration else { return }
        base = .init(status: .done, data: result, settledAt: clock())
        if result.unavailable == nil {
            startScan(result)
        }
    }

    private func failBase(_ gen: Int, _ error: Error) {
        guard gen == baseGeneration, !(error is CancellationError) else { return }
        base = .init(status: .error, error: AccountCheckError.describe(error), settledAt: clock())
    }

    private func startScan(_ data: LabelsClient.BaseResult) {
        scanGeneration += 1
        scanTask?.cancel()
        let gen = scanGeneration
        let control = LabelScanControl()
        scanControl = control
        scan = .init(status: .loading)
        let client = client
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
        scan = .init(status: .loading, data: snapshot)
    }

    private func finishScan(_ gen: Int, _ result: LabelsClient.ScanResult) {
        guard gen == scanGeneration else { return }
        scan = .init(status: .done, data: result, settledAt: clock())
    }

    private func failScan(_ gen: Int, _ error: Error) {
        guard gen == scanGeneration, !(error is CancellationError) else { return }
        scan = .init(status: .error, data: scan.data, error: AccountCheckError.describe(error), settledAt: clock())
    }

    // MARK: Actions

    /// Retry after the first answer failed.
    public func retry() {
        startBase()
    }

    /// "Scan again".
    public func rescan() {
        guard base.status == .done, let data = base.data, data.unavailable == nil else { return }
        startScan(data)
    }

    /// "Stop": end the scan early and keep what it found.
    public func stopScan() {
        guard scan.status == .loading else { return }
        scanControl?.stop()
    }

    /// Wait for the runs in flight, the scan the first answer starts
    /// included. For tests.
    func waitForRuns() async {
        await baseTask?.value
        await scanTask?.value
    }

    // MARK: What the page reads

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

    /// The scan is going, or about to start once the first answer is in.
    public var isScanning: Bool {
        scan.status == .loading || (scan.status == .idle && base.status == .done && base.data?.unavailable == nil)
    }
}
