import Foundation
import Observation

// The lexicon publishing checker's screen state, port of `investigate` in
// src/components/tools/LexiconChecker.tsx: walk the publishing chain for one
// NSID, publishing the evidence as each link is read so the check list fills
// in step by step. A link that could not be read is evidence too, and is
// recorded rather than thrown. What the evidence means is in
// Tools/LexiconPublishing.swift.

@MainActor
@Observable
public final class LexiconCheckerModel {
    /// The input as last submitted.
    public private(set) var submitted = ""
    /// Why that input is not an NSID, when it is not.
    public private(set) var inputProblem: String?
    /// What has been observed so far; nil until an NSID is being checked.
    public private(set) var evidence: LexiconPublishing.Evidence?
    public private(set) var isRunning = false

    @ObservationIgnored private let client: LexiconPublishingClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared) {
        client = LexiconPublishingClient(http: http)
    }

    public var nsid: String? {
        evidence?.nsid
    }

    public var checks: [LexiconPublishing.Check] {
        guard let evidence else { return [] }
        return LexiconPublishing.buildChecks(evidence)
    }

    public var verdict: LexiconPublishing.Verdict? {
        guard let evidence else { return nil }
        return LexiconPublishing.verdict(evidence, LexiconPublishing.buildChecks(evidence))
    }

    /// The schema record the chain turned up, by DNS or by the convention.
    public var schema: LexiconPublishing.FoundSchema? {
        guard let evidence else { return nil }
        return LexiconPublishing.foundSchema(evidence)
    }

    /// The query a shared link keeps: the NSID, once it reads as one.
    public var shareQuery: [String: String] {
        guard let nsid else { return [:] }
        return ["nsid": nsid]
    }

    /// Check `raw` as an NSID, or say why it is not one.
    @discardableResult
    public func check(_ raw: String) -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        submitted = raw
        switch LexiconPublishing.normalizeNsidInput(raw) {
        case .problem(let reason):
            inputProblem = reason
            evidence = nil
            isRunning = false
            return nil
        case .nsid(let nsid):
            inputProblem = nil
            evidence = LexiconPublishing.Evidence(nsid: nsid)
            isRunning = true
            let next = Task { await self.investigate(nsid, gen) }
            task = next
            return next
        }
    }

    /// Check the last input again.
    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        guard !submitted.isEmpty else { return nil }
        return check(submitted)
    }

    private func current(_ gen: Int) -> Bool {
        gen == generation && !Task.isCancelled
    }

    private func investigate(_ nsid: String, _ gen: Int) async {
        let client = client
        let domain = LexiconPublishing.nsidAuthority(nsid).domain
        let dns = await client.lookupTxt("_lexicon.\(domain)")
        guard current(gen) else { return }

        guard let did = LexiconPublishing.readLexiconRecords(dns.records).did else {
            // Nothing usable at the authority. Two more things are worth
            // knowing before saying so: whether a record sits one level too
            // high, and whether the explorer's handle convention finds a
            // schema anyway.
            let handle = LexiconPublishing.conventionHandle(nsid)
            let parentDomains = LexiconPublishing.parentAuthorities(domain)
            async let parents = client.parentRecords(parentDomains)
            async let identity = client.resolveMiniDoc(handle)
            let foundParents = await parents
            let mini = await identity
            var record: LexiconPublishing.RecordProbe?
            if let mini, !mini.pds.isEmpty {
                record = await client.readSchemaRecord(pds: mini.pds, did: mini.did, nsid: nsid)
            }
            guard current(gen) else { return }
            evidence?.dns = dns
            evidence?.parents = foundParents
            evidence?.convention = LexiconPublishing.ConventionProbe(handle: handle, did: mini?.did, record: record)
            isRunning = false
            return
        }
        evidence?.dns = dns

        let document = await client.loadDocument(did)
        guard current(gen) else { return }
        evidence?.document = document

        guard case .resolved(let resolved) = document, let endpoint = LexiconPublishing.pdsEndpoint(from: resolved) else {
            isRunning = false
            return
        }
        let record = await client.readSchemaRecord(pds: endpoint, did: did, nsid: nsid)
        guard current(gen) else { return }
        evidence?.record = record
        isRunning = false
    }
}
