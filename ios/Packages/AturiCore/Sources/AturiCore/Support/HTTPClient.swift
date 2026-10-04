import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A response that arrived but was not a success. Mirrors the web's
/// `if (!res.ok) throw` sites: the status and the body text are what those
/// callers inspect (a 400 `RepoNotFound`, a 404 handle, a 5xx outage).
public struct HTTPError: Error, Sendable {
    public let status: Int
    public let body: String
    public let url: URL

    public init(status: Int, body: String, url: URL) {
        self.status = status
        self.body = body
        self.url = url
    }
}

public enum HTTPFailure: Error {
    /// The body (or its declared Content-Length) exceeded the 2 MiB cap.
    case tooLarge(Int)
    /// The transport delivered something that was not an HTTP response.
    case invalidResponse
    /// A redirect arrived on a request that asked for none; carries the
    /// `Location` the server wanted to send us to (or the request URL when
    /// there was none).
    case redirectRefused(URL)
}

/// One HTTP exchange. `HTTPClient` layers timeouts, retries and the body cap
/// on top; tests substitute a scripted transport.
public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Port of `upstreamFetch` + `readCappedJson` + `identifyingHeaders`.
///
/// Every request is bounded by an 8 s timeout and retried once on a
/// transport-level failure (a reset socket, a timeout), never on an HTTP
/// status, which is a meaningful answer. Bodies are capped at 2 MiB because
/// the PDS clients talk to whatever host a DID document names, and a hostile
/// one can answer a legal request with gigabytes.
///
/// Requests identify the app: PDS hosts and plc.directory are run by
/// individuals and small teams, and an operator seeing unfamiliar traffic
/// should be able to tell whose it is.
public final class HTTPClient: Sendable {
    public static let shared = HTTPClient()

    /// Matches `UPSTREAM_TIMEOUT_MS` / upstreamFetch's per-attempt budget.
    public static let timeout: TimeInterval = 8

    /// Matches `MAX_UPSTREAM_JSON_BYTES`. Generous next to any real XRPC
    /// response; a page of 100 records is under 1 MB.
    public static let maxBodyBytes = 2 * 1024 * 1024

    /// Pause before the single retry, as upstreamFetch's `RETRY_DELAY_MS`.
    private static let retryDelayNanoseconds: UInt64 = 250_000_000

    private let transport: HTTPTransport
    private let userAgent: String

    public init(
        transport: HTTPTransport = URLSessionTransport(),
        userAgent: String = "aturi-ios (+https://aturi.to)"
    ) {
        self.transport = transport
        self.userAgent = userAgent
    }

    /// GET. Throws `HTTPError` for any status outside 2xx, `HTTPFailure` for
    /// an oversized body or a refused redirect, and the transport's own error
    /// (after one retry) when no response arrived at all.
    public func get(
        _ url: URL,
        headers: [String: String] = [:],
        refuseRedirects: Bool = false
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if refuseRedirects {
            request.setValue("1", forHTTPHeaderField: URLSessionTransport.noRedirectHeader)
        }
        let (data, response) = try await send(request)
        if refuseRedirects, (300..<400).contains(response.statusCode) {
            let location = HTTPClient.header("Location", in: response)
                .flatMap { URL(string: $0, relativeTo: url)?.absoluteURL }
            throw HTTPFailure.redirectRefused(location ?? url)
        }
        guard (200..<300).contains(response.statusCode) else {
            throw HTTPError(
                status: response.statusCode,
                body: String(decoding: data, as: UTF8.self),
                url: url
            )
        }
        return (data, response)
    }

    /// GET and decode. Dates are left as strings: atproto timestamps come in
    /// several ISO shapes and `Formatting.isoDate` parses them on demand.
    public func getJSON<T: Decodable>(
        _ type: T.Type,
        from url: URL,
        headers: [String: String] = [:],
        refuseRedirects: Bool = false
    ) async throws -> T {
        let (data, _) = try await get(url, headers: headers, refuseRedirects: refuseRedirects)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// GET returning nil on any failure: the shape of the web's clients that
    /// swallow errors (appview, constellation, slingshot, ufos).
    public func getJSONOrNil<T: Decodable>(
        _ type: T.Type,
        from url: URL,
        headers: [String: String] = [:]
    ) async -> T? {
        try? await getJSON(type, from: url, headers: headers)
    }

    public func getJSONValue(from url: URL, refuseRedirects: Bool = false) async throws -> JSONValue {
        let (data, _) = try await get(url, refuseRedirects: refuseRedirects)
        return try JSONValue.parse(data)
    }

    /// Perform any request (OAuth POSTs included) with the timeout, the
    /// retry and the cap. Unlike `get` this returns every status as a
    /// response: a token endpoint's 400 carries the `DPoP-Nonce` header and
    /// the `use_dpop_nonce` body the caller has to read.
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        request.timeoutInterval = HTTPClient.timeout
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }

        var attempt = 0
        while true {
            do {
                let (data, response) = try await transport.data(for: request)
                try HTTPClient.enforceCap(data: data, response: response)
                return (data, response)
            } catch let error where attempt == 0 && HTTPClient.isTransportError(error) {
                attempt += 1
                try await Task.sleep(nanoseconds: HTTPClient.retryDelayNanoseconds)
            }
        }
    }

    /// Only a failure to get any answer is worth a second try. Our own
    /// failures (cap, refused redirect) and a cancelled task are final.
    private static func isTransportError(_ error: Error) -> Bool {
        if error is CancellationError { return false }
        if error is HTTPFailure || error is HTTPError { return false }
        if let urlError = error as? URLError, urlError.code == .cancelled { return false }
        return true
    }

    /// Trust the declared length first so an oversized answer is refused
    /// before its body is considered, then measure what actually arrived.
    private static func enforceCap(data: Data, response: HTTPURLResponse) throws {
        if let declared = header("Content-Length", in: response).flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }),
            declared > maxBodyBytes {
            throw HTTPFailure.tooLarge(declared)
        }
        if data.count > maxBodyBytes {
            throw HTTPFailure.tooLarge(data.count)
        }
    }

    /// Case-insensitive header lookup. `allHeaderFields` keeps the server's
    /// spelling and Linux Foundation does not fold case for us.
    static func header(_ name: String, in response: HTTPURLResponse) -> String? {
        let wanted = name.lowercased()
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String, key.lowercased() == wanted else { continue }
            return value as? String ?? String(describing: value)
        }
        return nil
    }
}

// MARK: - URL building

/// JavaScript-compatible percent encoding for the URL pieces the web app
/// builds with `encodeURIComponent`: everything but the unreserved set and
/// `!'()*` is escaped, so a DID, an rkey or a handle round-trips byte for
/// byte with the links aturi.to emits.
public enum URIEncoding {
    private static let unreserved: Set<UInt8> = {
        var set = Set<UInt8>()
        for byte in UInt8(ascii: "A")...UInt8(ascii: "Z") { set.insert(byte) }
        for byte in UInt8(ascii: "a")...UInt8(ascii: "z") { set.insert(byte) }
        for byte in UInt8(ascii: "0")...UInt8(ascii: "9") { set.insert(byte) }
        for char in "-_.!~*'()" { set.insert(char.asciiValue!) }
        return set
    }()

    private static let hexDigits = Array("0123456789ABCDEF")

    public static func encodeComponent(_ value: String) -> String {
        var out = ""
        out.reserveCapacity(value.utf8.count)
        for byte in value.utf8 {
            if unreserved.contains(byte) {
                out.unicodeScalars.append(Unicode.Scalar(byte))
            } else {
                out += "%"
                out.append(hexDigits[Int(byte >> 4)])
                out.append(hexDigits[Int(byte & 0x0F)])
            }
        }
        return out
    }
}

/// Append a path to a base URL and attach a query string.
///
/// `path` is raw (not yet percent-encoded) and may start with a slash;
/// characters a path cannot carry are escaped, while `:` and `@` stay as
/// they are so `plc.directory/did:plc:...` reads the way the web prints it.
/// Query names and values are encoded like `encodeURIComponent`, which is
/// what `URLSearchParams` and the web's template strings produce.
public func makeURL(_ base: URL, path: String, query: [(String, String)] = []) -> URL {
    var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        ?? URLComponents()

    let basePath = base.path
    let trimmedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
    var joined = basePath.hasSuffix("/") ? String(basePath.dropLast()) : basePath
    if !trimmedPath.isEmpty {
        joined += "/" + trimmedPath
    }
    if joined.isEmpty { joined = "/" }
    components.percentEncodedPath = joined.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? joined

    if query.isEmpty {
        components.percentEncodedQuery = nil
    } else {
        components.percentEncodedQuery = query
            .map { URIEncoding.encodeComponent($0.0) + "=" + URIEncoding.encodeComponent($0.1) }
            .joined(separator: "&")
    }

    if let url = components.url { return url }

    // URLComponents only refuses input it cannot represent; fall back to the
    // Foundation joiner so a caller always gets a URL back.
    var fallback = base
    for segment in trimmedPath.split(separator: "/") {
        fallback.appendPathComponent(String(segment))
    }
    return fallback
}

