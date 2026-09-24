import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Port of the three identity surfaces of the repo screen:
// src/components/explore/tabs/IdentityTab.tsx (the PLC document, in
// sections), tabs/AuditTab.tsx (the PLC operation log, newest first, each
// entry with the human-readable diff against the operation before it) and
// RepoStatusNotice.tsx (the banner for a repo whose host refuses reads,
// with the three facts it fills in behind itself: what the host said,
// whether the handle still points here, and the last rev a relay saw).
//
// All three take the resolved `IdentityBundle`; the model never resolves
// the identifier itself. The document and the log only exist for did:plc
// identities, so for any other method they stay `.idle` and the screen
// prints the placeholder copy below.

/// The prose for one hosting status. Port of `STATUS_COPY`.
public struct RepoStatusCopy: Hashable, Sendable {
    public let headline: String
    public let detail: String

    public init(headline: String, detail: String) {
        self.headline = headline
        self.detail = detail
    }
}

/// Whether the handle a DID document claims still resolves to that DID:
/// the web's `true` / `false` / `null` (could not be checked).
public enum RepoHandleVerification: Hashable, Sendable {
    case verified
    case mismatch
    case unverified
}

/// One audit-log row as `AuditEntryRow` renders it.
public struct PlcAuditEntryView: Hashable, Sendable, Identifiable {
    /// The entry's CID, or `createdAt-index` for a legacy entry without one.
    public let id: String
    public let entry: PlcAuditEntry
    /// `op.type || (op.prev === null ? 'create' : 'update')`.
    public let type: String
    /// `diffOps(prev, op)`: what this operation changed.
    public let changes: [String]
    /// The raw operation, pretty printed for the disclosure.
    public let rawJSON: String

    public init(id: String, entry: PlcAuditEntry, type: String, changes: [String], rawJSON: String) {
        self.id = id
        self.entry = entry
        self.type = type
        self.changes = changes
        self.rawJSON = rawJSON
    }

    public var createdAt: String { entry.createdAt }
    public var timestamp: Date? { entry.createdDate }
    public var isNullified: Bool { entry.nullified ?? false }
}

@MainActor
@Observable
public final class IdentityModel {
    /// `STATUS_COPY`: the prose per hosting status. The status string comes
    /// from the account's own PDS and is rendered verbatim alongside it;
    /// the prose only explains what the state means for reading the repo.
    /// Deliberately says nothing about why: the protocol carries no reason.
    public nonisolated static let statusCopy: [String: RepoStatusCopy] = [
        "takendown": RepoStatusCopy(
            headline: "This repo has been taken down.",
            detail: "Its host refuses every record read. A takedown is the host\u{2019}s own action and carries no public reason with it."
        ),
        "suspended": RepoStatusCopy(
            headline: "This repo is suspended.",
            detail: "Its host refuses every record read. The status is all the PDS reports \u{2014} there is no duration or reason attached to it."
        ),
        "deactivated": RepoStatusCopy(
            headline: "This account is deactivated.",
            detail: "Deactivation is usually the account holder\u{2019}s own switch: it is how you step away from a host, and how a repo looks part-way through migrating between two. Records return if it is reactivated."
        ),
        "deleted": RepoStatusCopy(
            headline: "This repo has been deleted.",
            detail: "Its host reports the repo gone, so there are no records left to read from it."
        ),
    ]

    /// The banner's second paragraph: a dead repo is not a dead identity.
    public nonisolated static let identityUntouchedNote = "Its identity is untouched. The DID document, the PLC audit log and every record elsewhere in the Atmosphere that points at this DID live outside the PDS, so the ID, LOG and BACKLINKS tabs below all still work."
    /// AuditTab's placeholder for a non-PLC DID.
    public nonisolated static let auditNotPlcMessage = "Audit log only available for did:plc: DIDs."
    public nonisolated static let noOperationsMessage = "No PLC operations recorded."
    /// IdentityTab's placeholder for a non-PLC DID.
    public nonisolated static func identityNotPlcMessage(for did: String) -> String {
        "\(did) isn\u{2019}t a did:plc:. PLC directory data isn\u{2019}t available for this method."
    }

    public let identity: IdentityBundle

    /// The PLC document behind the identity tab. `idle` for a non-PLC DID.
    public private(set) var document: Loadable<PlcDocument> = .idle
    /// The PLC operation log, oldest first as the directory serves it;
    /// `auditEntries` is the newest-first view. `idle` for a non-PLC DID.
    public private(set) var auditLog: Loadable<[PlcAuditEntry]> = .idle
    /// The newest rev a relay holds for an inactive repo: `loaded(nil)` once
    /// the relay answered without one. `idle` unless the repo is inactive.
    public private(set) var relayRev: Loadable<String?> = .idle
    /// Whether the claimed handle still resolves to this DID. `idle` unless
    /// the repo is inactive and the document claims a handle.
    public private(set) var handleVerification: Loadable<RepoHandleVerification> = .idle

