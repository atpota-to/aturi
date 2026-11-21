import Foundation
import Observation

/// The state behind `/tools/oauth`, port of `src/components/tools/OAuthChecker.tsx`
/// and `OAuthCheckerScopes.tsx`.
///
/// Two views share the page, as on the web: checking a client (`?client_id=`)
/// and building or reading a scope string (`?view=scopes&scope=`). The
/// scope string is the scope view's only state, so a list built here can be
/// shared as it stands.
@MainActor
@Observable
public final class OAuthCheckerModel {
    public enum Mode: String, Hashable, Sendable, CaseIterable, Identifiable {
        case client
        case scopes

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .client: return "Check a client"
            case .scopes: return "Build scopes"
            }
        }
    }

    public var mode: Mode = .client
    /// The client_id as typed, the web's `?client_id=`.
    public private(set) var clientIdRaw = ""
    /// The scope string read, the web's `?scope=`.
    public private(set) var scope = ""
    public private(set) var input: OAuthChecker.ClientIdInput?
    /// The hosted document's read. Pending while it runs.
    public private(set) var probe: ServiceStep<OAuthChecker.ClientMetadataProbe> = .pending
    public private(set) var isRunning = false

    @ObservationIgnored private let client: OAuthCheckerClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(client: OAuthCheckerClient = OAuthCheckerClient()) {
        self.client = client
    }

    // MARK: Checking a client

    /// Check `raw`. A hosted client_id is fetched; the localhost form is read
    /// from the URL at once.
    @discardableResult
    public func check(_ raw: String) -> Task<Void, Never>? {
        task?.cancel()
        generation += 1
        let gen = generation
        clientIdRaw = raw
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            input = nil
            probe = .pending
            isRunning = false
            return nil
        }
        let parsed = OAuthChecker.parseClientId(raw)
        input = parsed
        probe = .pending
        guard parsed.kind == .hosted, let clientId = parsed.clientId else {
            isRunning = false
            return nil
        }
        isRunning = true
        let client = client
        let started = Task { [weak self] in
            let read = await client.fetch(clientId)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.probe = .done(read)
            self.isRunning = false
        }
        task = started
        return started
    }

    @discardableResult
    public func recheck() -> Task<Void, Never>? {
        check(clientIdRaw)
    }

    public var loopback: OAuthChecker.LoopbackClient? {
        guard input?.kind == .loopback, let clientId = input?.clientId else { return nil }
        return OAuthChecker.readLoopbackClient(clientId)
    }

    public var checks: [ServiceCheck] {
        guard let clientId = input?.clientId else { return [] }
        if let loopback { return loopback.checks }
        return OAuthChecker.buildClientChecks(probe, clientId: clientId)
    }

    public var verdict: ServiceVerdict? {
        guard let kind = input?.kind else { return nil }
        return OAuthChecker.clientVerdict(checks, kind: kind)
    }

    /// The document as fetched, or as a server derives it for the localhost form.
    public var document: JSONValue? {
        if let loopback { return loopback.document }
        guard let document = probe.value?.document, document.objectValue != nil else { return nil }
        return document
    }

    public var kindLabel: String? {
        OAuthChecker.clientKind(document)?.label
    }

    public var clientName: String? {
        document?["client_name"]?.stringValue
    }

    /// The document's scope string, for "Read its scopes".
    public var documentScope: String? {
        document?["scope"]?.stringValue
    }

    public var otherFields: [String] {
        loopback == nil ? (probe.value?.otherFields ?? []) : []
    }

    // MARK: Scopes

    /// Read a scope string, written back with single spaces as the web does
    /// when the form is submitted.
    public func setScope(_ value: String) {
        scope = OAuthCheckerScopes.normalized(value)
    }

    /// "Read its scopes": the scope view with the client's string.
    public func readScopes(_ value: String) {
        setScope(value)
        mode = .scopes
    }

    public func addScope(_ item: String) {
        scope = OAuthCheckerScopes.add(scope, item)
    }

    public func removeScope(at index: Int) {
        scope = OAuthCheckerScopes.remove(scope, at: index)
    }

    public var analysis: OAuthCheckerScopes.Analysis {
        OAuthCheckerScopes.analyze(scope)
    }

    public var scopeVerdict: ServiceVerdict? {
        OAuthCheckerScopes.verdict(analysis)
    }

    /// The string to copy, and the field to paste into a metadata document.
    public var normalizedScope: String {
        OAuthCheckerScopes.normalized(scope)
    }

    public var metadataField: String {
        "\"scope\": \(JSONValue.string(normalizedScope).compactString())"
    }

    // MARK: The address

    /// What the share button hands out, the web's `share` for this page.
    public var shareQuery: [String: String] {
        switch mode {
        case .scopes:
            return ["view": "scopes", "scope": scope]
        case .client:
            return ["client_id": clientIdRaw]
        }
    }

    /// Take the input a link handed the tool: `view`, `client_id`, `scope`.
    @discardableResult
    public func apply(query: [String: String]) -> Task<Void, Never>? {
        mode = query["view"] == "scopes" ? .scopes : .client
        if let scope = query["scope"] {
            setScope(scope)
        }
        if let raw = query["client_id"], !raw.isEmpty {
            return check(raw)
        }
        return nil
    }
}
