import Foundation
import Observation

// The handle debugger's screen state, port of `investigate` and the run in
// src/components/tools/HandleDebugger.tsx: gather the evidence for one
// handle and publish it as each part arrives, so the check list fills in
// step by step. The reading of the evidence is `HandleDebug`; the lookups
// are `HandleDebugClient`.
//
// The order is the page's: both resolution methods at once, then the DID
// document for the DID they settle on, then the PDS and the AppView side by
// side. A step that fails stops the ones that depend on it, and the list
// says why they were not run.

@MainActor
@Observable
public final class HandleDebugModel {
    /// What was last submitted, tidied: the handle checked, or why the
    /// input was refused. Nil before anything is entered.
    public private(set) var input: HandleDebug.Input?
    /// The evidence for the handle being checked. Nil until a valid handle
    /// has been submitted.
    public private(set) var evidence: HandleDebug.Evidence?
    public private(set) var isRunning = false

    @ObservationIgnored private let client: HandleDebugClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared) {
        client = HandleDebugClient(http: http)
    }

    public init(client: HandleDebugClient) {
        self.client = client
    }

    // MARK: Derived

    /// The handle being checked, for the share link (`?handle=`).
    public var handle: String? {
        input?.handle
    }

    public var checks: [HandleDebug.Check] {
        guard let evidence else { return [] }
        return HandleDebug.buildChecks(evidence)
    }

    public var verdict: HandleDebug.Verdict? {
        guard let evidence else { return nil }
        return HandleDebug.verdict(evidence, checks: HandleDebug.buildChecks(evidence))
    }

    /// The account's PDS, from the DID document, once it has been read.
    public var pdsEndpoint: String? {
        HandleDebug.pdsEndpoint(evidence?.document.value)
    }

    // MARK: Running

    /// Check what was typed, cancelling any check in flight. Returns the
    /// run, for callers (and tests) that wait for it; nil when the input
    /// was empty or refused.
    @discardableResult
    public func check(_ raw: String) -> Task<Void, Never>? {
        cancel()
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            input = nil
            evidence = nil
            return nil
        }
        let normalized = HandleDebug.normalizeInput(trimmed)
        input = normalized
        guard let handle = normalized.handle else {
            evidence = nil
            return nil
        }
        return start(handle)
    }

    /// The page's "Check again": the same handle, every step afresh.
    @discardableResult
    public func checkAgain() -> Task<Void, Never>? {
        guard let handle else { return nil }
        cancel()
        return start(handle)
    }

    public func cancel() {
        task?.cancel()
        task = nil
        generation += 1
        isRunning = false
    }

    private func start(_ handle: String) -> Task<Void, Never> {
        generation += 1
        let gen = generation
        evidence = HandleDebug.Evidence(handle: handle)
        isRunning = true
        let run = Task { [weak self] in
            await self?.investigate(handle, gen)
        }
        task = run
        return run
    }

    /// The PDS and AppView answers, in whichever order they arrive.
    private enum Arrival: Sendable {
        case pds(HandleDebug.PDSState)
        case appView(HandleDebug.AppViewState)
    }

    private func investigate(_ handle: String, _ gen: Int) async {
        let client = self.client

        let probe = await client.probe(handle)
        guard gen == generation else { return }
        evidence?.probe = .done(probe)
        guard let did = HandleDebug.resolvedDid(probe) else {
            finish(gen)
            return
        }

        let document = await client.document(did)
        guard gen == generation else { return }
        evidence?.document = document
        guard let read = document.value else {
            finish(gen)
            return
        }

        let endpoint = HandleDebug.pdsEndpoint(read)
        await withTaskGroup(of: Arrival.self) { group in
            if let endpoint {
                group.addTask { .pds(await client.pdsState(endpoint: endpoint, did: did)) }
            }
            group.addTask { .appView(await client.appView(did)) }
            for await arrival in group {
                guard gen == generation else { continue }
                switch arrival {
                case .pds(let state):
                    evidence?.pds = .done(state)
                case .appView(let state):
                    evidence?.appview = .done(state)
                }
            }
        }
        finish(gen)
    }

    private func finish(_ gen: Int) {
        guard gen == generation else { return }
        isRunning = false
        task = nil
    }
}
