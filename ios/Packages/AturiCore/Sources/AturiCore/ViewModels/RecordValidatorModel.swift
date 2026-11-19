import Foundation
import Observation

// The record validator's screen state, port of the run in
// src/components/tools/RecordValidator.tsx: read the input, fetch the record
// when it was given by address, then check it against the schemas its
// authors published (`RecordValidator.check`). The checking is in
// Tools/RecordValidator.swift and the schema fetching in
// Tools/LexiconSchemaLookup.swift; this only sequences them.

@MainActor
@Observable
public final class RecordValidatorModel {
    /// What a finished run shows.
    public struct Outcome: Hashable, Sendable {
        public let record: JSONValue
        /// The address the record was read from, when it was fetched rather than pasted.
        public let uri: String?
        public let check: RecordValidator.Check

        public init(record: JSONValue, uri: String?, check: RecordValidator.Check) {
            self.record = record
            self.uri = uri
            self.check = check
        }
    }

    /// The input as last submitted, trimmed.
    public private(set) var submitted = ""
    /// How that input read. Nil before anything was submitted.
    public private(set) var input: RecordValidator.Input?
    public private(set) var state: Loadable<Outcome> = .idle

    @ObservationIgnored private let slingshot: SlingshotClient
    @ObservationIgnored private let lookup: LexiconSchemaLookup
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared, lookup: LexiconSchemaLookup = .shared) {
        slingshot = SlingshotClient(http: http)
        self.lookup = lookup
    }

    /// Why the input could not be read, when it could not.
    public var inputProblem: String? {
        input?.errorReason
    }

    public var isRunning: Bool {
        state.isLoading
    }

    /// The address kept in a shared link. An at:// URI is kept like every
    /// other tool's input; a pasted record is not: it can be long, and it is
    /// somebody's data.
    public var shareQuery: [String: String] {
        guard !submitted.isEmpty, !submitted.hasPrefix("{") else { return [:] }
        return ["uri": submitted]
    }

    /// Read `raw` and, when it names a record or is one, check it.
    @discardableResult
    public func submit(_ raw: String) -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        submitted = text
        let parsed = RecordValidator.parseInput(text)
        input = parsed

        switch parsed {
        case .error:
            state = .idle
            return nil
        case .json(let record, let nsid):
            state = .loading
            let lookup = lookup
            let next = Task {
                let check = await RecordValidator.check(record: record, nsid: nsid, lookup: lookup)
                self.finish(gen, .loaded(Outcome(record: record, uri: nil, check: check)))
            }
            task = next
            return next
        case .uri(let uri, _, let collection, let rkey):
            state = .loading
            let lookup = lookup
            let slingshot = slingshot
            let next = Task {
                guard let fetched = await slingshot.getRecordByUri(uri) else {
                    self.finish(gen, .failed("That record could not be read. It may have been deleted, or its repository may be unreachable."))
                    return
                }
                let check = await RecordValidator.check(record: fetched.value, nsid: collection, rkey: rkey, lookup: lookup)
                let address = fetched.uri.isEmpty ? uri : fetched.uri
                self.finish(gen, .loaded(Outcome(record: fetched.value, uri: address, check: check)))
            }
            task = next
            return next
        }
    }

    /// Run the last input again.
    @discardableResult
    public func retry() -> Task<Void, Never>? {
        guard !submitted.isEmpty else { return nil }
        return submit(submitted)
    }

    private func finish(_ gen: Int, _ next: Loadable<Outcome>) {
        guard gen == generation, !Task.isCancelled else { return }
        state = next
    }
}
