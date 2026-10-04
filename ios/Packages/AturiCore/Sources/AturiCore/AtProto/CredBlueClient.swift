import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A cached cred.blue score. Port of `CredBlueScore` in
/// `src/utils/credBlueScore.ts`.
public struct CredBlueScore: Codable, Hashable, Sendable {
    public struct Scores: Codable, Hashable, Sendable {
        public var combined: Double
        public var bluesky: Double
        public var atproto: Double

        public init(combined: Double, bluesky: Double, atproto: Double) {
            self.combined = combined
            self.bluesky = bluesky
            self.atproto = atproto
        }
    }

    public var handle: String
    public var did: String
    public var scores: Scores
    public var cachedAt: String?
    public var version: String?
    /// "memory" or "supabase" on the web; left open here.
    public var source: String?
    public var ageMs: Double?

    public init(
        handle: String,
        did: String,
        scores: Scores,
        cachedAt: String? = nil,
        version: String? = nil,
        source: String? = nil,
        ageMs: Double? = nil
    ) {
        self.handle = handle
        self.did = did
        self.scores = scores
        self.cachedAt = cachedAt
        self.version = version
        self.source = source
        self.ageMs = ageMs
    }
}

/// cred.blue client, port of `src/utils/credBlueScore.ts` plus the profile
/// link `CredBlueScore.tsx` builds.
public struct CredBlueClient: Sendable {
    /// `CRED_BLUE_BASE`: where the badge links to.
    public static let profileBase = URL(string: "https://cred.blue")!

    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    /// The cached score for a handle or DID. Nil when no cached score exists
    /// (HTTP 204 or 404) or on any error; the endpoint never triggers a
    /// fresh compute on the backend.
    public func fetchCachedScore(_ identifier: String) async -> CredBlueScore? {
        guard let url = CredBlueClient.scoreURL(for: identifier) else { return nil }
        do {
            let (data, response) = try await http.get(url, headers: ["Accept": "application/json"])
            if response.statusCode == 204 { return nil }
            return try? JSONDecoder().decode(CredBlueScore.self, from: data)
        } catch {
            return nil
        }
    }

    /// `https://api.cred.blue/api/score/{identifier}` with one leading `@`
    /// dropped; nil for an empty identifier.
    public static func scoreURL(for identifier: String) -> URL? {
        guard !identifier.isEmpty else { return nil }
        return encodedPathURL(Endpoints.credBlueAPI, "/api/score/" + URIEncoding.encodeComponent(stripAt(identifier)))
    }

    /// `https://cred.blue/{handle}`, the badge's outbound link.
    public static func profileURL(for handle: String) -> URL {
        encodedPathURL(profileBase, "/" + URIEncoding.encodeComponent(stripAt(handle)))
    }

    private static func stripAt(_ identifier: String) -> String {
        identifier.hasPrefix("@") ? String(identifier.dropFirst()) : identifier
    }

    /// The web puts an `encodeURIComponent` segment straight into the path,
    /// so a DID reads `did%3Aplc%3A...`. `makeURL` would escape the percent
    /// signs again; the already-encoded path goes in as is instead.
    private static func encodedPathURL(_ base: URL, _ percentEncodedPath: String) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.percentEncodedPath = percentEncodedPath
        return components.url ?? makeURL(base, path: percentEncodedPath)
    }
}
