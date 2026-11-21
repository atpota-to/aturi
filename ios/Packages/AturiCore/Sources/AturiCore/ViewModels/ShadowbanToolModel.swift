import Foundation
import Observation

/// The shadowban checker tool's run, port of `useVisibilityCheck` in
/// `src/components/tools/checkRuns.ts` as `ShadowbanChecker.tsx` drives it.
///
/// The explorer's `AccountChecksModel` runs this check for an account on
/// Bluesky's AppView. The tool page also checks a post, and on any AppView,
/// so it keeps a run of its own: the evidence published step by step as
/// `ShadowbanClient.investigate` gathers it, which is what fills the checks
/// in as they come back.
@MainActor
@Observable
public final class ShadowbanToolModel {
    public typealias Run<Value> = AccountChecksModel.Run<Value>

    public private(set) var target: Shadowban.ShadowbanTarget?
    public private(set) var appview: Shadowban.AppView?
    public private(set) var run: Run<Shadowban.Evidence> = .init()

    @ObservationIgnored private let client: ShadowbanClient
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared, resolver: IdentityResolver? = nil, clock: @escaping () -> Date = { Date() }) {
        client = ShadowbanClient(http: http, resolver: resolver)
        self.clock = clock
    }

    /// Check a subject on an AppView. The same pair already checked, or
    /// being checked, is left as it is; a failed check is tried again.
    public func check(_ target: Shadowban.ShadowbanTarget, appview: Shadowban.AppView) {
        if target == self.target, appview == self.appview, run.status == .loading || run.status == .done {
            return
        }
        self.target = target
        self.appview = appview
        start()
    }

    /// "Check again", and Retry after a failure.
    public func recheck() {
        start()
    }

    /// Forget the subject, for a cleared field.
    public func clear() {
        generation += 1
        task?.cancel()
        target = nil
        appview = nil
        run = .init()
    }

    private func start() {
        generation += 1
        task?.cancel()
        guard let target, let appview else {
            run = .init()
            return
        }
        let gen = generation
        let started = clock()
        // `investigate` publishes the bare evidence before its first
        // request, so the six checks show as pending straight away.
        run = .init(status: .loading)
        let client = client
        task = Task { [weak self] in
            do {
                let evidence = try await client.investigate(
                    target: target,
                    appview: appview,
                    identity: nil,
                    now: started
                ) { snapshot in
                    self?.publish(gen, snapshot)
                }
                self?.finish(gen, evidence)
            } catch {
                self?.fail(gen, error)
            }
        }
    }

    private func publish(_ gen: Int, _ evidence: Shadowban.Evidence) {
        guard gen == generation else { return }
        run = .init(status: .loading, data: evidence)
    }

    private func finish(_ gen: Int, _ evidence: Shadowban.Evidence) {
        guard gen == generation else { return }
        run = .init(status: .done, data: evidence, settledAt: clock())
    }

    private func fail(_ gen: Int, _ error: Error) {
        guard gen == generation, !(error is CancellationError) else { return }
        run = .init(status: .error, data: run.data, error: AccountCheckError.describe(error), settledAt: clock())
    }

    /// Wait for the run in flight. For tests.
    func waitForRun() async {
        await task?.value
    }
}
