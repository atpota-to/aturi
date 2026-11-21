import Foundation
import Observation

/// The state behind `/tools/page`, port of `src/components/tools/PageChecker.tsx`.
///
/// One run fetches the page and reads it. When the page names the record it
/// is a view of, that record is then read from Slingshot, so the page can
/// show it beside the tags that point at it (the web links to the explorer
/// for it; the app does both).
@MainActor
@Observable
public final class PageCheckerModel {
    /// The address as typed, the web's `?url=`.
    public private(set) var raw = ""
    public private(set) var input: PageChecker.Input?
    public private(set) var report: ServiceStep<PageChecker.Report> = .pending
    /// The primary record, once asked: nil until then, `.failed` when
    /// Slingshot has no such record.
    public private(set) var primaryRecord: ServiceStep<FetchedRecord>?
    public private(set) var isRunning = false

    @ObservationIgnored private let client: PageCheckerClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(client: PageCheckerClient = PageCheckerClient()) {
        self.client = client
    }

    /// The web's three "Try" pages: one that declares its record, one with a
    /// card and no record, one with neither.
    public nonisolated static let examples = ["aturi.to/bsky.app", "atproto.com", "example.com"]

    @discardableResult
    public func run(_ raw: String) -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        self.raw = raw
        report = .pending
        primaryRecord = nil
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            input = nil
            isRunning = false
            return nil
        }
        let parsed = PageChecker.normalizeUrl(trimmed)
        input = parsed
        guard let url = parsed.url else {
            isRunning = false
            return nil
        }
        isRunning = true
        let client = client
        let started = Task { [weak self] in
            let read = await client.read(url)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.report = .done(read)
            self.isRunning = false
            guard let primary = read.reading?.primary else { return }
            self.primaryRecord = .pending
            let record = await client.record(primary)
            guard gen == self.generation, !Task.isCancelled else { return }
            if let record {
                self.primaryRecord = .done(record)
            } else {
                self.primaryRecord = .failed
            }
        }
        task = started
        return started
    }

    @discardableResult
    public func rerun() -> Task<Void, Never>? {
        run(raw)
    }

    /// The URL the page was asked at, once the input was one.
    public var url: String? {
        input?.url
    }

    public var checks: [ServiceCheck] {
        guard url != nil else { return [] }
        return PageChecker.buildChecks(report)
    }

    public var verdict: ServiceVerdict? {
        guard url != nil else { return nil }
        return PageChecker.verdict(report, checks: PageChecker.buildChecks(report))
    }

    public var reading: PageChecker.Reading? {
        report.value?.reading
    }

    public var linkCard: PageChecker.LinkCard? {
        guard let report = report.value, let reading = report.reading else { return nil }
        return PageChecker.linkCard(reading, pageUrl: report.url)
    }

    public var records: [PageChecker.DeclaredRecord] {
        reading.map(PageChecker.declaredRecords) ?? []
    }

    public var fields: [(label: String, value: String)] {
        reading.map(PageChecker.fields) ?? []
    }

    /// What the share button hands out: the page as normalized, as the web does.
    public var shareQuery: [String: String] {
        guard let url else { return [:] }
        return ["url": url]
    }
}