// MARK: - URLSession transport

/// The production transport. One `URLSession` with a delegate that owns
/// every in-flight task: data is accumulated per task and the body cap is
/// enforced as bytes arrive, so an oversized answer is cut off at the cap
/// rather than buffered to completion. A request carrying the
/// `X-Aturi-No-Redirect` marker has its redirects refused (the delegate
/// answers `nil` to `willPerformHTTPRedirection`, so the 3xx itself is
/// delivered as the response); the marker never leaves the process.
///
/// Delegate callbacks rather than `URLSession.data(for:)` because on Linux a
/// completion-handler task follows redirects without consulting the delegate.
public struct URLSessionTransport: HTTPTransport {
    /// Internal marker `HTTPClient.get(refuseRedirects:)` sets; stripped here.
    public static let noRedirectHeader = "X-Aturi-No-Redirect"

    private let box: SessionBox

    public init(maxBodyBytes: Int = HTTPClient.maxBodyBytes) {
        box = SessionBox(maxBodyBytes: maxBodyBytes)
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        let refuseRedirects = request.value(forHTTPHeaderField: Self.noRedirectHeader) != nil
        request.setValue(nil, forHTTPHeaderField: Self.noRedirectHeader)
        return try await box.perform(request, refuseRedirects: refuseRedirects)
    }

    private final class SessionBox: @unchecked Sendable {
        private let session: URLSession
        private let delegate: TransportDelegate

        init(maxBodyBytes: Int) {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = HTTPClient.timeout
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            delegate = TransportDelegate(maxBodyBytes: maxBodyBytes)
            session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        }

        func perform(_ request: URLRequest, refuseRedirects: Bool) async throws -> (Data, HTTPURLResponse) {
            let task = session.dataTask(with: request)
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    delegate.register(task, refuseRedirects: refuseRedirects, continuation: continuation)
                    task.resume()
                }
            } onCancel: {
                task.cancel()
            }
        }
    }

    private final class TransportDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private struct Flight {
            var data = Data()
            var failure: Error?
            let refuseRedirects: Bool
            let continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>
        }

        private let maxBodyBytes: Int
        private let lock = NSLock()
        private var flights: [Int: Flight] = [:]

        init(maxBodyBytes: Int) {
            self.maxBodyBytes = maxBodyBytes
        }

        func register(
            _ task: URLSessionTask,
            refuseRedirects: Bool,
            continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>
        ) {
            lock.lock()
            flights[task.taskIdentifier] = Flight(refuseRedirects: refuseRedirects, continuation: continuation)
            lock.unlock()
        }

        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest,
            completionHandler: @escaping (URLRequest?) -> Void
        ) {
            lock.lock()
            let refuse = flights[task.taskIdentifier]?.refuseRedirects ?? false
            lock.unlock()
            completionHandler(refuse ? nil : request)
        }

        func urlSession(
            _ session: URLSession,
            dataTask: URLSessionDataTask,
            didReceive response: URLResponse,
            completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
        ) {
            // A declared length over the cap is refused before a byte of body
            // is read, as readCappedJson does with Content-Length.
            let declared = response.expectedContentLength
            if declared > 0, declared > Int64(maxBodyBytes) {
                fail(dataTask, with: HTTPFailure.tooLarge(Int(clamping: declared)))
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            lock.lock()
            guard var flight = flights[dataTask.taskIdentifier], flight.failure == nil else {
                lock.unlock()
                return
            }
            flight.data.append(data)
            let received = flight.data.count
            flights[dataTask.taskIdentifier] = flight
            lock.unlock()
            if received > maxBodyBytes {
                fail(dataTask, with: HTTPFailure.tooLarge(received))
                dataTask.cancel()
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            lock.lock()
            guard let flight = flights.removeValue(forKey: task.taskIdentifier) else {
                lock.unlock()
                return
            }
            lock.unlock()

            if let failure = flight.failure {
                flight.continuation.resume(throwing: failure)
            } else if let error = error {
                flight.continuation.resume(throwing: error)
            } else if let response = task.response as? HTTPURLResponse {
                flight.continuation.resume(returning: (flight.data, response))
            } else {
                flight.continuation.resume(throwing: HTTPFailure.invalidResponse)
            }
        }

        /// Record why a task is being cancelled so the completion callback
        /// reports our reason rather than URLSession's generic "cancelled".
        private func fail(_ task: URLSessionTask, with error: Error) {
            lock.lock()
            if flights[task.taskIdentifier]?.failure == nil {
                flights[task.taskIdentifier]?.failure = error
            }
            lock.unlock()
        }
    }
}
