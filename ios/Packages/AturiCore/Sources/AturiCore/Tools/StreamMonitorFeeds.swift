import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The stream monitor's two sockets. Port of src/utils/atproto/
// reconnectingSocket.ts (a WebSocket that reopens itself), `subscribeJetstream`
// in jetstream.ts (every Jetstream event, identity and account events
// included, where `JetstreamClient` keeps commits only) and plcStream.ts (the
// PLC directory's export stream, resumed from the last `seq` it saw).

/// `SocketStatus`.
public enum StreamSocketStatus: String, Hashable, Sendable {
    case connecting
    case open
    case reconnecting
}

/// What a subscription delivers: its socket's status, or an event.
public enum StreamSocketUpdate<Event: Sendable>: Sendable {
    case status(StreamSocketStatus)
    case event(Event)
}

/// One open feed: its updates, and the way to close it.
public struct StreamSubscription<Event: Sendable>: Sendable {
    public let updates: AsyncStream<StreamSocketUpdate<Event>>
    public let close: @Sendable () -> Void

    public init(updates: AsyncStream<StreamSocketUpdate<Event>>, close: @escaping @Sendable () -> Void) {
        self.updates = updates
        self.close = close
    }
}

/// A WebSocket that reopens itself (`openReconnectingSocket`). Shared by the
/// Jetstream and PLC feeds, which differ only in the URL they open and what
/// they make of each message.
///
/// Reconnects on close with exponential backoff capped at 30 s, and resets
/// the backoff once a connection opens. `url` is called on every attempt
/// rather than once, so a feed can resume from the last cursor it saw.
///
/// URLSession reports no "open" without a delegate, so a connection counts
/// as open at its first message or, on Apple platforms, when the ping sent
/// after the handshake comes back: a narrow Jetstream filter can go a long
/// time without a message, and should not read "connecting" all that while.
public final class StreamReconnectingSocket: @unchecked Sendable {
    /// Backoff ceiling, the web's 30_000 ms.
    public static let maxBackoff: TimeInterval = 30

    private let state = SocketState()

    public init(
        url: @escaping @Sendable () -> URL,
        session: URLSession = JetstreamClient.makeSession(),
        onMessage: @escaping @Sendable (String) -> Void,
        onStatus: @escaping @Sendable (StreamSocketStatus) -> Void
    ) {
        // The loop must not retain the socket object: dropping it should
        // stop reconnecting, which deinit arranges by closing.
        let state = self.state
        state.loop = Task.detached {
            await StreamReconnectingSocket.run(
                url: url, session: session, state: state, onMessage: onMessage, onStatus: onStatus
            )
        }
    }

    deinit {
        close()
    }

    /// Close the socket and cancel any pending reconnect.
    public func close() {
        state.shutdown()
    }

    /// `min(30 s, 1 s * 2^attempt)`.
    public static func backoffDelay(attempt: Int) -> TimeInterval {
        Swift.min(maxBackoff, pow(2, Double(Swift.max(0, attempt))))
    }

    private static func run(
        url: @Sendable () -> URL,
        session: URLSession,
        state: SocketState,
        onMessage: @Sendable (String) -> Void,
        onStatus: @escaping @Sendable (StreamSocketStatus) -> Void
    ) async {
        var attempt = 0
        while !Task.isCancelled {
            onStatus(attempt == 0 ? .connecting : .reconnecting)
            let socket = session.webSocketTask(with: url())
            guard state.adopt(socket) else { break }
            let opened = OpenedFlag()
            socket.resume()
            #if canImport(Darwin)
            socket.sendPing { error in
                if error == nil, opened.mark() {
                    onStatus(.open)
                }
            }
            #endif

            do {
                while !Task.isCancelled {
                    let message = try await receive(from: socket)
                    if opened.mark() {
                        onStatus(.open)
                    }
                    switch message {
                    case .string(let text):
                        onMessage(text)
                    case .data(let data):
                        onMessage(String(decoding: data, as: UTF8.self))
                    @unknown default:
                        break
                    }
                }
            } catch {
                // A closed or failed socket ends the attempt; the loop
                // decides whether there is another.
            }
            state.closeSocket()
            if Task.isCancelled { break }

            if opened.isMarked { attempt = 0 }
            let delay = backoffDelay(attempt: attempt)
            attempt += 1
            onStatus(.reconnecting)
            do {
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            } catch {
                break
            }
        }
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

    /// Whether this attempt's connection has opened; set once.
    private final class OpenedFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false

        /// True the first time only.
        func mark() -> Bool {
            lock.lock(); defer { lock.unlock() }
            if value { return false }
            value = true
            return true
        }

        var isMarked: Bool {
            lock.lock(); defer { lock.unlock() }
            return value
        }
    }

