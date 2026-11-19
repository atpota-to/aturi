import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// What the four "services" tools share: the feed inspector, the OAuth client
// checker, the share button builder and the page checker
// (src/components/tools/FeedInspector.tsx, OAuthChecker.tsx,
// ShareBuilder.tsx, PageChecker.tsx).
//
// Each web tool keeps its own `…CheckStatus` and `…Check` types with the same
// fields; here they are one pair, `ServiceCheck` and `ServiceVerdict`, so the
// app draws all four check lists the same way.
//
// The rest is the bounded fetch those tools make of a host somebody else
// chose: a feed generator, a client metadata document, a web page. On the web
// those reads happen in src/app/api/tools/* because a browser cannot read
// other origins, through `guardedFetch` (src/lib/tools/server/guardedFetch.ts)
// and `fetchPageHtml` (src/utils/fetchPageHtml.ts). The app has no such
// limit and asks the host itself, keeping the same rules: every hop is
// checked before it is dialled and redirects are followed by hand, the body
// is read to a byte cap, and the whole exchange has a deadline.

/// How one step of a check came out, the web tools' `CheckStatus`. `skip`
/// could not be run because an earlier step failed.
public enum ServiceCheckStatus: String, Hashable, Sendable {
    case pass
    case warn
    case fail
    case info
    case skip
    case pending
}

/// One row of a check list: `FeedCheck`, `OAuthCheck` and `PageCheck`.
public struct ServiceCheck: Hashable, Sendable, Identifiable {
    public var id: String
    public var status: ServiceCheckStatus
    public var title: String
    public var summary: String
    /// Evidence, one line each.
    public var detail: [String]
    /// What to change, one paragraph each.
    public var fix: [String]

    public init(
        id: String,
        status: ServiceCheckStatus,
        title: String,
        summary: String,
        detail: [String] = [],
        fix: [String] = []
    ) {
        self.id = id
        self.status = status
        self.title = title
        self.summary = summary
        self.detail = detail
        self.fix = fix
    }
}

/// The one-line answer above a check list.
public struct ServiceVerdict: Hashable, Sendable {
    public enum Tone: String, Hashable, Sendable {
        case pass
        case warn
        case fail
        case info
        case pending
    }

    public var tone: Tone
    public var title: String
    public var text: String

    public init(tone: Tone, title: String, text: String) {
        self.tone = tone
        self.title = title
        self.text = text
    }
}

/// A step of a run that is observed later: still on its way, made and failed,
/// or done. The web spells the first two `undefined` and `null`.
public enum ServiceStep<Value: Hashable & Sendable>: Hashable, Sendable {
    case pending
    case failed
    case done(Value)

    public var value: Value? {
        if case .done(let value) = self { return value }
        return nil
    }

    public var isPending: Bool {
        if case .pending = self { return true }
        return false
    }
}

// MARK: - Small text helpers