    @ObservationIgnored private let plc: PLCClient
    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    /// - Parameters:
    ///   - identity: the resolved account, with `repoStatus` set when its
    ///     PDS reported the repo inactive.
    ///   - http: the transport; the shared client uses the shared PLC
    ///     client and resolver (and their caches), any other gets its own.
    ///   - plc / resolver: explicit clients, overriding the rule above.
    ///   - now: the clock behind the relative "last rev" note.
    public init(
        identity: IdentityBundle,
        http: HTTPClient = .shared,
        plc: PLCClient? = nil,
        resolver: IdentityResolver? = nil,
        now: @escaping () -> Date = { Date() }
    ) {
        self.identity = identity
        let isShared = http === HTTPClient.shared
        self.plc = plc ?? (isShared ? PLCClient.shared : PLCClient(http: http))
        self.resolver = resolver ?? (isShared ? IdentityResolver.shared : IdentityResolver(http: http))
        self.now = now
    }

    // MARK: Identity

    public var did: String { identity.did }

    /// `did.startsWith('did:plc:')`: the directory only knows these.
    public var isPlc: Bool {
        did.hasPrefix("did:plc:")
    }

    public var repoStatus: InactiveRepo? { identity.repoStatus }

    // MARK: Loading

    /// Fetch the document and the log (PLC only) and the status facts
    /// (inactive repos only), cancelling whatever was in flight.
    public func load() {
        loadTask?.cancel()
        if isPlc {
            document = .loading
            auditLog = .loading
        } else {
            document = .idle
            auditLog = .idle
        }
        if hasStatusNotice {
            relayRev = .loading
            // A document without an at:// entry has nothing to verify; the
            // note says so without a lookup.
            handleVerification = claimedHandle == nil ? .loaded(.unverified) : .loading
        } else {
            relayRev = .idle
            handleVerification = .idle
        }
        loadTask = Task { [weak self] in
            await self?.perform()
        }
    }

    public func reload() {
        load()
    }

    /// `load` and wait for every lookup to settle.
    public func loadAndWait() async {
        load()
        await loadTask?.value
    }

