import Foundation

/// Reads an OAuth client metadata document for the client checker, port of
/// `src/app/api/tools/oauth/route.ts`.
///
/// A `client_id` is the URL of a public JSON document, on whatever host the
/// client's developer chose, and those hosts rarely allow a cross-origin
/// read, so the web fetches it on its server. The app reads it itself,
/// through `ServiceFetcher`, and reports the facts the spec has rules about:
/// the status, the content type, and whether the address redirected. What
/// they mean is decided by `OAuthChecker`. Only the fields client metadata
/// defines are kept, with the names of any others. The `http://localhost`
/// development form is never fetched (its metadata comes from the URL), and
/// a `jwks_uri` in the document is never followed.
public struct OAuthCheckerClient: Sendable {
    /// Real documents are a kilobyte or two; one with inline keys, a little more.
    static let maxBytes = 64 * 1024

    private let fetcher: ServiceFetcher

    public init(fetcher: ServiceFetcher = .shared) {
        self.fetcher = fetcher
    }

    /// `FETCH_FAILURE` as the OAuth route words it.
    static func failureWords(_ error: Error) -> String {
        guard let failure = error as? ServiceFetchFailure else { return "the request failed" }
        switch failure {
        case .blocked: return "the host is not a public address"
        case .unresolved: return "the hostname does not resolve"
        case .timeout: return "the host did not answer in time"
        case .network: return "the connection failed (refused, reset, or a certificate problem)"
        case .redirects: return "the address redirects too many times"
        }
    }

    /// Fetch and read the document at a hosted `clientId`.
    public func fetch(_ clientId: String) async -> OAuthChecker.ClientMetadataProbe {
        let answer: ServiceFetchResponse
        do {
            answer = try await fetcher.fetch(clientId, maxBytes: Self.maxBytes, accept: "application/json", httpsOnly: true)
        } catch {
            return OAuthChecker.ClientMetadataProbe(clientId: clientId, status: .error, error: Self.failureWords(error))
        }
        if answer.cutOff {
            return OAuthChecker.ClientMetadataProbe(clientId: clientId, status: .error, error: Self.failureWords(ServiceFetchFailure.timeout))
        }
        var probe = OAuthChecker.ClientMetadataProbe(
            clientId: clientId,
            status: .answered,
            httpStatus: answer.status,
            contentType: answer.contentType,
            redirectedFrom: answer.redirectedFrom,
            finalUrl: answer.url
        )
        if answer.truncated {
            probe.bodyProblem = "The response is larger than 64KB, which is not a client metadata document."
            return probe
        }
        guard let body = try? JSONValue.parse(answer.body) else {
            let text = answer.text.trimmingCharacters(in: .whitespacesAndNewlines)
            probe.bodyProblem = text.hasPrefix("<")
                ? "The address returns a web page rather than JSON."
                : "The body is not valid JSON."
            return probe
        }
        guard let object = body.objectValue else {
            probe.bodyProblem = "The body is JSON, but not an object. The document must be a JSON object."
            return probe
        }
        // Only the fields client metadata defines are kept, and the names of
        // the rest: this reads documents, it does not relay whatever JSON an
        // address serves.
        let narrowed = OAuthChecker.narrowClientMetadata(object)
        probe.document = .object(narrowed.document)
        probe.otherFields = narrowed.otherFields
        return probe
    }
}
