import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The three commit operations Jetstream reports.
public enum JetstreamOperation: String, Codable, CaseIterable, Hashable, Sendable {
    case create, update, delete
}

/// A `kind: "commit"` Jetstream event. Port of `JetstreamCommit` in
/// `src/utils/atproto/jetstream.ts`; `record` stays dynamic because the
/// live feed shows every lexicon.
public struct JetstreamCommit: Codable, Hashable, Sendable {
    public struct Commit: Codable, Hashable, Sendable {
        public var rev: String?
        public var operation: JetstreamOperation
        public var collection: String
        public var rkey: String
        public var record: JSONValue?
        public var cid: String?

        public init(
            rev: String? = nil,
            operation: JetstreamOperation,
            collection: String,
            rkey: String,
            record: JSONValue? = nil,
            cid: String? = nil
        ) {
            self.rev = rev
            self.operation = operation
            self.collection = collection
            self.rkey = rkey
            self.record = record
            self.cid = cid
        }
    }

    public var did: String
    /// Firehose timestamp in microseconds since the epoch.
    public var timeUs: Int
    /// Always "commit" for events this client emits.
    public var kind: String
    public var commit: Commit

    public init(did: String, timeUs: Int, kind: String = "commit", commit: Commit) {
        self.did = did
        self.timeUs = timeUs
        self.kind = kind
        self.commit = commit
    }

    private enum CodingKeys: String, CodingKey {
        case did, kind, commit
        case timeUs = "time_us"
    }

    public var atUri: String {
        "at://\(did)/\(commit.collection)/\(commit.rkey)"
    }

    public var time: Date {
        Date(timeIntervalSince1970: Double(timeUs) / 1_000_000)
    }
}

/// Port of `JetstreamOpts`.
public struct JetstreamOptions: Hashable, Sendable {
    public var wantedCollections: [String]
    public var wantedDids: [String]
    /// Commit operations the caller wants to receive. Empty means
    /// `[.create]`, so callers that assume only fresh records come through
    /// keep working; pass all three to surface the full mutation stream.
    public var wantedOps: [JetstreamOperation]
    /// Resume point in microseconds. Nil or zero is omitted from the URL,
    /// as the web's `if (opts.cursor)` does.
    public var cursor: Int?

    public init(
        wantedCollections: [String] = [],
        wantedDids: [String] = [],
        wantedOps: [JetstreamOperation] = [],
        cursor: Int? = nil
    ) {
        self.wantedCollections = wantedCollections
        self.wantedDids = wantedDids
        self.wantedOps = wantedOps
        self.cursor = cursor
    }

    /// The operations that pass the filter.
    public var allowedOps: Set<JetstreamOperation> {
        wantedOps.isEmpty ? [.create] : Set(wantedOps)
    }
}

/// Jetstream WebSocket client, port of `createJetstreamConnection`. Emits
/// commit events as an `AsyncStream`:
///
///     let client = JetstreamClient(options: .init(wantedCollections: ["app.bsky.feed.post"]))
///     for await commit in client.commits { ... }
///     // later:
///     client.cancel()
///
/// The socket opens on construction and reconnects on close with
/// exponential backoff (1 s, 2 s, 4 s, ... capped at 30 s), the counter
/// resetting once a connection delivers a message. `cancel()` closes the
/// socket, stops any pending reconnect and finishes the stream; so does
/// dropping the client or breaking out of the `for await`.
///
/// Events are buffered up to `bufferSize` between arrival and consumption;
/// past that the oldest are dropped, since a firehose that outpaces its
/// reader must not grow without bound.
public final class JetstreamClient: @unchecked Sendable {
    /// Backoff ceiling, matching the web's 30_000 ms.
    public static let maxBackoff: TimeInterval = 30
    /// Events held for a slow consumer before the oldest are discarded.
    public static let bufferSize = 1024

    public let options: JetstreamOptions
    public let url: URL
    public let commits: AsyncStream<JetstreamCommit>

    private let session: URLSession
    private let continuation: AsyncStream<JetstreamCommit>.Continuation
    private let state = ConnectionState()

    /// The last socket failure, for a "reconnecting" affordance. Cleared
    /// when a connection delivers a message.
    public var lastError: Error? {
        state.lastError
    }

    public init(
        options: JetstreamOptions = JetstreamOptions(),
        endpoint: URL = Endpoints.jetstream,
        session: URLSession = JetstreamClient.makeSession()
    ) {
        self.options = options
        self.url = JetstreamClient.buildURL(options, endpoint: endpoint)
        self.session = session
        let (stream, continuation) = AsyncStream.makeStream(
            of: JetstreamCommit.self,
            bufferingPolicy: .bufferingNewest(JetstreamClient.bufferSize)
        )
        self.commits = stream
        self.continuation = continuation

        // The loop must not retain the client: a dropped client should stop
        // reconnecting, which deinit arranges by cancelling the task.
        let state = self.state
        let allowedOps = options.allowedOps
        let url = self.url
        let session = self.session
        continuation.onTermination = { _ in
            state.shutdown()
        }
        state.loop = Task.detached {
            await JetstreamClient.run(
                url: url, session: session, allowedOps: allowedOps, state: state, continuation: continuation
            )
        }
    }

    deinit {
        cancel()
    }

    /// Close the socket, cancel any pending reconnect and finish `commits`.
    public func cancel() {
        state.shutdown()
        continuation.finish()
    }