    public func awaitLoad() async {
        await loadTask?.value
    }

    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
    }

    private func perform() async {
        let isPlc = self.isPlc
        let hasStatusNotice = self.hasStatusNotice
        let handle = claimedHandle
        await withTaskGroup(of: Void.self) { group in
            if isPlc {
                group.addTask { [weak self] in await self?.loadDocument() }
                group.addTask { [weak self] in await self?.loadAuditLog() }
            }
            if hasStatusNotice {
                group.addTask { [weak self] in await self?.loadRelayRev() }
                if let handle {
                    group.addTask { [weak self] in await self?.verifyHandle(handle) }
                }
            }
        }
    }

    private func loadDocument() async {
        do {
            let doc = try await plc.document(did: did)
            guard !Task.isCancelled else { return }
            document = .loaded(doc)
        } catch {
            guard !Task.isCancelled else { return }
            document = .failed(IdentityModel.describeFailure(error))
        }
    }

    private func loadAuditLog() async {
        do {
            let log = try await plc.auditLog(did: did)
            guard !Task.isCancelled else { return }
            auditLog = .loaded(log)
        } catch {
            guard !Task.isCancelled else { return }
            auditLog = .failed(IdentityModel.describeFailure(error))
        }
    }

    private func loadRelayRev() async {
        let rev = await resolver.inactiveRepoRev(did)
        guard !Task.isCancelled else { return }
        relayRev = .loaded(rev)
    }

    /// A takedown is a hosting state: it leaves DNS, the DID document and
    /// the PLC directory alone, so a handle often keeps resolving long after
    /// the repo stops answering. It can also have been picked up by somebody
    /// else, which is the case actually worth flagging.
    private func verifyHandle(_ handle: String) async {
        let resolved = await resolver.resolveHandle(handle)
        guard !Task.isCancelled else { return }
        if let resolved {
            handleVerification = .loaded(resolved == did ? .verified : .mismatch)
        } else {
            handleVerification = .loaded(.unverified)
        }
    }

    // MARK: Identity tab

    public var alsoKnownAs: [String] {
        document.value?.alsoKnownAs ?? []
    }

    public var services: [DIDDocument.Service] {
        document.value?.service ?? []
    }

    public var verificationMethods: [DIDDocument.VerificationMethod] {
        document.value?.verificationMethod ?? []
    }

    /// `JSON.stringify(doc, null, 2)` for the "Raw DID document" disclosure.
    public var rawDocumentJSON: String? {
        document.value.flatMap(IdentityModel.prettyJSON)
    }

    // MARK: Audit tab

    /// The log newest first, each entry diffed against the operation
    /// chronologically before it.
    public var auditEntries: [PlcAuditEntryView] {
        guard let log = auditLog.value else { return [] }
        var out: [PlcAuditEntryView] = []
        out.reserveCapacity(log.count)
        for index in log.indices.reversed() {
            let entry = log[index]
            let previous = index > 0 ? log[index - 1] : nil
            let operation = entry.operation
            // The web reads `op.prev === null` as a create. A JSON null and
            // an absent `prev` both decode to nil here, so a legacy entry
            // with no `type` and no `prev` at all reads as a create rather
            // than the web's update; every operation the directory has
            // served since launch carries a `type`, so the fallback is
            // academic.
            let type = operation.type.flatMap { $0.isEmpty ? nil : $0 }
                ?? (operation.prev == nil ? "create" : "update")
            let position = log.count - 1 - index
            let id = entry.cid.flatMap { $0.isEmpty ? nil : $0 } ?? "\(entry.createdAt)-\(position)"
            out.append(PlcAuditEntryView(
                id: id,
                entry: entry,
                type: type,
                changes: PLCClient.diffOps(prev: previous?.operation, next: operation),
                rawJSON: IdentityModel.prettyJSON(entry) ?? ""
            ))
        }
        return out
    }

    /// Loaded and empty: "No PLC operations recorded."
    public var hasNoOperations: Bool {
        auditLog.value?.isEmpty ?? false
    }

    // MARK: Repo status notice

    /// The banner renders only for a repo whose host reported it inactive.
    public var hasStatusNotice: Bool {
        repoStatus != nil
    }

    /// `repo.status || 'inactive'`: the status fact's value.
    public var statusLabel: String {
        repoStatus?.status.flatMap { $0.isEmpty ? nil : $0 } ?? "inactive"
    }

    /// The headline and detail for the status, with the generic fallback
    /// for a state the table does not name. Nil when there is no notice.
    public var statusNoticeCopy: RepoStatusCopy? {
        guard hasStatusNotice else { return nil }
        let status = statusLabel
        return IdentityModel.statusCopy[status] ?? RepoStatusCopy(
            headline: "This repo is marked \(status).",
            detail: "Its host refuses record reads while the repo is in this state."
        )
    }

    /// The banner's `aria-label`.
    public var statusAccessibilityLabel: String {
        "Repo status: \(statusLabel)"
    }

    /// Bare hostname of the PDS that answered, so the status has an author.
    public var pdsHostname: String {
        URL(string: identity.pds)?.host ?? identity.pds
    }

    /// The handle the document claims, nil when it names none.
    private var claimedHandle: String? {
        identity.handle.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The handle fact's value: "@handle" or a dash.
    public var handleValue: String {
        claimedHandle.map { "@" + $0 } ?? "\u{2014}"
    }

    /// The handle fact's note, one of the five the web prints.
    public var handleNote: String {
        guard claimedHandle != nil else { return "no at:// entry in the DID document" }
        switch handleVerification {
        case .idle, .loading:
            return "checking\u{2026}"
        case .loaded(.verified):
            return "still resolves to this DID"
        case .loaded(.mismatch):
            return "now resolves to a different DID"
        case .loaded(.unverified), .failed:
            return "claimed in the DID document, could not be verified"
        }
    }

    /// The relay's newest rev, nil while loading and when it had none.
    public var revValue: String? {
        relayRev.value.flatMap { $0 }
    }

    /// The rev decoded as a TID, nil when it is not one.
    public var revDate: Date? {
        revValue.flatMap(TID.date(from:))
    }

    /// The last-rev fact's note. Hedged on purpose: this is the newest rev a
    /// relay holds for the repo, which reads as the account's last write,
    /// but nothing here confirms that a relay leaves it alone when an
    /// account event arrives. Calling it "last active" would claim more
    /// than was checked.
    public var revNote: String {
        switch relayRev {
        case .idle, .loading:
            return "checking\u{2026}"
        case .loaded, .failed:
            if let revDate {
                return "last rev seen by the relay \u{00B7} \(TID.formatRelative(revDate, now: now()))"
            }
            return "no rev available"
        }
    }

    /// The exact timestamp behind the relative note, for a hover or a
    /// VoiceOver hint.
    public var revTitle: String? {
        revDate.map(Formatting.isoTimestamp)
    }

    // MARK: Helpers

    /// The message the web's PLC `fetchJson` threw: status, status text and
    /// the first 200 characters of the body.
    private nonisolated static func describeFailure(_ error: Error) -> String {
        if let http = error as? HTTPError {
            let statusText = HTTPURLResponse.localizedString(forStatusCode: http.status)
            return "HTTP \(http.status) \(statusText) :: \(http.body.prefix(200))"
        }
        if let plc = error as? PLCClientError {
            switch plc {
            case .missingDid: return "missing did"
            }
        }
        return error.localizedDescription
    }

    /// `JSON.stringify(value, null, 2)` through the value's Codable form.
    private nonisolated static func prettyJSON<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value), let json = try? JSONValue.parse(data) else {
            return nil
        }
        return json.prettyPrinted()
    }
}
