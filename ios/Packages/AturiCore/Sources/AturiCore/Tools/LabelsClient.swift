import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A failure the account checks report in their own words, the way the web
/// throws `new Error('...')` for a reader.
public struct AccountCheckError: Error, Hashable, Sendable {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    /// The words a check row or a tab prints for any failure.
    public static func describe(_ error: Error) -> String {
        if let error = error as? AccountCheckError { return error.message }
        if let error = error as? SubjectUnavailable { return error.message }
        return ExploreErrorText.describe(error)
    }
}

/// Raised when the AppView will not describe the subject at all: an account
/// it has no profile for, one that is suspended or deactivated, or a post
/// that is gone. `message` is the AppView's own wording.
public struct SubjectUnavailable: Error, Hashable, Sendable {
    public let message: String

    public init(message: String) {
        self.message = message
    }
}

/// The label checker's requests, port of `src/lib/tools/labelsClient.ts`,
/// with the two runs of `src/components/tools/checkRuns.ts` (the first
/// answer, and the scan of every labeler). What the answers mean is in
/// `Labels`.
///
/// Three services:
///
///   - `api.bsky.app` for the labels themselves, because it is the AppView
///     host that reads `atproto-accept-labelers` (`Labels` explains why the
///     cached public host cannot be used for this).
///   - The relay's collection directory, for the list of every account that
///     has published a labeler service record.
///   - The public AppView, for who a labeler is and what its values mean.
public struct LabelsClient: Sendable {
    /// Who or what was checked, as the AppView describes it.
    public struct SubjectView: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var displayName: String?
        public var avatar: String?
        /// A post's text, when the subject is a post.
        public var text: String?