enum ServiceFormat {
    /// `n.toLocaleString('en-US')`: digits grouped by thousands.
    static func grouped(_ n: Int) -> String {
        let digits = Array(String(n.magnitude))
        var out = ""
        for (index, digit) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(digit)
        }
        return n < 0 ? "-" + out : out
    }

    /// JavaScript's `String(value)` for a JSON value, as the web prints a
    /// field it found the wrong type.
    static func jsString(_ value: JSONValue?) -> String {
        guard let value else { return "undefined" }
        switch value {
        case .string(let s): return s
        case .number: return value.compactString()
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array(let items): return items.map { $0.isNull ? "" : jsString($0) }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    /// The first character upper-cased, as the web's `sentence`.
    static func sentence(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }

    /// `str.slice(0, n)`, by characters.
    static func clip(_ text: String, _ n: Int) -> String {
        text.count > n ? String(text.prefix(n)) : text
    }
}

/// A query string read the way `URLSearchParams` reads one: `&`-separated
/// pairs split at the first `=`, a `+` read as a space, then percent-decoded.
enum ServiceQuery {
    static func pairs(_ query: String?) -> [(String, String)] {
        guard let query, !query.isEmpty else { return [] }
        var out: [(String, String)] = []
        for piece in query.split(separator: "&", omittingEmptySubsequences: true) {
            let part = String(piece)
            let name: String
            let value: String
            if let equals = part.firstIndex(of: "=") {
                name = String(part[part.startIndex..<equals])
                value = String(part[part.index(after: equals)...])
            } else {
                name = part
                value = ""
            }
            out.append((decode(name), decode(value)))
        }
        return out
    }

    static func values(_ name: String, in query: String?) -> [String] {
        pairs(query).filter { $0.0 == name }.map { $0.1 }
    }

    private static func decode(_ raw: String) -> String {
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
    }
}

// MARK: - The bounded fetch

/// Why a host could not be read, `GuardedFetchFailure`.
public enum ServiceFetchFailure: String, Error, Hashable, Sendable {
    /// Not a URL, not http(s), or a private or internal address.
    case blocked
    /// The host has no DNS record.
    case unresolved
    case timeout
    /// Refused, reset, or a TLS failure.
    case network
    case redirects
}

/// What a host answered, `GuardedResponse`.
public struct ServiceFetchResponse: Hashable, Sendable {
    /// The URL that finally answered, after any redirects.
    public var url: String
    /// Each URL a redirect led away from, in order.
    public var redirectedFrom: [String]
    public var status: Int
    public var contentType: String?
    /// The body, up to the cap.
    public var body: Data
    /// The body was longer than the cap and was cut there.
    public var truncated: Bool
    /// The body stopped part-way: the deadline passed, or the connection
    /// dropped, after the headers had arrived.
    public var cutOff: Bool

    public init(
        url: String,
        redirectedFrom: [String] = [],
        status: Int,
        contentType: String? = nil,
        body: Data,
        truncated: Bool = false,
        cutOff: Bool = false
    ) {
        self.url = url
        self.redirectedFrom = redirectedFrom
        self.status = status
        self.contentType = contentType
        self.body = body
        self.truncated = truncated
        self.cutOff = cutOff
    }

    /// The body as text. A cut that splits a character leaves a replacement
    /// character at the end, as `TextDecoder` does.
    public var text: String {
        String(decoding: body, as: UTF8.self)
    }
}

/// One hop as the transport delivered it.
struct ServiceRawResponse: Sendable {
    var response: HTTPURLResponse
    var data: Data
    var truncated: Bool
    var cutOff: Bool
}

/// A guarded, bounded GET of a URL named by somebody else: port of
/// `guardedFetch` and, with `httpsOnly` off and `keepPartial`, of the
/// page checker's `fetchPageHtml`.
///
/// The web's guard also resolves the name and refuses one that points at a
/// private address. Here the check is on the name as written
/// (`isBlockedHost`, the port of src/utils/ssrfGuard.ts): the request comes
/// from a phone rather than a server, so there is no deployment network to
/// probe, but a record or a DID document anyone can write should not be able
/// to aim the phone at the network it is on either.
public struct ServiceFetcher: Sendable {
    public static let shared = ServiceFetcher()

    /// `DEFAULT_TIMEOUT_MS`.
    public static let defaultTimeout: TimeInterval = 6
    static let redirectStatuses: Set<Int> = [301, 302, 303, 307, 308]

    private enum Backend: Sendable {
        case session(ServiceSession)
        case transport(HTTPTransport)
    }

    private let backend: Backend
    private let userAgent: String

    /// The production fetcher: its own URLSession, which never follows a
    /// redirect by itself and stops reading at the cap.
    public init(userAgent: String = "aturi-ios (+https://aturi.to)") {
        backend = .session(ServiceSession.shared)
        self.userAgent = userAgent
    }

    /// For tests: a scripted transport. The cap is applied to what it returns.
    public init(transport: HTTPTransport, userAgent: String = "aturi-ios (+https://aturi.to)") {
        backend = .transport(transport)
        self.userAgent = userAgent
    }

    /// GET `rawURL`, following up to `maxRedirects` redirects by hand. Throws
    /// `ServiceFetchFailure` when there is no answer to report, and
    /// `CancellationError` when the task was cancelled.
    public func fetch(
        _ rawURL: String,
        maxBytes: Int,
        timeout: TimeInterval = ServiceFetcher.defaultTimeout,
        accept: String? = nil,
        httpsOnly: Bool = false,
        maxRedirects: Int = 3,
        userAgent: String? = nil
    ) async throws -> ServiceFetchResponse {
        let deadline = Date().addingTimeInterval(timeout)
        var redirectedFrom: [String] = []
        var current = rawURL
        var hop = 0
        while hop <= maxRedirects {
            guard let url = URL(string: current),
                let scheme = url.scheme?.lowercased(),
                let host = url.host, !host.isEmpty
            else { throw ServiceFetchFailure.blocked }
            if scheme != "https" && (httpsOnly || scheme != "http") {
                throw ServiceFetchFailure.blocked
            }
            if url.user != nil || url.password != nil {
                throw ServiceFetchFailure.blocked
            }
            if ServiceFetcher.isBlockedHost(host) {
                throw ServiceFetchFailure.blocked
            }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 {
                throw ServiceFetchFailure.timeout
            }

            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue(userAgent ?? self.userAgent, forHTTPHeaderField: "User-Agent")
            if let accept {
                request.setValue(accept, forHTTPHeaderField: "Accept")
            }
            let raw = try await perform(request, maxBytes: maxBytes, timeout: remaining)
            let status = raw.response.statusCode

            if ServiceFetcher.redirectStatuses.contains(status) {
                guard let location = HTTPClient.header("Location", in: raw.response) else {
                    throw ServiceFetchFailure.redirects
                }
                redirectedFrom.append(url.absoluteString)
                guard let next = URL(string: location, relativeTo: url)?.absoluteURL else {
                    throw ServiceFetchFailure.redirects
                }
                current = next.absoluteString
                hop += 1
                continue
            }

            return ServiceFetchResponse(
                url: url.absoluteString,
                redirectedFrom: redirectedFrom,
                status: status,
                contentType: HTTPClient.header("Content-Type", in: raw.response),
                body: raw.data,
                truncated: raw.truncated,
                cutOff: raw.cutOff
            )
        }
        throw ServiceFetchFailure.redirects
    }

    private func perform(_ request: URLRequest, maxBytes: Int, timeout: TimeInterval) async throws -> ServiceRawResponse {
        switch backend {
        case .session(let session):
            return try await session.fetch(request, maxBytes: maxBytes, timeout: timeout)
        case .transport(let transport):
            let result: (Data, HTTPURLResponse)
            do {
                result = try await transport.data(for: request)
            } catch {
                throw ServiceFetcher.classify(error)
            }
            let data = result.0
            if data.count > maxBytes {
                return ServiceRawResponse(response: result.1, data: Data(data.prefix(maxBytes)), truncated: true, cutOff: false)
            }
            return ServiceRawResponse(response: result.1, data: data, truncated: false, cutOff: false)
        }
    }

    /// A transport error as one of the failures the tools report. A
    /// cancelled task stays a cancellation, so the caller can drop it.
    static func classify(_ error: Error) -> Error {
        if error is ServiceFetchFailure || error is CancellationError { return error }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled:
                return CancellationError()
            case .timedOut:
                return ServiceFetchFailure.timeout
            case .cannotFindHost, .dnsLookupFailed:
                return ServiceFetchFailure.unresolved
            default:
                return ServiceFetchFailure.network
            }
        }
        return ServiceFetchFailure.network
    }

    // MARK: Hosts

    /// `isBlockedFetchHost` from src/utils/ssrfGuard.ts: loopback,
    /// link-local, private and internal names, refused by the name as
    /// written.
    ///
    /// One addition: the WHATWG URL parser rewrites an IPv4 address spelled
    /// as one number (`2130706433`) or in hex or octal into dotted quads
    /// before the web's check sees it, and Foundation does not, so a host
    /// whose last label is a number but which is not a plain dotted quad is
    /// refused here. A real hostname never ends in a numeric label.
    public static func isBlockedHost(_ hostname: String) -> Bool {
        let host = canonicalHost(hostname)
        if host.isEmpty { return true }
        let isIPv6Literal = host.contains(":")
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host.hasSuffix(".internal") {
            return true
        }
        if host == "0.0.0.0" || host == "::1" || host == "::" {
            return true
        }
        if isIPv6Literal && (host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80")) {
            return true
        }
        if !isIPv6Literal, let last = host.split(separator: ".").last {
            let numeric = last.allSatisfy { $0.isASCII && $0.isNumber } || last.hasPrefix("0x")
            if numeric && !isDottedQuad(host) { return true }
        }
        if host.hasPrefix("127.") || host.hasPrefix("10.") || host.hasPrefix("192.168.") || host.hasPrefix("169.254.") {
            return true
        }
        if host.hasPrefix("172.") {
            let parts = host.split(separator: ".")
            if parts.count > 1, let second = Int(parts[1]), (16...31).contains(second) { return true }
        }
        return false
    }

    /// `canonicalizeHost`: lower case, no IPv6 brackets, no trailing dot,
    /// and an IPv4-mapped IPv6 address read as the IPv4 address it embeds.
    static func canonicalHost(_ hostname: String) -> String {
        var host = hostname.lowercased()
        if host.hasPrefix("[") { host.removeFirst() }
        if host.hasSuffix("]") { host.removeLast() }
        if host.count > 1, host.hasSuffix(".") { host.removeLast() }
        if host.hasPrefix("::ffff:") {
            let rest = String(host.dropFirst("::ffff:".count))
            if isDottedQuad(rest) { return rest }
            let groups = rest.split(separator: ":", omittingEmptySubsequences: false)
            if groups.count == 2, groups.allSatisfy({ (1...4).contains($0.count) }),
                let high = Int(groups[0], radix: 16), let low = Int(groups[1], radix: 16) {
                return "\(high >> 8).\(high & 255).\(low >> 8).\(low & 255)"
            }
        }
        return host
    }

    /// Four decimal parts of one to three digits, as `\d{1,3}(\.\d{1,3}){3}`.
    static func isDottedQuad(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { part in
            (1...3).contains(part.count) && part.allSatisfy { $0.isASCII && $0.isNumber }
        }
    }
}

