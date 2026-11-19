import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The relay crawl check's requests, port of `askRelay` in
/// `src/components/tools/RelayStatusList.tsx` and `probePds` in
/// `src/components/tools/RelayCheck.tsx`. What the answers mean is in
/// `RelayCheck`.
///
///   - Each relay: `com.atproto.sync.getHostStatus` on the relay's own
///     host. Every status is an answer: a 404 `HostNotFound` is how a relay
///     says it has never heard of the host.
///   - The host itself: `describeServer` and `_health`, so a PDS that is
///     down reads apart from one that is up but has never been crawled.
///   - Slingshot's `resolveMiniDoc`, for an account whose PDS is wanted.
public struct RelayCheckClient: Sendable {
    /// Longer than a relay ever takes to answer, short enough that a dead
    /// one does not hold the list. `RELAY_TIMEOUT_MS`. `HTTPClient` retries
    /// a request that got no answer once, so this bounds the pair.
    public static let defaultTimeout: TimeInterval = 8

    private let http: HTTPClient
    private let timeout: TimeInterval

    public init(http: HTTPClient = .shared, timeout: TimeInterval = RelayCheckClient.defaultTimeout) {
        self.http = http
        self.timeout = timeout
    }

    /// What one relay knows about a host. Never throws: a relay that does
    /// not answer, or not in time, is `.error("no answer")`.
    public func ask(_ relay: RelayCheck.Relay, about hostname: String) async -> RelayCheck.Answer {
        guard let base = URL(string: "https://" + relay.host) else { return .error("no answer") }
        let url = makeURL(base, path: "/xrpc/com.atproto.sync.getHostStatus", query: [("hostname", hostname)])
        let http = self.http
        return await RelayCheckClient.withTimeout(timeout) {
            do {
                let (data, response) = try await http.send(URLRequest(url: url))
                let body = try? JSONValue.parse(data)
                return RelayCheck.readHostStatus(httpStatus: response.statusCode, body: body)
            } catch {
                return .error("no answer")
            }
        }
    }

    /// What the host says for itself: whether `describeServer` answers,
    /// with the server DID it gives and the version `_health` reports.
    public func probe(_ host: String) async -> RelayCheck.Probe {
        let server = PDSServer(http: http)
        async let description = RelayCheckClient.describe(server, host)
        async let health = RelayCheckClient.health(server, host)
        let described = await description
        let reported = await health
        return RelayCheck.Probe(reachable: described != nil, did: described?.did, version: reported?.version)
    }

    /// An account's DID, handle and PDS, from Slingshot. Nil when it does
    /// not resolve.
    public func resolveAccount(_ identifier: String) async -> MiniDoc? {
        await SlingshotClient(http: http).resolveMiniDoc(identifier)
    }

    private static func describe(_ server: PDSServer, _ host: String) async -> PDSServer.ServerDescription? {
        try? await server.describeServer(pds: host)
    }

    private static func health(_ server: PDSServer, _ host: String) async -> PDSServer.ServerHealth? {
        try? await server.serverHealth(pds: host)
    }

    /// `work`'s answer, or `.error("no answer")` once `seconds` pass first.
    /// The loser is cancelled, which cancels the request in flight.
    static func withTimeout(
        _ seconds: TimeInterval,
        _ work: @escaping @Sendable () async -> RelayCheck.Answer
    ) async -> RelayCheck.Answer {
        let nanoseconds = UInt64(max(0, seconds) * 1_000_000_000)
        return await withTaskGroup(of: RelayCheck.Answer?.self, returning: RelayCheck.Answer.self) { group in
            group.addTask {
                let answer = await work()
                return answer
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: nanoseconds)
                return nil
            }
            var first: RelayCheck.Answer?
            if let next = await group.next() {
                first = next
            }
            group.cancelAll()
            return first ?? .error("no answer")
        }
    }
}
