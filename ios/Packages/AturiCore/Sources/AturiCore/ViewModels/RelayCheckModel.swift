import Foundation
import Observation

/// What each relay says about one PDS host, port of `useRelayStatuses` in
/// `src/components/tools/RelayStatusList.tsx`: every relay is asked at once
/// and its row fills in as it answers. The relay crawl check and the PDS
/// page each hold one, as both web pages draw `RelayStatusRows`.
@MainActor
@Observable
public final class RelayStatusModel {
    /// The host the relays were last asked about; nil before the first ask.
    public private(set) var hostname: String?
    /// One row per relay, in the list's order: pending (no answer) until
    /// that relay answers. Empty until asked.
    public private(set) var results: [RelayCheck.RelayResult] = []
    public private(set) var isLoading = false

    @ObservationIgnored private let client: RelayCheckClient
    @ObservationIgnored private let relays: [RelayCheck.Relay]
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(
        http: HTTPClient = .shared,
        relays: [RelayCheck.Relay] = RelayCheck.relays,
        timeout: TimeInterval = RelayCheckClient.defaultTimeout
    ) {
        client = RelayCheckClient(http: http, timeout: timeout)
        self.relays = relays
    }

    /// Ask every relay about `hostname`, dropping any earlier asking. The
    /// task finishes when the last relay has answered or timed out.
    @discardableResult
    public func ask(_ hostname: String) -> Task<Void, Never> {
        task?.cancel()
        generation += 1
        let gen = generation
        self.hostname = hostname
        results = relays.map { RelayCheck.RelayResult(relay: $0) }
        isLoading = true
        let asker = client
        let list = relays
        let next = Task { [weak self] in
            await withTaskGroup(of: (index: Int, answer: RelayCheck.Answer).self) { group in
                for (index, relay) in list.enumerated() {
                    group.addTask {
                        let answer = await asker.ask(relay, about: hostname)
                        return (index: index, answer: answer)
                    }
                }
                for await outcome in group {
                    self?.record(outcome.answer, at: outcome.index, generation: gen)
                }
            }
            self?.settle(generation: gen)
        }
        task = next
        return next
    }

    /// Ask the same host again (the pages' "Ask again"). Nil before any ask.
    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        guard let hostname else { return nil }
        return ask(hostname)
    }

    /// Stop asking; rows still pending stay pending.
    public func cancel() {
        task?.cancel()
        task = nil
        generation += 1
        isLoading = false
    }

    /// Back to nothing asked.
    public func reset() {
        cancel()
        hostname = nil
        results = []
    }

    /// Wait for the asking in flight, if any.
    public func finish() async {
        await task?.value
    }

    /// The most accounts any relay counts on the host (`RelayCheck.accountCount`).
    public var accountCount: Int? {
        RelayCheck.accountCount(results)
    }

    private func record(_ answer: RelayCheck.Answer, at index: Int, generation gen: Int) {
        guard gen == generation, results.indices.contains(index) else { return }
        results[index].answer = answer
    }

    private func settle(generation gen: Int) {
        guard gen == generation else { return }
        isLoading = false
    }
}

/// The relay crawl check (`/tools/relay`), port of
/// `src/components/tools/RelayCheck.tsx`: what was typed is settled into a
/// hostname, every relay is asked about it, and the host is asked for
/// itself, so a PDS that is down reads apart from one that is up but has
/// never been crawled. The relays are asked as soon as the hostname is
/// known, not after the host has answered.
///
/// A URL is a host and a DID or @handle is an account. A bare domain can be
/// either, so both are asked at once: if it answers as a PDS it is one, and
/// otherwise, if it resolves as a handle, the account's PDS is used. A
/// domain that does neither is still taken as a host, since a PDS that is
/// down is exactly what someone would come here to look into.
@MainActor
@Observable
public final class RelayCheckModel {
    /// The account a host was looked up from.
    public struct Account: Hashable, Sendable {
        public var did: String
        public var handle: String?

        public init(did: String, handle: String? = nil) {
            self.did = did
            self.handle = handle
        }

        /// `@handle`, or the DID when there is no handle.
        public var label: String {
            if let handle, !handle.isEmpty { return "@" + handle }
            return did
        }
    }

    /// The host the relays are asked about, and how it was arrived at.
    public struct Target: Hashable, Sendable {
        public var host: String
        /// The account the host was looked up from, when the input was not a host.
        public var account: Account?
        /// What the host says for itself; nil while it is being asked.
        public var pds: RelayCheck.Probe?

        public init(host: String, account: Account? = nil, pds: RelayCheck.Probe? = nil) {
            self.host = host
            self.account = account
            self.pds = pds
        }
    }

    /// The query key the web tool keeps its input under (`?host=`).
    public static let queryKey = "host"

