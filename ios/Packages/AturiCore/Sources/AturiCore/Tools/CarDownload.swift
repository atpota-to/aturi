import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// What came back for an export request: the status and the body.
public struct CarDownloadResponse: Sendable {
    public var status: Int
    public var body: [UInt8]

    public init(status: Int, body: [UInt8]) {
        self.status = status
        self.body = body
    }
}

public enum CarDownloadError: Error, Hashable, Sendable {
    /// The export passed the cap, declared or as it arrived.
    case tooLarge
    /// The PDS answered with a redirect, which is not followed.
    case redirected
}

/// Fetches a repository export. The inspector's own seam, rather than
/// `HTTPTransport`, because an export is not an XRPC answer: it runs to many
/// megabytes, past `HTTPClient`'s cap on purpose, and the page counts the
/// bytes as they arrive.
public protocol CarArchiveDownloading: Sendable {
    /// GET `url`, keeping at most `cap` bytes of body and reporting how many
    /// have arrived as they do. Throws `CarDownloadError.tooLarge` past the
    /// cap, and the transport's error when no response arrived.
    func download(_ url: URL, cap: Int, onProgress: @escaping @Sendable (Int) -> Void) async throws -> CarDownloadResponse
}

/// The export download, port of `download` in `CarInspector.tsx`: straight
/// from the PDS, bytes counted on the way, and dropped past the cap rather
/// than left to fill memory, since the PDS sends no length up front. A PDS
/// address comes from a DID document anyone can write, so a redirect is
/// refused, as every PDS read in the app refuses one.
///
/// One `URLSession` per download, invalidated when it ends, so the session
/// and its delegate do not outlive the export.
public struct URLSessionCarDownloader: CarArchiveDownloading {
    /// How long the PDS may go quiet before the download is given up. A
    /// large export can take a while to start while the PDS gathers it.
    public static let idleTimeout: TimeInterval = 60

    private let userAgent: String

    public init(userAgent: String = "aturi-ios (+https://aturi.to)") {
        self.userAgent = userAgent
    }

    public func download(_ url: URL, cap: Int, onProgress: @escaping @Sendable (Int) -> Void) async throws -> CarDownloadResponse {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = Self.idleTimeout
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.ipld.car", forHTTPHeaderField: "Accept")

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.idleTimeout
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        let delegate = CarDownloadDelegate(cap: cap, onProgress: onProgress)
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let task = session.dataTask(with: request)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CarDownloadResponse, Error>) in
                delegate.wait(continuation)
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }
}

private final class CarDownloadDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    /// Progress is reported at most this often, so the page reads as live
    /// without a redraw for every packet.
    private static let reportInterval: TimeInterval = 0.12

    private let cap: Int
    private let onProgress: @Sendable (Int) -> Void
    private let lock = NSLock()
    private var body: [UInt8] = []
    private var failure: Error?
    private var continuation: CheckedContinuation<CarDownloadResponse, Error>?
    private var lastReport = Date.distantPast

    init(cap: Int, onProgress: @escaping @Sendable (Int) -> Void) {
        self.cap = cap
        self.onProgress = onProgress
    }

    func wait(_ continuation: CheckedContinuation<CarDownloadResponse, Error>) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Answering nil delivers the 3xx itself as the response.
        completionHandler(nil)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let declared = response.expectedContentLength
        if declared > 0, declared > Int64(cap) {
            fail(CarDownloadError.tooLarge)
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        if failure != nil {
            lock.unlock()
            return
        }
        body.append(contentsOf: data)
        let received = body.count
        let now = Date()
        let report = now.timeIntervalSince(lastReport) >= Self.reportInterval
        if report {
            lastReport = now
        }
        lock.unlock()

        if received > cap {
            fail(CarDownloadError.tooLarge)
            dataTask.cancel()
            return
        }
        if report {
            onProgress(received)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        let failure = self.failure
        let body = self.body
        self.body = []
        lock.unlock()
        guard let continuation else { return }

        if let failure {
            continuation.resume(throwing: failure)
        } else if let error {
            continuation.resume(throwing: error)
        } else if let response = task.response as? HTTPURLResponse {
            if (300..<400).contains(response.statusCode) {
                continuation.resume(throwing: CarDownloadError.redirected)
            } else {
                continuation.resume(returning: CarDownloadResponse(status: response.statusCode, body: body))
            }
        } else {
            continuation.resume(throwing: HTTPFailure.invalidResponse)
        }
    }

    private func fail(_ error: Error) {
        lock.lock()
        if failure == nil {
            failure = error
        }
        body = []
        lock.unlock()
    }
}