        public init(did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil, text: String? = nil) {
            self.did = did
            self.handle = handle
            self.displayName = displayName
            self.avatar = avatar
            self.text = text
        }
    }

    public struct LabelAnswer: Hashable, Sendable {
        public var labels: [Labels.Label]
        public var view: SubjectView

        public init(labels: [Labels.Label], view: SubjectView) {
            self.labels = labels
            self.view = view
        }
    }

    /// Who a labeler is, and what its label values mean.
    public struct LabelerInfo: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var displayName: String?
        public var avatar: String?
        public var definitions: [Labels.LabelDefinition]

        public init(did: String, handle: String?, displayName: String?, avatar: String?, definitions: [Labels.LabelDefinition]) {
            self.did = did
            self.handle = handle
            self.displayName = displayName
            self.avatar = avatar
            self.definitions = definitions
        }
    }

    /// A labeler someone added by hand, and what became of it.
    public struct AddedLabeler: Hashable, Sendable {
        /// As typed: a handle or a DID.
        public var value: String
        /// Nil when the handle did not resolve.
        public var did: String?

        public init(value: String, did: String?) {
            self.value = value
            self.did = did
        }
    }

    /// The first answer: Bluesky's labeler, the subject's own labels, and
    /// any labelers added.
    public struct BaseResult: Hashable, Sendable {
        public var subject: Labels.LabelSubject
        public var view: SubjectView?
        /// The AppView's wording when it would not describe the subject at all.
        public var unavailable: String?
        public var labels: [Labels.Label]
        public var labelers: [String: LabelerInfo]
        public var added: [AddedLabeler]
        /// The labeler DIDs that were asked.
        public var asked: [String]

        public init(
            subject: Labels.LabelSubject,
            view: SubjectView?,
            unavailable: String?,
            labels: [Labels.Label],
            labelers: [String: LabelerInfo],
            added: [AddedLabeler],
            asked: [String]
        ) {
            self.subject = subject
            self.view = view
            self.unavailable = unavailable
            self.labels = labels
            self.labelers = labelers
            self.added = added
            self.asked = asked
        }
    }

    /// Where a scan of every labeler has got to.
    public struct ScanResult: Hashable, Sendable {
        public var progress: Labels.ScanProgress
        public var labels: [Labels.Label]
        public var labelers: [String: LabelerInfo]
        public var stopped: Bool
        public var running: Bool

        public init(progress: Labels.ScanProgress, labels: [Labels.Label], labelers: [String: LabelerInfo], stopped: Bool, running: Bool) {
            self.progress = progress
            self.labels = labels
            self.labelers = labelers
            self.stopped = stopped
            self.running = running
        }
    }

    /// The relay's page size for the collection directory; it serves up to this many at once.
    static let directoryPage = 1000
    /// A backstop on paging, far above the few hundred labelers that exist.
    static let directoryMaxPages = 20
    /// `getServices` takes its DIDs in the query string, so they go a few at a time.
    static let servicesPerRequest = 25

    private let http: HTTPClient
    private let resolver: IdentityResolver
    private let labelAppView: URL
    private let appView: URL
    private let relay: URL

    /// The shared HTTP client uses the shared resolver and its caches; any
    /// other gets its own, so a test never sees another test's cache.
    public init(
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        labelAppView: URL = Labels.labelAppView,
        appView: URL = Endpoints.appView,
        relay: URL = Endpoints.relay
    ) {
        self.http = http
        self.resolver = resolver ?? (http === HTTPClient.shared ? .shared : IdentityResolver(http: http))
        self.labelAppView = labelAppView
        self.appView = appView
        self.relay = relay
    }

    // MARK: - Requests

    /// A handle or DID as typed, resolved to a DID. Nil when it does not resolve.
    public func resolveActor(_ actor: String) async -> String? {
        if actor.hasPrefix("did:") {
            return isValidDid(actor) ? actor : nil
        }
        guard let did = await resolver.resolveHandle(actor), isValidDid(did) else { return nil }
        return did
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private func labelAppViewJSON(_ method: String, query: [(String, String)], labelers: [String]) async throws -> JSONValue {
        let url = makeURL(labelAppView, path: "/xrpc/\(method)", query: query)
        do {
            let (data, _) = try await http.get(url, headers: ["atproto-accept-labelers": Labels.labelersHeader(labelers)])
            return try JSONValue.parse(data)
        } catch let error as HTTPError {
            if error.status == 400 {
                let body = try? JSONValue.parse(Data(error.body.utf8))
                throw SubjectUnavailable(message: Self.nonEmpty(body?["message"]?.stringValue) ?? "The AppView has nothing for this.")
            }
            throw AccountCheckError("The AppView answered HTTP \(error.status)")
        }
    }

    static func subjectView(_ profile: JSONValue?, did: String, text: String?) -> SubjectView {
        let handle = nonEmpty(profile?["handle"]?.stringValue)
        let displayName = profile?["displayName"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return SubjectView(
            did: did,
            handle: handle == "handle.invalid" ? nil : handle,
            displayName: nonEmpty(displayName),
            avatar: profile?["avatar"]?.stringValue,
            text: text
        )
    }

    /// The subject's labels from one batch of labelers. One request does both
    /// jobs: the view that carries the labels also says who or what this is.
    public func fetchLabels(subject: Labels.LabelSubject, labelers: [String]) async throws -> LabelAnswer {
        switch subject {
        case .account(let did):
            let profile = try await labelAppViewJSON("app.bsky.actor.getProfile", query: [("actor", did)], labelers: labelers)
            return LabelAnswer(labels: Labels.readLabels(profile["labels"]), view: Self.subjectView(profile, did: did, text: nil))
        case .post(let did, let uri):
            let body = try await labelAppViewJSON("app.bsky.feed.getPosts", query: [("uris", uri)], labelers: labelers)
            guard let post = body["posts"]?[0], post.objectValue != nil else {
                throw SubjectUnavailable(message: "The AppView has no such post. It may have been deleted.")
            }
            let text = post["record"]?["text"]?.stringValue
            return LabelAnswer(labels: Labels.readLabels(post["labels"]), view: Self.subjectView(post["author"], did: did, text: text))
        }
    }

    /// Every account that has published a labeler service record, from the
    /// relay's collection directory. This is the network's list of labelers:
    /// the record is how one declares itself.
    public func listLabelerDids() async throws -> [String] {
        var dids: [String] = []
        var cursor: String? = nil
        for _ in 0..<Self.directoryMaxPages {
            var query: [(String, String)] = [("collection", Labels.labelerCollection), ("limit", String(Self.directoryPage))]
            if let cursor {
                query.append(("cursor", cursor))
            }
            let url = makeURL(relay, path: "/xrpc/com.atproto.sync.listReposByCollection", query: query)
            let body: JSONValue
            do {
                body = try await http.getJSONValue(from: url)
            } catch let error as HTTPError {
                throw AccountCheckError("The relay answered HTTP \(error.status)")
            }
            let repos = body["repos"]?.arrayValue ?? []
            for repo in repos {
                if let did = repo["did"]?.stringValue {
                    dids.append(did)
                }
            }
            guard let next = body["cursor"]?.stringValue, !next.isEmpty, !repos.isEmpty else { break }
            cursor = next
        }
        return dids
    }

    /// Service views for a set of DIDs. A DID with no view is absent from the
    /// map: either it is not a labeler, or the AppView has not indexed it. A
    /// request that fails leaves its DIDs out, as the web's
    /// `getLabelerServices` answers null.
    public func fetchLabelerInfo(_ dids: [String]) async -> [String: LabelerInfo] {
        var out: [String: LabelerInfo] = [:]
        var start = 0
        while start < dids.count {
            if Task.isCancelled { break }
            let end = min(start + Self.servicesPerRequest, dids.count)
            var query: [(String, String)] = dids[start..<end].map { ("dids", $0) }
            query.append(("detailed", "true"))
            start = end
            let url = makeURL(appView, path: "/xrpc/app.bsky.labeler.getServices", query: query)
            guard let body = try? await http.getJSONValue(from: url) else { continue }
            for view in body["views"]?.arrayValue ?? [] {
                guard let creator = view["creator"], let did = creator["did"]?.stringValue, !did.isEmpty else { continue }
                let handle = Self.nonEmpty(creator["handle"]?.stringValue)
                let displayName = creator["displayName"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
                out[did] = LabelerInfo(
                    did: did,
                    handle: handle == "handle.invalid" ? nil : handle,
                    displayName: Self.nonEmpty(displayName),
                    avatar: creator["avatar"]?.stringValue,
                    definitions: Labels.readDefinitions(view["policies"]?["labelValueDefinitions"])
                )
            }
        }
        return out
    }

    // MARK: - The two runs (checkRuns.ts)

    /// The first answer: Bluesky's moderation service, the subject's own
    /// labels (the view carries them), and any labelers added by hand. An
    /// AppView that will not describe the subject is an answer too
    /// (`unavailable`), which is how the account card learns that an account
    /// has no Bluesky profile.
    public func checkBase(target: Labels.LabelTarget, addedValues: [String] = []) async throws -> BaseResult {
        let client = self
        var did: String? = nil
        var added = addedValues.map { AddedLabeler(value: $0, did: nil) }
        await withTaskGroup(of: (Int, String?).self) { group in
            group.addTask {
                let resolved = await client.resolveActor(target.actor)
                return (-1, resolved)
            }
            for (index, value) in addedValues.enumerated() {
                group.addTask {
                    let resolved = await client.resolveActor(value)
                    return (index, resolved)
                }
            }
            while let pair = await group.next() {
                if pair.0 < 0 {
                    did = pair.1
                } else {
                    added[pair.0].did = pair.1
                }
            }
        }
        try Task.checkCancellation()
        guard let did else {
            throw AccountCheckError("\(target.actor) does not resolve to an account. Check the spelling, or use its DID.")
        }
        let subject = Labels.subjectFor(target, did: did)
        let asked = Labels.cleanLabelerDids([Labels.blueskyModerationDid] + added.compactMap { $0.did })

        var labels: [Labels.Label] = []
        var view: SubjectView? = nil
        var unavailable: String? = nil
        do {
            for batch in Labels.batchLabelers(asked) {
                let answer = try await fetchLabels(subject: subject, labelers: batch)
                labels = Labels.mergeLabels(labels, answer.labels)
                view = answer.view
            }
        } catch let error as SubjectUnavailable {
            unavailable = error.message
        }
        try Task.checkCancellation()

        // Everyone whose name will be shown: the labelers that were asked, and
        // whoever a label came from (a self-label comes from the subject,
        // which has no service view and is simply absent from the answer).
        let labelers = await fetchLabelerInfo(Labels.cleanLabelerDids(asked + labels.map { $0.src }))
        try Task.checkCancellation()
        return BaseResult(
            subject: subject,
            view: view,
            unavailable: unavailable,
            labels: labels,
            labelers: labelers,
            added: added,
            asked: asked
        )
    }

    /// One answer while a scan runs: a batch of labelers (nil labels when
    /// its request failed), or names for labelers that turned up.
    enum ScanStep: Sendable {
        case batch(count: Int, labels: [Labels.Label]?)
        case info([String: LabelerInfo])
    }

    private func askBatch(_ batch: [String], subject: Labels.LabelSubject) async -> ScanStep {
        do {
            let answer = try await fetchLabels(subject: subject, labelers: batch)
            return .batch(count: batch.count, labels: answer.labels)
        } catch {
            return .batch(count: batch.count, labels: nil)
        }
    }

    /// The scan's requests: `Labels.scanConcurrency` batches in flight, the
    /// next one starting as each answers, and a lookup for any labeler that
    /// turns up with a label and has no name yet, so it is named as soon as
    /// it appears rather than left a bare DID until the scan ends. Every
    /// answer goes to `continuation`, which is finished when all are in.
    private func askBatches(
        _ batches: [[String]],
        subject: Labels.LabelSubject,
        named: Set<String>,
        into continuation: AsyncStream<ScanStep>.Continuation
    ) async {
        let client = self
        var requested = named
        await withTaskGroup(of: ScanStep.self) { group in
            var next = 0
            while next < min(Labels.scanConcurrency, batches.count) {
                let batch = batches[next]
                next += 1
                group.addTask { await client.askBatch(batch, subject: subject) }
            }
            while let step = await group.next() {
                continuation.yield(step)
                guard case .batch(_, let found) = step else { continue }
                if let found {
                    let fresh = Labels.cleanLabelerDids(found.map { $0.src }).filter { !requested.contains($0) }
                    if !fresh.isEmpty {
                        requested.formUnion(fresh)
                        group.addTask {
                            let info = await client.fetchLabelerInfo(fresh)
                            return .info(info)
                        }
                    }
                }
                if next < batches.count, !Task.isCancelled {
                    let batch = batches[next]
                    next += 1
                    group.addTask { await client.askBatch(batch, subject: subject) }
                }
            }
        }
        continuation.finish()
    }

    /// Ask every labeler on the network, a batch per request and a few
    /// requests at a time, publishing as the answers arrive.
    ///
    /// `control.stop()` ends it early and keeps what was found (`stopped`).
    /// It is separate from cancelling the task this runs in, which throws
    /// the result away, as the web keeps its stop switch apart from the
    /// run's own abort signal.
    ///
    /// Runs on the main actor so `publish` can hand each snapshot straight
    /// to a view model; the requests themselves run off it.
    @MainActor
    public func scanEveryLabeler(
        base: BaseResult,
        control: LabelScanControl,
        publish: (ScanResult) -> Void
    ) async throws -> ScanResult {
        let directory = try await listLabelerDids()
        try Task.checkCancellation()
        let batches = Labels.batchLabelers(base.asked + directory)
        var progress = Labels.ScanProgress(total: batches.reduce(0) { $0 + $1.count })
        var labels: [Labels.Label] = []
        var labelers: [String: LabelerInfo] = [:]
        func snapshot(running: Bool) -> ScanResult {
            ScanResult(progress: progress, labels: labels, labelers: labelers, stopped: control.isStopped, running: running)
        }
        publish(snapshot(running: true))

        let (stream, continuation) = AsyncStream.makeStream(of: ScanStep.self)
        let client = self
        let subject = base.subject
        let named = Set(base.labelers.keys)
        let producer = Task.detached {
            await client.askBatches(batches, subject: subject, named: named, into: continuation)
        }
        continuation.onTermination = { _ in producer.cancel() }
        control.attach(producer)

        for await step in stream {
            switch step {
            case .batch(let count, let found):
                // Batches cut off by Stop are neither counted nor failed.
                if control.isStopped { continue }
                if let found {
                    labels = Labels.mergeLabels(labels, found)
                    progress.checked += count
                } else {
                    progress.failed += count
                }
            case .info(let info):
                for (did, value) in info {
                    labelers[did] = value
                }
            }
            publish(snapshot(running: true))
        }
        producer.cancel()
        try Task.checkCancellation()

        // Stop also cuts off the lookups in flight, which the web lets
        // finish; name whoever was left without one.
        if control.isStopped {
            let unnamed = Labels.cleanLabelerDids(labels.map { $0.src })
                .filter { labelers[$0] == nil && base.labelers[$0] == nil && $0 != base.subject.did }
            if !unnamed.isEmpty {
                let late = await fetchLabelerInfo(unnamed)
                for (did, value) in late {
                    labelers[did] = value
                }
            }
        }
        return snapshot(running: false)
    }
}

/// The stop switch of a label scan in flight. A scan is shared, so whoever
/// presses Stop stops it for everyone watching.
@MainActor
public final class LabelScanControl {
    public private(set) var isStopped = false
    private var producer: Task<Void, Never>?

    public init() {}

    func attach(_ task: Task<Void, Never>) {
        producer = task
        if isStopped {
            task.cancel()
        }
    }

    public func stop() {
        isStopped = true
        producer?.cancel()
    }
}
