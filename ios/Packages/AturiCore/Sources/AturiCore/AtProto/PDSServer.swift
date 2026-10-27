import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// PDS-level XRPC helpers, the layer above repos. Port of
/// `src/utils/atproto/pdsServer.ts`.
///
///   - describeServer(pds)  -> server metadata (DID, available domains, links).
///   - serverHealth(pds)    -> implementation version from `_health`.
///   - listRepos(pds, ...)  -> paginated list of repos hosted on the PDS.
///
/// All three wrap public endpoints; no auth required. The host reaching this
/// module is caller-influenced (it comes from a DID document or straight from
/// the explorer's PDS screen), so every read refuses redirects: a PDS
/// answering XRPC has no reason to redirect, and following one would re-point
/// the request at a host nothing has checked.
public struct PDSServer: Sendable {
    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    // MARK: Response shapes

    public struct ServerDescription: Codable, Hashable, Sendable {
        public struct Links: Codable, Hashable, Sendable {
            public var privacyPolicy: String?
            public var termsOfService: String?

            public init(privacyPolicy: String? = nil, termsOfService: String? = nil) {
                self.privacyPolicy = privacyPolicy
                self.termsOfService = termsOfService
            }
        }

        public struct Contact: Codable, Hashable, Sendable {
            public var email: String?

            public init(email: String? = nil) {
                self.email = email
            }
        }

        /// The PDS's own DID (e.g. did:web:pds.example.com). Returned by
        /// recent PDS implementations.
        public var did: String?
        /// Account-creation suffixes accepted by this PDS (e.g. [".bsky.social"]).
        public var availableUserDomains: [String]?
        public var inviteCodeRequired: Bool?
        public var phoneVerificationRequired: Bool?
        public var links: Links?
        public var contact: Contact?

        public init(
            did: String? = nil,
            availableUserDomains: [String]? = nil,
            inviteCodeRequired: Bool? = nil,
            phoneVerificationRequired: Bool? = nil,
            links: Links? = nil,
            contact: Contact? = nil
        ) {
            self.did = did
            self.availableUserDomains = availableUserDomains
            self.inviteCodeRequired = inviteCodeRequired
            self.phoneVerificationRequired = phoneVerificationRequired
            self.links = links
            self.contact = contact
        }
    }

    public struct RepoEntry: Codable, Hashable, Sendable {
        public var did: String
        public var head: String?
        public var rev: String?
        public var active: Bool?
        public var status: String?

        public init(did: String, head: String? = nil, rev: String? = nil, active: Bool? = nil, status: String? = nil) {
            self.did = did
            self.head = head
            self.rev = rev
            self.active = active
            self.status = status
        }
    }

    public struct ListReposPage: Codable, Hashable, Sendable {
        public var cursor: String?
        public var repos: [RepoEntry]

        public init(cursor: String? = nil, repos: [RepoEntry]) {
            self.cursor = cursor
            self.repos = repos
        }

        private enum CodingKeys: String, CodingKey {
            case cursor, repos
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
            repos = try container.decodeIfPresent([RepoEntry].self, forKey: .repos) ?? []
        }
    }

    public struct ServerHealth: Codable, Hashable, Sendable {
        /// Software version reported by the PDS (e.g. "0.4.219").
        public var version: String?

        public init(version: String? = nil) {
            self.version = version
        }
    }

    // MARK: Base helpers

    /// Strip the trailing slash from a PDS URL so concatenation with
    /// `/xrpc/...` is always well-formed. Accepts hostnames or full URLs.
    public static func normalizePdsBase(_ input: String) -> String {
        var url = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if !hasHTTPScheme(url) {
            url = "https://" + url
        }
        if url.hasSuffix("/") {
            url.removeLast()
        }
        return url
    }

    /// Extract the bare host (with port, when there is one) from a URL or
    /// hostname input. Used for the PDS route parameter and screen title.
    public static func pdsHostname(_ input: String) -> String {
        let candidate = hasHTTPScheme(input) ? input : "https://" + input
        if let components = URLComponents(string: candidate), let host = components.host, !host.isEmpty {
            if let port = components.port {
                return host.lowercased() + ":" + String(port)
            }
            return host.lowercased()
        }
        var stripped = input
        if let range = schemeRange(in: stripped) {
            stripped.removeSubrange(range)
        }
        if let slash = stripped.firstIndex(of: "/") {
            stripped = String(stripped[..<slash])
        }
        return stripped
    }

    /// The normalized base as a URL, or nil when the input cannot be one
    /// (whitespace inside, no host at all).
    static func baseURL(_ pds: String) -> URL? {
        let normalized = normalizePdsBase(pds)
        guard let url = URL(string: normalized), let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    private static func hasHTTPScheme(_ s: String) -> Bool {
        schemeRange(in: s) != nil
    }

    /// Case-insensitive `^https?://`.
    private static func schemeRange(in s: String) -> Range<String.Index>? {
        let lower = s.lowercased()
        if lower.hasPrefix("https://") {
            return s.startIndex..<s.index(s.startIndex, offsetBy: 8)
        }
        if lower.hasPrefix("http://") {
            return s.startIndex..<s.index(s.startIndex, offsetBy: 7)
        }
        return nil
    }

    // MARK: Reads

    /// com.atproto.server.describeServer
    public func describeServer(pds: String) async throws -> ServerDescription {
        let base = try PDSServer.requireBase(pds)
        let url = makeURL(base, path: "/xrpc/com.atproto.server.describeServer")
        return try await http.getJSON(ServerDescription.self, from: url, refuseRedirects: true)
    }

    /// Hit `_health` to surface the PDS implementation version. This is a
    /// non-XRPC convenience endpoint on the reference implementation; older
    /// and custom PDSs may 404, so callers should treat failure as "version
    /// unknown" rather than an error condition.
    public func serverHealth(pds: String) async throws -> ServerHealth {
        let base = try PDSServer.requireBase(pds)
        let url = makeURL(base, path: "/xrpc/_health")
        return try await http.getJSON(ServerHealth.self, from: url, refuseRedirects: true)
    }

    /// com.atproto.sync.listRepos (single page).
    public func listRepos(pds: String, limit: Int = 50, cursor: String? = nil) async throws -> ListReposPage {
        let base = try PDSServer.requireBase(pds)
        var query = [("limit", String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        let url = makeURL(base, path: "/xrpc/com.atproto.sync.listRepos", query: query)
        return try await http.getJSON(ListReposPage.self, from: url, refuseRedirects: true)
    }

    static func requireBase(_ pds: String) throws -> URL {
        guard let base = baseURL(pds) else { throw PDSClientError.invalidBase(pds) }
        return base
    }
}

/// A PDS base string that cannot be turned into a URL. The web builds these
/// URLs by string concatenation and lets fetch fail; here the failure is named
/// so the explorer can say "not a host" instead of "network error".
public enum PDSClientError: Error, Equatable, Sendable {
    case invalidBase(String)
}
