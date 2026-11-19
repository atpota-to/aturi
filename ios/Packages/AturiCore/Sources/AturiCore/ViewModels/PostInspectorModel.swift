import Foundation
import Observation

// The post inspector's screen state, port of `investigate` in
// src/components/tools/PostInspector.tsx: fetch the record, then everything
// that hangs off it, publishing as each part arrives. The record is the one
// thing the tool cannot do without, so a post that cannot be read is a
// failure of the run; the AppView's view and the two gate records are
// evidence, and a lookup of one that fails is recorded as such. What the
// evidence means is in Tools/PostInspector.swift.

@MainActor
@Observable
public final class PostInspectorModel {
    /// The input as last submitted.
    public private(set) var submitted = ""
    /// Why that input is not a post's address, when it is not.
    public private(set) var inputProblem: String?
    /// What has been fetched so far; nil until the record is in.
    public private(set) var evidence: PostInspector.Evidence?
    /// The AppView's full view of the post, for the author and the counts.
    public private(set) var post: BskyPost?
    /// Why the record could not be read.
    public private(set) var failure: String?
    public private(set) var isRunning = false

    @ObservationIgnored private let client: PostInspectorClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared) {
        client = PostInspectorClient(http: http)
    }

    public var text: String {
        evidence?.text ?? ""
    }

    public var readings: [PostInspector.FacetReading] {
        guard let evidence else { return [] }
        return PostInspector.readFacets(evidence.text, evidence.record["facets"])
    }

    public var findings: [PostInspector.Finding] {
        guard let evidence else { return [] }
        return PostInspector.buildFindings(evidence)
    }

    public var verdict: PostInspector.Verdict? {
        guard let evidence else { return nil }
        return PostInspector.verdict(PostInspector.buildFindings(evidence))
    }

    /// The query a shared link keeps: the input as typed, as the web keeps it.
    public var shareQuery: [String: String] {
        guard !submitted.isEmpty else { return [:] }
        return ["post": submitted]
    }

    /// Read `raw` as a post's address and inspect the post.
    @discardableResult
    public func inspect(_ raw: String) -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        submitted = text
        evidence = nil
        post = nil
        failure = nil
        switch PostInspector.parseInput(text) {
        case .problem(let reason):
            inputProblem = reason
            isRunning = false
            return nil
        case .post(let authority, let rkey):
            inputProblem = nil
            isRunning = true
            let next = Task { await self.investigate(authority: authority, rkey: rkey, gen) }
            task = next
            return next
        }
    }

    /// Inspect the last input again.
    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        guard !submitted.isEmpty else { return nil }
        return inspect(submitted)
    }

    private func current(_ gen: Int) -> Bool {
        gen == generation && !Task.isCancelled
    }

    private func investigate(authority: String, rkey: String, _ gen: Int) async {
        let fetched = await client.fetchRecord(authority: authority, rkey: rkey)
        guard current(gen) else { return }
        let record: FetchedRecord
        switch fetched {
        case .failure(let error):
            failure = error.text
            isRunning = false
            return
        case .success(let value):
            record = value
        }

        let body = record.value.objectValue ?? [:]
        evidence = PostInspector.Evidence(uri: record.uri, rkey: rkey, record: body)
        let uri = record.uri
        let threadgateUri = PostInspector.gateUri(
            PostInspector.threadRoot(uri: uri, record: body),
            collection: PostInspector.threadgateCollection
        )
        let postgateUri = PostInspector.gateUri(uri, collection: PostInspector.postgateCollection)

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadView(uri, gen) }
            group.addTask { await self.loadThreadgate(threadgateUri, gen) }
            group.addTask { await self.loadPostgate(postgateUri, gen) }
        }
        guard current(gen) else { return }
        isRunning = false
    }

    private func loadView(_ uri: String, _ gen: Int) async {
        let view = await client.fetchView(uri: uri)
        guard current(gen) else { return }
        post = view
        if let view {
            evidence?.view = .found(PostInspector.AppViewPost(json: view.raw))
        } else {
            evidence?.view = .missing
        }
    }

    private func loadThreadgate(_ uri: String?, _ gen: Int) async {
        let probe = await client.readGate(uri)
        guard current(gen) else { return }
        evidence?.threadgate = probe
    }

    private func loadPostgate(_ uri: String?, _ gen: Int) async {
        let probe = await client.readGate(uri)
        guard current(gen) else { return }
        evidence?.postgate = probe
    }
}
