import Foundation
import Observation

/// The activity calendar tool's state, port of the run in
/// `src/components/tools/ActivityCalendar.tsx` (`useToolRun` around
/// `scanActivity`). The reading is in `ActivityCalendarScan`; this starts a
/// read for an account, keeps what it has published, and carries Stop.
///
/// Reading further back starts a new run, which has nothing to show until
/// its first page lands, so the calendar already on screen is kept until
/// then, as the web keeps it.
@MainActor
@Observable
public final class ActivityCalendarModel {
    public enum Status: String, Hashable, Sendable {
        case idle
        case loading
        case done
        case failed
    }

    public private(set) var status: Status = .idle
    /// The account being read, as normalized from the input.
    public private(set) var actor: String?
    /// What the run has published so far, or its result. Kept from the
    /// previous run of the same account until the new one publishes.
    public private(set) var scan: ActivityCalendarScan.Snapshot?
    public private(set) var errorMessage: String?

    @ObservationIgnored private let http: HTTPClient
    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let store: ActivityCalendarStore?
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var stopper: ActivityCalendarStopper?
    @ObservationIgnored private var generation = 0

    /// The shared HTTP client uses the shared resolver and store; any other
    /// gets its own, so a test never sees another test's cache.
    public init(
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        store: ActivityCalendarStore? = nil,
        clock: @escaping () -> Date = { Date() },
        calendar: Calendar = .current
    ) {
        self.http = http
        let shared = http === HTTPClient.shared
        self.resolver = resolver ?? (shared ? .shared : IdentityResolver(http: http))
        if let store {
            self.store = store
        } else if shared {
            self.store = nil
        } else {
            self.store = ActivityCalendarStore()
        }
        self.clock = clock
        self.calendar = calendar
    }

    public var isRunning: Bool { status == .loading }

    /// Read an account's year, unless that account is already read or
    /// being read.
    public func load(_ actor: String) {
        if actor == self.actor, status == .loading || status == .done { return }
        start(actor)
    }

    /// Run the same account again: "Read further back", "Continue reading",
    /// "Try those again", and Retry after a failure. What was read is kept
    /// by the store, so this resumes rather than starts over.
    public func rerun() {
        guard let actor else { return }
        start(actor)
    }

    /// End the read after the requests in flight, keeping what it found.
    public func stop() {
        guard status == .loading else { return }
        stopper?.stop()
    }

    /// Forget the input, for a cleared field.
    public func clear() {
        generation += 1
        task?.cancel()
        task = nil
        stopper = nil
        actor = nil
        scan = nil
        errorMessage = nil
        status = .idle
    }

    private func start(_ actor: String) {
        generation += 1
        let gen = generation
        task?.cancel()
        if actor != self.actor {
            scan = nil
        }
        self.actor = actor
        status = .loading
        errorMessage = nil

        let stopper = ActivityCalendarStopper()
        self.stopper = stopper
        let http = http
        let resolver = resolver
        let store = store
        let now = clock()
        let calendar = calendar
        task = Task { [weak self] in
            do {
                let result = try await ActivityCalendarScan.scan(
                    actor: actor,
                    http: http,
                    resolver: resolver,
                    store: store,
                    stopper: stopper,
                    now: now,
                    calendar: calendar
                ) { snapshot in
                    self?.publish(gen, snapshot)
                }
                self?.finish(gen, result)
            } catch {
                self?.fail(gen, error)
            }
        }
    }

    private func publish(_ gen: Int, _ snapshot: ActivityCalendarScan.Snapshot) {
        guard gen == generation else { return }
        scan = snapshot
    }

    private func finish(_ gen: Int, _ result: ActivityCalendarScan.Snapshot) {
        guard gen == generation else { return }
        scan = result
        status = .done
    }

    private func fail(_ gen: Int, _ error: Error) {
        guard gen == generation, !(error is CancellationError) else { return }
        errorMessage = AccountCheckError.describe(error)
        status = .failed
    }

    /// Wait for the run in flight. For tests.
    func waitForRun() async {
        await task?.value
    }
}
