import Foundation
import Observation

/// The state behind `/tools/feed`, port of `investigate` and the derived
/// values in `src/components/tools/FeedInspector.tsx`.
///
/// One run gathers the evidence for one feed, publishing as each part
/// arrives: the account's DID first, then the generator's side
/// (`FeedInspectorClient.probe`) and the AppView's (`appViewFeed`) side by
/// side, so a slow generator does not hold up what Bluesky says about it.
/// Once the skeleton is in, its posts are filled in from the AppView. A step
/// that could not be made is recorded as failed, not thrown.
@MainActor
@Observable
public final class FeedInspectorModel {
    /// The input as typed, the web's `?feed=`.
    public private(set) var raw = ""
    /// The skeleton page asked for, the web's `?cursor=`.
    public private(set) var cursor = ""
    public private(set) var input: FeedInspector.Input?
    public private(set) var evidence: FeedInspector.Evidence?
    /// The AppView's view of the generator, for the card.
    public private(set) var view: FeedGeneratorView?
    /// The skeleton's posts by URI. Nil until asked; empty when the AppView
    /// did not answer.
    public private(set) var posts: [String: BskyPost]?
    public private(set) var isRunning = false

    @ObservationIgnored private let client: FeedInspectorClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(client: FeedInspectorClient = FeedInspectorClient()) {
        self.client = client
    }

    // MARK: Running

    /// Inspect `raw` (a feed link or an at:// URI) from the skeleton page
    /// `cursor`. An input that is not a feed says why, without a run.
    @discardableResult
    public func run(_ raw: String, cursor: String = "") -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        self.raw = raw
        self.cursor = cursor
        view = nil
        posts = nil
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            input = nil
            evidence = nil
            isRunning = false
            return nil
        }
        let parsed = FeedInspector.parseInput(trimmed)
        input = parsed
        guard let target = parsed.target else {
            evidence = nil
            isRunning = false
            return nil
        }
        evidence = FeedInspector.Evidence(authority: target.authority, rkey: target.rkey)
        isRunning = true
        let started = Task { [weak self] in
            await self?.investigate(target, cursor: cursor, gen: gen)
        }
        task = started
        return started
    }

    /// "Check again": the same feed and page.
    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        run(raw, cursor: cursor)
    }

    /// The skeleton's next page, when the generator gave a cursor.
    @discardableResult
    public func nextPage() -> Task<Void, Never>? {
        guard let next = skeleton?.cursor else { return nil }
        return run(raw, cursor: next)
    }

    @discardableResult
    public func firstPage() -> Task<Void, Never>? {
        run(raw, cursor: "")
    }

    public func cancel() {
        task?.cancel()
        isRunning = false
    }

    private func isCurrent(_ gen: Int) -> Bool {
        gen == generation && !Task.isCancelled
    }

    private func investigate(_ target: FeedInspector.Target, cursor: String, gen: Int) async {
        let resolved = await client.resolveDid(target.authority)
        guard isCurrent(gen) else { return }
        guard let did = resolved else {
            evidence?.did = .failed
            isRunning = false
            return
        }
        evidence?.did = .done(did)
        let feed = FeedInspector.feedUri(did: did, rkey: target.rkey)

        async let generatorSide: Void = readGenerator(did: did, rkey: target.rkey, cursor: cursor, gen: gen)
        async let appViewSide: Void = readAppView(feed, gen: gen)
        await generatorSide
        await appViewSide
        if isCurrent(gen) {
            isRunning = false
        }
    }

    private func readGenerator(did: String, rkey: String, cursor: String, gen: Int) async {
        let probe = await client.probe(did: did, rkey: rkey, cursor: cursor.isEmpty ? nil : cursor)
        guard isCurrent(gen) else { return }
        evidence?.probe = .done(probe)

        let uris = (probe.skeleton?.items ?? []).map(\.post)
        guard !uris.isEmpty else { return }
        let hydrated = await client.posts(uris)
        guard isCurrent(gen) else { return }
        posts = hydrated ?? [:]
    }

    private func readAppView(_ feed: String, gen: Int) async {
        let answer = await client.appViewFeed(feed)
        guard isCurrent(gen) else { return }
        evidence?.appview = .done(answer.appview)
        view = answer.view
    }

    // MARK: What the page shows

    public var checks: [ServiceCheck] {
        evidence.map(FeedInspector.buildChecks) ?? []
    }

    public var verdict: ServiceVerdict? {
        guard let evidence else { return nil }
        return FeedInspector.verdict(evidence, checks: FeedInspector.buildChecks(evidence), name: name)
    }

    public var probe: FeedInspector.Probe? {
        evidence?.probe.value
    }

    /// The record's value, when it was found.
    public var record: JSONValue? {
        probe?.record.value
    }

    public var skeleton: FeedInspector.SkeletonProbe? {
        probe?.skeleton
    }

    /// The feed's name: the AppView's, the record's, or the address typed.
    public var name: String {
        if let displayName = view?.displayName { return displayName }
        if let displayName = Self.text(record?["displayName"]) { return displayName }
        if let target = input?.target { return "\(target.authority)/\(target.rkey)" }
        return "This feed"
    }

    public var did: String? {
        evidence?.did.value
    }

    /// The feed's at:// URI, once the account resolved.
    public var feedUri: String? {
        guard let did, let target = input?.target else { return nil }
        return FeedInspector.feedUri(did: did, rkey: target.rkey)
    }

    public var feedDescription: String? {
        view?.description ?? Self.text(record?["description"])
    }

    public var createdAt: String? {
        Self.text(record?["createdAt"])
    }

    public var acceptsInteractions: Bool? {
        record?["acceptsInteractions"]?.boolValue
    }

    /// The generator answered 200 with at least one post.
    public var hasSkeleton: Bool {
        guard let skeleton, skeleton.status == .answered, skeleton.httpStatus == 200 else { return false }
        return !(skeleton.items ?? []).isEmpty
    }

    public var needsViewer: Bool {
        FeedInspector.needsViewer(skeleton)
    }

    /// "25 posts, a later page".
    public var skeletonMeta: String {
        let count = skeleton?.items?.count ?? 0
        let later = cursor.isEmpty ? "" : ", a later page"
        return "\(count) \(count == 1 ? "post" : "posts")\(later)"
    }

    static func text(_ value: JSONValue?) -> String? {
        guard let text = value?.stringValue, !text.isEmpty else { return nil }
        return text
    }
}
