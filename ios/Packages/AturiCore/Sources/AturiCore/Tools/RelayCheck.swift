import Foundation

/// The relay crawl check's logic: which relays to ask about a PDS, and how
/// to read what each one says. Port of `src/lib/tools/relay.ts`, with two
/// readings that live beside it on the web: a relay row in words
/// (`readRow` in `src/components/tools/RelayStatusList.tsx`) and the relays'
/// count of a host's accounts (`relayAccountCount` in
/// `src/components/explore/pds/parts.tsx`), so the tool and the PDS page
/// read an answer the same way.
///
/// A PDS reaches the rest of the network through relays. A relay learns of
/// a host when the host asks to be crawled (`com.atproto.sync.requestCrawl`),
/// subscribes to its event stream, and from then on answers
/// `com.atproto.sync.getHostStatus?hostname=<host>` with what it knows: a
/// status, how many of the host's accounts it has seen, and how far through
/// the host's event sequence it has read. A host it has never heard of gets
/// a `HostNotFound` error.
///
/// Everything here is pure. The asking is `RelayCheckClient`; the app asks
/// the relays directly, as the web page does.
///
/// Swift spellings of the web's names, as in `Shadowban`: the web's unions
/// are enums, `undefined` ("still on its way") is a nil optional, and the
/// relay's `operator` and `where`, both keywords here, are `operatorName`
/// and `region`.
public enum RelayCheck {
    public struct Relay: Hashable, Sendable, Identifiable {
        /// The relay's hostname, as `https://<host>/xrpc/…` is asked.
        public var host: String
        /// Who runs it.
        public var operatorName: String
        /// Where it runs, as its operator describes it.
        public var region: String

        public var id: String { host }

        public init(host: String, operatorName: String, region: String) {
            self.host = host
            self.operatorName = operatorName
            self.region = region
        }
    }

    /// The relays asked. Each one was checked by hand before the web listed
    /// it: it answers `getHostStatus` for a known host and `HostNotFound` for
    /// an unknown one. (The web also needed each to send CORS headers; the
    /// app does not, but keeps the same list so the two agree.)
    ///
    /// The first is the relay the rest of the explorer already asks
    /// (`Endpoints.relay`). The two microcosm relays are the ones
    /// microcosm.blue lists as its public full-network relays.
    ///
    /// Left out on purpose, as on the web: `bsky.network`, which answered
    /// with the same figures as the US West relay and would only repeat it,
    /// and third-party relays whose operator could not be confirmed.
    public static let relays: [Relay] = [
        Relay(host: Endpoints.relay.host ?? "relay1.us-east.bsky.network", operatorName: "Bluesky", region: "US East"),
        Relay(host: "relay1.us-west.bsky.network", operatorName: "Bluesky", region: "US West"),
        Relay(host: "relay.fire.hose.cam", operatorName: "microcosm", region: "Montreal"),
        Relay(host: "relay3.fr.hose.cam", operatorName: "microcosm", region: "France"),
    ]

    // MARK: - Input

    public enum Input: Hashable, Sendable {
        /// A URL was given, so this is certainly a host.
        case host(String)
        /// A DID, or a handle marked as one with @ or at://. Its PDS is looked up.
        case account(String)
        /// A bare domain: a PDS hostname, or a handle. The page asks to find out.
        case either(String)
        /// What was typed cannot be read; why, in words.
        case invalid(String)

        public var isValid: Bool {
            if case .invalid = self { return false }
            return true
        }

        /// Why the input cannot be read; nil for one that can.
        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }

        /// What identifies the run, `${kind}:${value}` on the web.
        public var key: String? {
            switch self {
            case .host(let host): return "host:" + host
            case .account(let identifier): return "account:" + identifier
            case .either(let host): return "either:" + host
            case .invalid: return nil
            }
        }
    }

    /// `/^did:(plc|web):\S+$/`: the DIDs that name a PDS to look up.
    static func isLookupDid(_ value: String) -> Bool {
        value.wholeMatch(of: #/did:(plc|web):\S+/#) != nil
    }

    /// A hostname of dotted labels with an optional port, at most 253
    /// characters: the web's `HOSTNAME`, with its length lookahead spelled
    /// as a count and `\d` as `[0-9]` (Swift's `\d` takes any digit).
    static func isHostname(_ value: String) -> Bool {
        guard (1...253).contains(value.count) else { return false }
        return value.wholeMatch(
            of: #/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::[0-9]{1,5})?/#
        ) != nil
    }

    /// `new URL(value).host.toLowerCase()`: the host with its port, unless
    /// the port is the scheme's own. Nil when there is no host to read.
    static func urlHost(_ value: String) -> String? {
        guard let components = URLComponents(string: value), let host = components.host, !host.isEmpty else {
            return nil
        }
        let name = host.lowercased()
        guard let port = components.port else { return name }
        let scheme = components.scheme?.lowercased()
        if (scheme == "https" && port == 443) || (scheme == "http" && port == 80) {
            return name
        }
        return name + ":" + String(port)
    }

    /// Read what was typed as a PDS host, or as an account whose PDS to look up.
    public static func normalizeInput(_ raw: String) -> Input {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid("Enter a PDS hostname.") }
        let lower = value.lowercased()

        if lower.hasPrefix("did:") {
            return isLookupDid(value)
                ? .account(value)
                : .invalid("That DID could not be read. Only did:plc and did:web have a PDS to look up.")
        }
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let host = urlHost(value) else {
                return .invalid("That URL could not be read. Enter a hostname such as pds.example.com.")
            }
            return .host(host)
        }

        let marked = lower.hasPrefix("at://") || value.hasPrefix("@")
        var bare = lower.hasPrefix("at://") ? String(value.dropFirst(5)) : value
        if bare.hasPrefix("@") {
            bare.removeFirst()
        }
        bare = String(bare.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
        if bare.hasSuffix(".") {
            bare.removeLast()
        }
        bare = bare.lowercased()
        if isLookupDid(bare) { return .account(bare) }
        guard isHostname(bare) else {
            return .invalid("Enter a PDS hostname such as pds.example.com, or a handle or DID to look up its PDS.")
        }
        return marked ? .account(bare) : .either(bare)
    }

    /// The hostname of a PDS endpoint from a DID document (`https://pds.example.com`).
    public static func hostOfEndpoint(_ endpoint: String) -> String? {
        urlHost(endpoint)
    }

    // MARK: - What a relay answers

    public enum Answer: Hashable, Sendable {
        /// The relay has a record of the host. Only `hostname` is required of it.
        case known(status: String?, accountCount: Int?, seq: Int?)
        /// `HostNotFound`: the relay has never been asked to crawl this host.
        case unknown
        /// The relay did not answer, or answered something else.
        case error(String)

        public var isKnown: Bool {
            if case .known = self { return true }
            return false
        }

        public var isError: Bool {
            if case .error = self { return true }
            return false
        }

        /// The status a known host carries. Nil for an unknown host, a
        /// failure, and a known host the relay gave no status.
        public var knownStatus: String? {
            if case .known(let status, _, _) = self { return status }
            return nil
        }

        /// How many of the host's accounts a relay that knows it counts.
        public var accountCount: Int? {
            if case .known(_, let count, _) = self { return count }
            return nil
        }
    }

    /// Read a relay's response to `getHostStatus`. A count the relay sends
    /// as a fraction reads as none (the web keeps any finite number).
    public static func readHostStatus(httpStatus: Int, body: JSONValue?) -> Answer {
        let data = body?.objectValue ?? [:]
        if (200..<300).contains(httpStatus), data["hostname"]?.stringValue != nil {
            let seq = data["seq"]?.intValue
            return .known(
                status: data["status"]?.stringValue,
                accountCount: data["accountCount"]?.intValue,
                // The reference relay stores -1 until it has persisted a cursor.
                seq: seq.flatMap { $0 >= 0 ? $0 : nil }
            )
        }
        let named = data["error"]?.stringValue
        if named == "HostNotFound" { return .unknown }
        if let named, !named.isEmpty {
            return .error("\(named) (HTTP \(httpStatus))")
        }
        return .error("HTTP \(httpStatus)")
    }

    /// How a row is marked: fine, worth a look, or broken.
    public enum Tone: String, Hashable, Sendable {
        case pass
        case warn
        case fail
    }

    public struct StatusReading: Hashable, Sendable {
        public var tone: Tone
        public var label: String
        /// What the status means for the host, in a sentence.
        public var meaning: String
        /// Whether asking to be crawled again is the way out.
        public var recrawl: Bool

        public init(tone: Tone, label: String, meaning: String, recrawl: Bool) {
            self.tone = tone
            self.label = label
            self.meaning = meaning
            self.recrawl = recrawl
        }
    }

    /// A host status in words. The five values are the lexicon's
    /// (`com.atproto.sync.defs#hostStatus`); what each means is how the
    /// reference relay uses it. `idle` and `offline` are both left by a
    /// dropped connection and both end when the host asks to be crawled
    /// again; `banned` does not.
    public static func readStatus(_ status: String?) -> StatusReading {
        guard let status else {
            return StatusReading(
                tone: .warn,
                label: "Known",
                meaning: "Has a record of this host, but reported no status for it.",
                recrawl: false
            )
        }
        switch status {
        case "active":
            return StatusReading(
                tone: .pass,
                label: "Active",
                meaning: "Connected to this host and reading its events.",
                recrawl: false
            )
        case "idle":
            return StatusReading(
                tone: .warn,
                label: "Idle",
                meaning: "Knows this host, but dropped its connection and is not reading from it. A new crawl request starts it again.",
                recrawl: true
            )
        case "offline":
            return StatusReading(
                tone: .fail,
                label: "Offline",
                meaning: "Could not connect to this host after repeated tries and has stopped trying. A new crawl request starts it again.",
                recrawl: true
            )
        case "throttled":
            return StatusReading(
                tone: .warn,
                label: "Throttled",
                meaning: "Reading from this host, but limiting how much it takes.",
                recrawl: false
            )
        case "banned":
            return StatusReading(
                tone: .fail,
                label: "Banned",
                meaning: "Refuses this host. A crawl request will not change that. Only the relay’s operator can lift it.",
                recrawl: false
            )
        default:
            return StatusReading(
                tone: .warn,
                label: status,
                meaning: "Reported a status this page does not know.",
                recrawl: false
            )
        }
    }

    // MARK: - The verdict

    /// One relay and its answer. `answer` is nil while it is still on its way.
    public struct RelayResult: Hashable, Sendable, Identifiable {
        public var relay: Relay
        public var answer: Answer?

        public var id: String { relay.host }

        public init(relay: Relay, answer: Answer? = nil) {
            self.relay = relay
            self.answer = answer
        }
    }

    /// What the host says for itself.
    public struct Probe: Hashable, Sendable {
        /// `describeServer` answered, so something is serving XRPC as a PDS.
        public var reachable: Bool
        public var did: String?
        public var version: String?

        public init(reachable: Bool, did: String? = nil, version: String? = nil) {
            self.reachable = reachable
            self.did = did
            self.version = version
        }
    }

    public enum VerdictTone: String, Hashable, Sendable {
        case pass
        case warn
        case fail
        case pending
    }

    public struct Verdict: Hashable, Sendable {
        public var tone: VerdictTone
        public var title: String
        public var text: String
        /// Whether the page should explain how to ask for a crawl.
        public var explainCrawl: Bool

        public init(tone: VerdictTone, title: String, text: String, explainCrawl: Bool) {
            self.tone = tone
            self.title = title
            self.text = text
            self.explainCrawl = explainCrawl
        }
    }

    /// What the relays' answers add up to. `pds` is nil while the host is
    /// still being asked for itself.
    public static func verdict(host: String, results: [RelayResult], pds: Probe?) -> Verdict {
        if results.contains(where: { $0.answer == nil }) {
            return Verdict(
                tone: .pending,
                title: "Asking \(results.count) relays about \(host)",
                text: "Each one is asked what it knows about this host.",
                explainCrawl: false
            )
        }
        let answered = results.filter { result in
            guard let answer = result.answer else { return false }
            return !answer.isError
        }
        let known = answered.filter { $0.answer?.isKnown ?? false }
        let active = known.filter { $0.answer?.knownStatus == "active" }
        let stalled = known.filter { readStatus($0.answer?.knownStatus).recrawl }
        let banned = known.contains { $0.answer?.knownStatus == "banned" }
        let silent = results.count - answered.count
        let tail: String
        if silent == 0 {
            tail = ""
        } else if silent == 1 {
            tail = " One relay did not answer."
        } else {
            tail = " \(silent) relays did not answer."
        }
        let reachable = pds?.reachable

        if answered.isEmpty {
            return Verdict(
                tone: .warn,
                title: "None of the relays answered",
                text: "That says nothing about the host. Try again in a moment.",
                explainCrawl: false
            )
        }
        if known.isEmpty {
            let lead = reachable == false
                ? "It does not answer as a PDS either, so check the hostname first."
                : "The PDS answers, but no relay has been asked to crawl it, so nothing it writes reaches the network."
            return Verdict(
                tone: .fail,
                title: "No relay knows \(host)",
                text: lead + tail,
                explainCrawl: reachable != false
            )
        }
        if active.count == answered.count {
            let who = answered.count == 1 ? "the relay that answered" : "all \(answered.count) relays"
            return Verdict(
                tone: .pass,
                title: "\(host) is being crawled by \(who)",
                text: "Each one is connected and reading its events." + tail,
                explainCrawl: false
            )
        }
        if !active.isEmpty {
            return Verdict(
                tone: .warn,
                title: "\(host) is being crawled by \(active.count) of \(answered.count) relays",
                text: "Apps that read from the others will not see what it writes." + tail,
                explainCrawl: !stalled.isEmpty || known.count < answered.count
            )
        }
        let lead: String
        if banned && stalled.isEmpty {
            lead = "It has been refused, which only a relay’s operator can undo."
        } else if reachable == false {
            lead = "It does not answer as a PDS right now, which is the likely reason."
        } else {
            lead = "Their connections to it dropped. Asking to be crawled again reconnects them."
        }
        return Verdict(
            tone: .fail,
            title: "Relays know \(host), but none is reading it",
            text: lead + tail,
            explainCrawl: !stalled.isEmpty && reachable != false
        )
    }

    /// The request a host sends to be crawled, as a command to run by hand.
    public static func requestCrawlCommand(relayHost: String, host: String) -> String {
        [
            "curl -X POST https://\(relayHost)/xrpc/com.atproto.sync.requestCrawl \\",
            "  -H 'Content-Type: application/json' \\",
            "  -d '{\"hostname\":\"\(host)\"}'",
        ].joined(separator: "\n")
    }

    /// The relay to show the crawl request for: the first that has not
    /// heard of the host, failing that the first. Nil with no relays.
    public static func crawlRelay(_ results: [RelayResult]) -> Relay? {
        results.first(where: { $0.answer == .unknown })?.relay ?? results.first?.relay ?? relays.first
    }

    /// `1,234`, as `Intl.NumberFormat('en-US')` prints a count.
    public static func formatCount(_ value: Int) -> String {
        JetstreamModel.grouped(value)
    }

    // MARK: - A relay's row, in words

    /// How a row is marked beside the relay's name.
    public enum RowMark: String, Hashable, Sendable {
        case pending
        /// Did not answer: says nothing either way.
        case skip
        case pass
        case warn
        case fail
    }

    /// The pill's look: the status's tone, the outline of "Not known", or plain.
    public enum PillTone: String, Hashable, Sendable {
        case plain
        case pass
        case warn
        case fail
        case outline
    }

    public struct RowReading: Hashable, Sendable {
        public var mark: RowMark
        public var pill: String
        public var pillTone: PillTone
        public var meaning: String
        /// "12 accounts", when the relay counted any.
        public var accounts: String?
        /// "seq 3,400", or "no events read yet"; nil before a known answer.
        public var sequence: String?

        public init(mark: RowMark, pill: String, pillTone: PillTone, meaning: String, accounts: String? = nil, sequence: String? = nil) {
            self.mark = mark
            self.pill = pill
            self.pillTone = pillTone
            self.meaning = meaning
            self.accounts = accounts
            self.sequence = sequence
        }

        /// The figures beside the pill, in the web's order.
        public var figures: [String] {
            [accounts, sequence].compactMap { $0 }
        }
    }

    /// One relay's answer as its row reads it.
    public static func readRow(_ answer: Answer?) -> RowReading {
        guard let answer else {
            return RowReading(mark: .pending, pill: "Asking", pillTone: .plain, meaning: "Waiting for an answer.")
        }
        switch answer {
        case .error(let message):
            return RowReading(
                mark: .skip,
                pill: "No answer",
                pillTone: .plain,
                meaning: "Did not answer (\(message)). That says nothing about the host."
            )
        case .unknown:
            return RowReading(
                mark: .fail,
                pill: "Not known",
                pillTone: .outline,
                meaning: "Has never been asked to crawl this host, so it carries none of its records."
            )
        case .known(let status, let accountCount, let seq):
            let reading = readStatus(status)
            let mark: RowMark
            let pillTone: PillTone
            switch reading.tone {
            case .pass:
                mark = .pass
                pillTone = .pass
            case .warn:
                mark = .warn
                pillTone = .warn
            case .fail:
                mark = .fail
                pillTone = .fail
            }
            var accounts: String?
            if let accountCount {
                accounts = formatCount(accountCount) + (accountCount == 1 ? " account" : " accounts")
            }
            let sequence = seq.map { "seq " + formatCount($0) } ?? "no events read yet"
            return RowReading(
                mark: mark,
                pill: reading.label,
                pillTone: pillTone,
                meaning: reading.meaning,
                accounts: accounts,
                sequence: sequence
            )
        }
    }

    /// How many accounts the relays count on the host: the most any of them
    /// says, since a relay that crawls it late or partly counts fewer. Nil
    /// until one has answered with a count, and when all they say is zero:
    /// an entryway like bsky.social is known to relays but holds no repos of
    /// its own, and "0 accounts" beside it misleads more than saying nothing.
    public static func accountCount(_ results: [RelayResult]) -> Int? {
        var best: Int?
        for result in results {
            guard let count = result.answer?.accountCount else { continue }
            best = max(best ?? count, count)
        }
        return best == 0 ? nil : best
    }
}