    /// The live socket and the loop, shared between the loop and `close()`.
    private final class SocketState: @unchecked Sendable {
        private let lock = NSLock()
        private var socket: URLSessionWebSocketTask?
        private var task: Task<Void, Never>?
        private var closed = false

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

/// The monitor's two feeds.
public enum StreamMonitorFeeds {
    /// `PLC_EXPORT_STREAM` in src/utils/atproto/config.ts.
    public static let plcExportStream = URL(string: "wss://plc.directory/export/stream")!

    /// Updates held for a slow reader before the oldest are dropped: a
    /// firehose that outpaces its reader must not grow without bound.
    public static let bufferSize = 2048

    /// One session for every feed the monitor opens: a filter change opens
    /// a new socket, and a session apiece would never be released.
    public static let session = JetstreamClient.makeSession()

    /// Every Jetstream event, narrowed server-side by `wantedDids` and
    /// `wantedCollections` (`subscribeJetstream`). Jetstream has no
    /// operation filter, so creates, updates and deletes all arrive, and
    /// identity and account events with them: `wantedCollections` does not
    /// narrow those, only `wantedDids` does.
    public static func jetstream(
        wantedDids: [String],
        wantedCollections: [String],
        endpoint: URL = Endpoints.jetstream,
        session: URLSession = StreamMonitorFeeds.session
    ) -> StreamSubscription<StreamJetstreamEvent> {
        let url = StreamMonitorFeeds.jetstreamURL(wantedDids: wantedDids, wantedCollections: wantedCollections, endpoint: endpoint)
        let (stream, continuation) = AsyncStream.makeStream(
            of: StreamSocketUpdate<StreamJetstreamEvent>.self,
            bufferingPolicy: .bufferingNewest(bufferSize)
        )
        let socket = StreamReconnectingSocket(
            url: { url },
            session: session,
            onMessage: { text in
                // Malformed messages are skipped: Jetstream output is
                // structured, but be defensive against schema changes.
                if let event = StreamMonitor.decodeJetstream(text) {
                    continuation.yield(.event(event))
                }
            },
            onStatus: { status in
                continuation.yield(.status(status))
            }
        )
        continuation.onTermination = { _ in
            socket.close()
        }
        return StreamSubscription(updates: stream, close: {
            socket.close()
            continuation.finish()
        })
    }

    /// The Jetstream address for a filter, as `JetstreamClient` builds it.
    public static func jetstreamURL(wantedDids: [String], wantedCollections: [String], endpoint: URL = Endpoints.jetstream) -> URL {
        JetstreamClient.buildURL(JetstreamOptions(wantedCollections: wantedCollections, wantedDids: wantedDids), endpoint: endpoint)
    }

    /// The PLC directory's operations as they are sequenced
    /// (`subscribePlcStream`). A fresh subscription starts at the live edge;
    /// on a dropped connection it reopens from the last `seq` it saw, so a
    /// blip does not leave a gap.
    public static func plc(
        cursor: Int? = nil,
        endpoint: URL = StreamMonitorFeeds.plcExportStream,
        session: URLSession = StreamMonitorFeeds.session
    ) -> StreamSubscription<PlcStreamEntry> {
        let lastSeq = SeqCursor(cursor ?? 0)
        let (stream, continuation) = AsyncStream.makeStream(
            of: StreamSocketUpdate<PlcStreamEntry>.self,
            bufferingPolicy: .bufferingNewest(bufferSize)
        )
        let socket = StreamReconnectingSocket(
            url: { StreamMonitorFeeds.plcURL(endpoint: endpoint, cursor: lastSeq.value) },
            session: session,
            onMessage: { text in
                guard let entry = StreamMonitor.decodePlc(text) else { return }
                lastSeq.advance(to: entry.seq)
                continuation.yield(.event(entry))
            },
            onStatus: { status in
                continuation.yield(.status(status))
            }
        )
        continuation.onTermination = { _ in
            socket.close()
        }
        return StreamSubscription(updates: stream, close: {
            socket.close()
            continuation.finish()
        })
    }

    /// `?cursor=<seq>` once a sequence number has been seen, the bare stream
    /// before that.
    public static func plcURL(endpoint: URL = StreamMonitorFeeds.plcExportStream, cursor: Int) -> URL {
        guard cursor > 0 else { return endpoint }
        return makeURL(endpoint, path: "", query: [("cursor", String(cursor))])
    }

    /// The highest `seq` seen, read on every reconnect.
    final class SeqCursor: @unchecked Sendable {
        private let lock = NSLock()
        private var seq: Int

        init(_ seq: Int) {
            self.seq = seq
        }

        var value: Int {
            lock.lock(); defer { lock.unlock() }
            return seq
        }

        func advance(to next: Int) {
            lock.lock(); defer { lock.unlock() }
            if next > seq { seq = next }
        }
    }
}