    /// The input as submitted, trimmed.
    public private(set) var raw = ""
    /// How it reads; nil before anything was submitted.
    public private(set) var input: RelayCheck.Input?
    public private(set) var target: Target?
    /// Settling the input into a hostname, or asking the host about itself.
    public private(set) var isResolving = false
    /// The input could not be settled into a host.
    public private(set) var error: String?
    /// What each relay says about the target's host.
    public let relays: RelayStatusModel

    @ObservationIgnored private let client: RelayCheckClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(
        http: HTTPClient = .shared,
        relays: [RelayCheck.Relay] = RelayCheck.relays,
        timeout: TimeInterval = RelayCheckClient.defaultTimeout
    ) {
        client = RelayCheckClient(http: http, timeout: timeout)
        self.relays = RelayStatusModel(http: http, relays: relays, timeout: timeout)
    }

    // MARK: Running

    /// Check `raw`. Nil when there is nothing to run: an empty input, or
    /// one that cannot be read (`invalidReason` says why).
    @discardableResult
    public func run(_ raw: String) -> Task<Void, Never>? {
        cancel()
        generation += 1
        let gen = generation
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        self.raw = trimmed
        target = nil
        error = nil
        relays.reset()
        guard !trimmed.isEmpty else {
            input = nil
            return nil
        }
        let parsed = RelayCheck.normalizeInput(trimmed)
        input = parsed
        guard parsed.isValid else { return nil }
        isResolving = true
        let next = Task { [weak self] in
            await self?.resolve(parsed, generation: gen)
        }
        task = next
        return next
    }

    /// The same input again: the web's "Try again".
    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        run(raw)
    }

    public func cancel() {
        task?.cancel()
        task = nil
        relays.cancel()
        isResolving = false
    }

    /// Wait for the run and the relays.
    public func finish() async {
        await task?.value
        await relays.finish()
    }

    private func resolve(_ input: RelayCheck.Input, generation gen: Int) async {
        let asker = client
        switch input {
        case .invalid:
            isResolving = false
        case .host(let host):
            publish(Target(host: host), generation: gen)
            let probe = await asker.probe(host)
            settle(probe, generation: gen)
        case .account(let identifier):
            let mini = await asker.resolveAccount(identifier)
            await fromAccount(mini, identifier: identifier, generation: gen)
        case .either(let host):
            async let probeLookup = asker.probe(host)
            async let miniLookup = asker.resolveAccount(host)
            let probe = await probeLookup
            let mini = await miniLookup
            guard gen == generation, !Task.isCancelled else { return }
            if !probe.reachable, let mini {
                await fromAccount(mini, identifier: host, generation: gen)
            } else {
                publish(Target(host: host, pds: probe), generation: gen)
                isResolving = false
            }
        }
    }

    private func fromAccount(_ mini: MiniDoc?, identifier: String, generation gen: Int) async {
        guard gen == generation, !Task.isCancelled else { return }
        guard let mini, let host = RelayCheck.hostOfEndpoint(mini.pds) else {
            error = "\(identifier) could not be resolved to an account with a PDS."
            isResolving = false
            return
        }
        publish(Target(host: host, account: Account(did: mini.did, handle: mini.handle)), generation: gen)
        let probe = await client.probe(host)
        settle(probe, generation: gen)
    }

    /// The hostname is known: show it and start asking the relays.
    private func publish(_ next: Target, generation gen: Int) {
        guard gen == generation else { return }
        let asked = relays.hostname == next.host && !relays.results.isEmpty
        target = next
        if !asked {
            relays.ask(next.host)
        }
    }

    private func settle(_ probe: RelayCheck.Probe, generation gen: Int) {
        guard gen == generation, !Task.isCancelled else { return }
        target?.pds = probe
        isResolving = false
    }

    // MARK: Derived

    /// Why the input cannot be read, for the error under the form.
    public var invalidReason: String? {
        input?.reason
    }

    /// What the relays' answers add up to; nil until there is a host.
    public var verdict: RelayCheck.Verdict? {
        guard let target else { return nil }
        return RelayCheck.verdict(host: target.host, results: relays.results, pds: target.pds)
    }

    /// The relay the crawl request is shown for.
    public var crawlRelay: RelayCheck.Relay? {
        RelayCheck.crawlRelay(relays.results)
    }

    /// The crawl request to run by hand, for the target's host.
    public var crawlCommand: String? {
        guard let target, let relay = crawlRelay else { return nil }
        return RelayCheck.requestCrawlCommand(relayHost: relay.host, host: target.host)
    }

    /// The form's button shows progress while either half is working.
    public var isBusy: Bool {
        isResolving || relays.isLoading
    }

    /// Working out what the input is, before there is a host to show.
    public var isFindingHost: Bool {
        isResolving && target == nil
    }

    /// The share button's query: the input as typed, once it can be read.
    public var shareQuery: [String: String] {
        guard input?.isValid == true else { return [:] }
        return [Self.queryKey: raw]
    }

    /// Nothing submitted yet: the page explains how it works instead.
    public var showsIntro: Bool {
        raw.isEmpty
    }
}