// MARK: - URLSession

/// The session behind `ServiceFetcher.shared`. Unlike the app's main
/// transport (`URLSessionTransport`), which refuses an oversized answer
/// outright, this one keeps the first `maxBytes` and stops reading, since a
/// tool reports "too long" or reads the part that arrived. Redirects are
/// never followed here: the fetcher checks each hop first. Each request
/// carries its own deadline, and a body cut off by it, or by the connection,
/// is handed back with what had arrived.
final class ServiceSession: @unchecked Sendable {
    static let shared = ServiceSession()

    private let session: URLSession
    private let delegate: ServiceSessionDelegate

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        delegate = ServiceSessionDelegate()
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    func fetch(_ request: URLRequest, maxBytes: Int, timeout: TimeInterval) async throws -> ServiceRawResponse {
        var request = request
        request.timeoutInterval = max(1, timeout)
        let task = session.dataTask(with: request)
        let delegate = delegate
        do {
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    delegate.register(task, maxBytes: maxBytes, continuation: continuation)
                    task.resume()
                    delegate.armDeadline(for: task.taskIdentifier, after: timeout)
                }
            } onCancel: {
                task.cancel()
            }
        } catch {
            throw ServiceFetcher.classify(error)
        }
    }
}

final class ServiceSessionDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private struct Flight {
        var data = Data()
        var truncated = false
        var timedOut = false
        let maxBytes: Int
        let task: URLSessionTask
        let continuation: CheckedContinuation<ServiceRawResponse, Error>
    }

    private let lock = NSLock()
    private var flights: [Int: Flight] = [:]

    func register(_ task: URLSessionTask, maxBytes: Int, continuation: CheckedContinuation<ServiceRawResponse, Error>) {
        lock.lock()
        flights[task.taskIdentifier] = Flight(maxBytes: maxBytes, task: task, continuation: continuation)
        lock.unlock()
    }

    /// Cancel the task when its deadline passes, remembering why so the
    /// completion reports a timeout rather than a cancellation.
    func armDeadline(for id: Int, after seconds: TimeInterval) {
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let task = self.flights[id]?.task
            if task != nil {
                self.flights[id]?.timedOut = true
            }
            self.lock.unlock()
            task?.cancel()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // The 3xx itself becomes the response; the fetcher decides.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard var flight = flights[dataTask.taskIdentifier], !flight.truncated else {
            lock.unlock()
            return
        }
        let room = flight.maxBytes - flight.data.count
        if data.count > room {
            if room > 0 {
                flight.data.append(data.prefix(room))
            }
            flight.truncated = true
            flights[dataTask.taskIdentifier] = flight
            lock.unlock()
            dataTask.cancel()
            return
        }
        flight.data.append(data)
        flights[dataTask.taskIdentifier] = flight
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let removed = flights.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let flight = removed else { return }

        let response = task.response as? HTTPURLResponse
        if flight.truncated, let response {
            flight.continuation.resume(returning: ServiceRawResponse(response: response, data: flight.data, truncated: true, cutOff: false))
            return
        }
        if let error {
            if let response {
                // The headers arrived and the body did not finish: hand back
                // what came, and let the tool decide what a partial body means.
                flight.continuation.resume(returning: ServiceRawResponse(response: response, data: flight.data, truncated: false, cutOff: true))
            } else if flight.timedOut {
                flight.continuation.resume(throwing: ServiceFetchFailure.timeout)
            } else {
                flight.continuation.resume(throwing: error)
            }
            return
        }
        if let response {
            flight.continuation.resume(returning: ServiceRawResponse(response: response, data: flight.data, truncated: false, cutOff: false))
        } else {
            flight.continuation.resume(throwing: ServiceFetchFailure.network)
        }
    }
}
