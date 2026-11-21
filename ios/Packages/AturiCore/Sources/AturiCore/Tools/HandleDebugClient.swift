import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The handle debugger's lookups, port of the evidence-gathering half of
/// `src/components/tools/HandleDebugger.tsx` and of the route it asks,
/// `src/app/api/tools/handle/route.ts`.
///
/// The route exists because a browser has no DNS API and cannot read the
/// well-known file of an arbitrary host. The app can do both, so it asks the
/// same resolver the site does (`DNSTXTClient`, dns.google) and reads the
/// file itself, with the route's rules: https only, on the first request and
/// on every redirect, at most three redirects, followed by hand so each hop
/// is checked. Nothing here throws: a step that could not be made is
/// evidence too, and comes back as such.
public struct HandleDebugClient: Sendable {
    /// `maxRedirects` in guardedFetch.ts.
    public static let maxRedirects = 3
    /// `WELL_KNOWN_MAX_BYTES`: a DID is short, so more than this is not one.
    public static let wellKnownMaxBytes = 2048
    /// The route keeps the first 400 characters of the body as evidence.
    public static let wellKnownBodyLimit = 400

    private static let redirectStatuses: Set<Int> = [301, 302, 303, 307, 308]

    private let http: HTTPClient
    private let dns: DNSTXTClient
    private let resolver: IdentityResolver
    private let pds: PDSClient

    public init(http: HTTPClient = .shared, resolver: IdentityResolver? = nil) {
        self.http = http
        dns = DNSTXTClient(http: http)
        self.resolver = resolver ?? (http === HTTPClient.shared ? IdentityResolver.shared : IdentityResolver(http: http))
        pds = PDSClient(http: http)
    }

    // MARK: handle -> DID

    /// Both resolution methods at once, as the route makes them.
    public func probe(_ handle: String) async -> HandleDebug.Probe {
        async let txtLookup = dns.lookup("_atproto.\(handle)")
        async let fileLookup = readWellKnown(handle)
        let txt = await txtLookup
        let file = await fileLookup
        return HandleDebug.Probe(handle: handle, dns: txt, http: file)
    }

    /// `GET https://<handle>/.well-known/atproto-did`, reported as found:
    /// the status, type and the start of the body the host returned, and
    /// where it ended up when it redirected (`readWellKnownFile`).
    public func readWellKnown(_ handle: String) async -> HandleDebug.HTTPProbe {
        let address = "https://\(handle)/.well-known/atproto-did"
        guard var current = URL(string: address) else {
            return HandleDebug.HTTPProbe(url: address, status: .error, error: "the request failed")
        }
        for _ in 0...HandleDebugClient.maxRedirects {
            var request = URLRequest(url: current)
            request.httpMethod = "GET"
            request.setValue("text/plain, */*;q=0.5", forHTTPHeaderField: "Accept")
            // Each redirect is looked at before it is followed.
            request.setValue("1", forHTTPHeaderField: URLSessionTransport.noRedirectHeader)

            let exchange: (Data, HTTPURLResponse)
            do {
                exchange = try await http.send(request)
            } catch {
                return HandleDebug.HTTPProbe(url: address, status: .error, error: HandleDebugClient.describeFetchFailure(error))
            }
            let (data, response) = exchange

            if HandleDebugClient.redirectStatuses.contains(response.statusCode) {
                guard let location = HTTPClient.header("Location", in: response), !location.isEmpty,
                    let next = URL(string: location, relativeTo: current)?.absoluteURL
                else {
                    return HandleDebug.HTTPProbe(url: address, status: .error, error: "the address redirects too many times")
                }
                guard next.scheme?.lowercased() == "https" else {
                    return HandleDebug.HTTPProbe(url: address, status: .error, error: "the address redirects to a URL that is not https")
                }
                current = next
                continue
            }

            let text = String(decoding: data.prefix(HandleDebugClient.wellKnownMaxBytes), as: UTF8.self)
            let body = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(HandleDebugClient.wellKnownBodyLimit))
            return HandleDebug.HTTPProbe(
                url: address,
                status: .answered,
                httpStatus: response.statusCode,
                contentType: HTTPClient.header("Content-Type", in: response),
                body: body,
                finalUrl: current.absoluteString
            )
        }
        return HandleDebug.HTTPProbe(url: address, status: .error, error: "the address redirects too many times")
    }

    /// `FETCH_FAILURE` in the route, for what a device can tell apart.
    static func describeFetchFailure(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotFindHost, .dnsLookupFailed:
                return "the domain has no address record, so there is no web server to ask"
            case .timedOut:
                return "the host did not answer in time"
            default:
                return "the connection failed (refused, reset, or a certificate problem)"
            }
        }
        if let failure = error as? HTTPFailure, case .tooLarge = failure {
            return "the host answered with far more than a DID"
        }
        return "the request failed"
    }

    // MARK: DID -> handle

    /// The DID document, did:plc from plc.directory and did:web from its
    /// host, through the explorer's resolver (no redirects followed).
    public func document(_ did: String) async -> HandleDebug.Step<DIDDocument> {
        do {
            return .done(try await resolver.loadDIDDocument(did))
        } catch {
            return .failed(HandleDebugClient.describeDocumentFailure(error))
        }
    }

    /// What `fetchDidDocument` would have thrown, in its words where it has
    /// them.
    static func describeDocumentFailure(_ error: Error) -> String {
        if let httpError = error as? HTTPError {
            return "HTTP \(httpError.status)"
        }
        if error is IdentityResolverError {
            return "Only did:plc and did:web can be resolved"
        }
        if let failure = error as? HTTPFailure, case .redirectRefused = failure {
            return "the document's address redirects elsewhere"
        }
        if error is DecodingError {
            return "the answer is not a DID document"
        }
        return "no answer"
    }

    // MARK: The account

    /// describeRepo and getRepoStatus side by side. Unreachable only when
    /// neither answered, as the page reads it.
    public func pdsState(endpoint: String, did: String) async -> HandleDebug.PDSState {
        var base = endpoint
        if base.hasSuffix("/") {
            base.removeLast()
        }
        async let repoLookup = describeRepo(base, did)
        async let statusLookup = repoStatus(base, did)
        let repo = await repoLookup
        let status = await statusLookup
        guard repo != nil || status != nil else {
            return HandleDebug.PDSState(endpoint: base, reachable: false)
        }
        return HandleDebug.PDSState(
            endpoint: base,
            reachable: true,
            handle: repo?.handle,
            handleIsCorrect: repo?.handleIsCorrect,
            active: status?.active,
            status: status?.status
        )
    }

    private func describeRepo(_ base: String, _ did: String) async -> DescribeRepoResponse? {
        try? await pds.describeRepo(pds: base, repo: did)
    }

    private func repoStatus(_ base: String, _ did: String) async -> RepoStatus? {
        try? await pds.getRepoStatus(host: base, did: did)
    }

    /// The handle Bluesky's AppView shows for the DID, or why it has none.
    public func appView(_ did: String) async -> HandleDebug.AppViewState {
        let url = makeURL(Endpoints.appView, path: "/xrpc/app.bsky.actor.getProfile", query: [("actor", did)])
        do {
            let body = try await http.getJSONValue(from: url)
            return HandleDebug.AppViewState(handle: body["handle"]?.stringValue)
        } catch let error as HTTPError {
            return HandleDebug.AppViewState(error: "HTTP \(error.status)")
        } catch {
            return HandleDebug.AppViewState(error: "no answer")
        }
    }
}