    /// Port of `buildUrl`: one `wantedCollections` entry per collection,
    /// one `wantedDids` per DID, then `cursor` when non-zero; no query
    /// string at all when nothing was asked for.
    public static func buildURL(_ options: JetstreamOptions, endpoint: URL = Endpoints.jetstream) -> URL {
        var query: [(String, String)] = []
        for collection in options.wantedCollections {
            query.append(("wantedCollections", collection))
        }
        for did in options.wantedDids {
            query.append(("wantedDids", did))
        }
        if let cursor = options.cursor, cursor != 0 {
            query.append(("cursor", String(cursor)))
        }
        return makeURL(endpoint, path: "", query: query)
    }

    /// `min(30 s, 1 s * 2^attempt)`.
    public static func backoffDelay(attempt: Int) -> TimeInterval {
        Swift.min(maxBackoff, pow(2, Double(Swift.max(0, attempt))))
    }

    /// Decode one frame, keeping only commit events for a named collection
    /// whose operation is wanted. Malformed frames, identity and account
    /// events, and unknown operations all read as nil: Jetstream output is
    /// structured, but be defensive against future schema changes.
    public static func decodeCommit(_ data: Data, allowedOps: Set<JetstreamOperation> = [.create]) -> JetstreamCommit? {
        guard let event = try? JSONDecoder().decode(JetstreamCommit.self, from: data) else { return nil }
        guard event.kind == "commit", !event.commit.collection.isEmpty, allowedOps.contains(event.commit.operation) else {
            return nil
        }
        return event
    }

    public static func decodeCommit(_ text: String, allowedOps: Set<JetstreamOperation> = [.create]) -> JetstreamCommit? {
        decodeCommit(Data(text.utf8), allowedOps: allowedOps)
    }

    /// A session of our own: no cookies, and the default request timeout
    /// so a host that accepts the connection and never completes the
    /// handshake gives up rather than hanging the loop.
    public static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration)
    }

    // MARK: Connection loop

    private static func run(
        url: URL,
        session: URLSession,
        allowedOps: Set<JetstreamOperation>,
        state: ConnectionState,
        continuation: AsyncStream<JetstreamCommit>.Continuation
    ) async {
        var attempt = 0
        while !Task.isCancelled {
            let socket = session.webSocketTask(with: url)
            guard state.adopt(socket) else { break }
            socket.resume()

            var delivered = false
            do {
                while !Task.isCancelled {
                    let message = try await receive(from: socket)
                    if !delivered {
                        // The web resets the counter on 'open'; a delivered
                        // frame is the nearest signal URLSession offers
                        // without a delegate.
                        delivered = true
                        attempt = 0
                        state.lastError = nil
                    }
                    if let commit = decode(message, allowedOps: allowedOps) {
                        continuation.yield(commit)
                    }
                }
            } catch {
                if !(error is CancellationError) {
                    state.lastError = error
                }
            }
            state.closeSocket()
            if Task.isCancelled { break }

            let delay = backoffDelay(attempt: attempt)
            attempt += 1
            do {
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            } catch {
                break
            }
        }
        continuation.finish()
    }

    /// `receive()` is not cancellation-aware on every platform, so a
    /// cancelled loop closes the socket, which fails the pending receive.
    private static func receive(from socket: URLSessionWebSocketTask) async throws -> URLSessionWebSocketTask.Message {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await socket.receive()
        } onCancel: {
            socket.cancel(with: .goingAway, reason: nil)
        }
    }

    private static func decode(_ message: URLSessionWebSocketTask.Message, allowedOps: Set<JetstreamOperation>) -> JetstreamCommit? {
        switch message {
        case .string(let text): return decodeCommit(Data(text.utf8), allowedOps: allowedOps)
        case .data(let data): return decodeCommit(data, allowedOps: allowedOps)
        @unknown default: return nil
        }
    }

    /// The live socket, the loop task and the last failure, shared between
    /// the loop, the stream's termination handler and `cancel()`.
    private final class ConnectionState: @unchecked Sendable {
        private let lock = NSLock()
        private var socket: URLSessionWebSocketTask?
        private var task: Task<Void, Never>?
        private var closed = false
        private var error: Error?

        var lastError: Error? {
            get { lock.lock(); defer { lock.unlock() }; return error }
            set { lock.lock(); error = newValue; lock.unlock() }
        }

        /// The reconnect loop; cancelled by `shutdown`, or immediately when
        /// shutdown already happened before the loop was registered.
        var loop: Task<Void, Never>? {
            get { lock.lock(); defer { lock.unlock() }; return task }
            set {
                lock.lock()
                task = newValue
                let alreadyClosed = closed
                lock.unlock()
                if alreadyClosed { newValue?.cancel() }
            }
        }

        /// Register the socket about to be opened; false once shut down.
        func adopt(_ socket: URLSessionWebSocketTask) -> Bool {
            lock.lock(); defer { lock.unlock() }
            if closed { return false }
            self.socket = socket
            return true
        }

        /// Close the current socket between attempts.
        func closeSocket() {
            lock.lock()
            let current = socket
            socket = nil
            lock.unlock()
            current?.cancel(with: .goingAway, reason: nil)
        }

        /// Close for good: no further socket may be adopted, the loop is
        /// cancelled and the live socket closed.
        func shutdown() {
            lock.lock()
            closed = true
            let current = socket
            let running = task
            socket = nil
            lock.unlock()
            running?.cancel()
            current?.cancel(with: .goingAway, reason: nil)
        }
    }
}
