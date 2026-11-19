import Foundation

// Port of src/lib/streamMonitor.ts, the model behind the stream monitor
// (/tools/stream): what kinds of event it shows, how a raw Jetstream or PLC
// message becomes a row, how typed filters are read, and how a view
// round-trips through the query string so a filtered stream can be
// bookmarked or shared. The sockets are in StreamMonitorFeeds.swift and the
// screen's state in ViewModels/StreamMonitorModel.swift; nothing here does IO.

/// Where an event came from.
public enum StreamSource: String, CaseIterable, Hashable, Sendable {
    case jetstream
    case plc

    /// The source's name, for status lines and the event-type groups.
    public var label: String {
        switch self {
        case .jetstream: return "Jetstream"
        case .plc: return "PLC directory"
        }
    }

    public var shortLabel: String {
        switch self {
        case .jetstream: return "Jetstream"
        case .plc: return "PLC"
        }
    }
}

/// `SourceChoice`: one source, or both.
public enum StreamSourceChoice: String, CaseIterable, Hashable, Sendable {
    case both
    case jetstream
    case plc

    public var label: String {
        switch self {
        case .both: return "Both"
        case .jetstream: return "Jetstream"
        case .plc: return "PLC"
        }
    }

    /// `sourceShown`.
    public func shows(_ source: StreamSource) -> Bool {
        switch self {
        case .both: return true
        case .jetstream: return source == .jetstream
        case .plc: return source == .plc
        }
    }
}

/// The eight event types, with the web's spellings as raw values (they are
/// what `?type=` carries).
public enum StreamKind: String, CaseIterable, Hashable, Sendable {
    case create
    case update
    case delete
    case identity
    case account
    case plcNew = "plc-new"
    case plcUpdate = "plc-update"
    case plcTombstone = "plc-tombstone"

    public var source: StreamSource {
        switch self {
        case .create, .update, .delete, .identity, .account: return .jetstream
        case .plcNew, .plcUpdate, .plcTombstone: return .plc
        }
    }

    public var meta: StreamKindMeta {
        StreamMonitor.kinds.first { $0.id == self }!
    }
}

/// `KindMeta`.
public struct StreamKindMeta: Hashable, Sendable, Identifiable {
    public let id: StreamKind
    public let source: StreamSource
    /// Filter chip label.
    public let label: String
    /// Row badge: short, and unique across both sources.
    public let badge: String
    public let hint: String
}

/// One listed event (`StreamItem`).
public struct StreamItem: Hashable, Sendable, Identifiable {
    /// Monotonic per screen; the list's identity.
    public let id: Int
    public let source: StreamSource
    public let kind: StreamKind
    public let did: String
    /// Event time: Jetstream's `time_us`, or the PLC entry's `createdAt`.
    public let time: Date
    /// Where to look at it in the explorer (`/explore/…`).
    public let href: String
    /// Commits: the collection and record key, and a line of what was written.
    public var collection: String?
    public var rkey: String?
    public var preview: String?
    /// The handle the event itself names: an identity event's, or a PLC claim.
    public var handle: String?
    /// PLC operations: the PDS host the DID points at.
    public var pds: String?
    /// Account events.
    public var active: Bool?
    public var status: String?
    /// The message as received, for text matching.
    public let raw: String
    /// The message as JSON, for the event's JSON view.
    public let data: JSONValue
    /// A commit's record and its CID, when it carried one.
    public var record: JSONValue?
    public var cid: String?
    /// The PLC entry, for the open row's list of changes.
    public var plcEntry: PlcStreamEntry?

    public init(
        id: Int,
        source: StreamSource,
        kind: StreamKind,
        did: String,
        time: Date,
        href: String,
        raw: String,
        data: JSONValue
    ) {
        self.id = id
        self.source = source
        self.kind = kind
        self.did = did
        self.time = time
        self.href = href
        self.raw = raw
        self.data = data
    }

    /// The parts the filters look at.
    public var probe: StreamProbe {
        StreamProbe(source: source, kind: kind, did: did, collection: collection, raw: raw)
    }

    /// `at://did/collection/rkey`, for a commit.
    public var atUri: String? {
        guard let collection, let rkey else { return nil }
        return "at://\(did)/\(collection)/\(rkey)"
    }

    /// PLC rows name the handle themselves, and so do identity events that
    /// carry one; looking those accounts up again would only repeat it
    /// (`resolvable` in StreamMonitor.tsx).
    public var isResolvable: Bool {
        source == .jetstream && !(kind == .identity && handle != nil)
    }
}

// MARK: - Jetstream and PLC messages

/// One Jetstream message, narrowed to the three event shapes Jetstream
/// documents (`asJetstreamEvent`). The record itself is not decoded here:
/// an unfiltered stream runs at thousands of events a second and most are
/// counted, not listed, so the row builder reads it from `raw` when a row
/// is kept.
public struct StreamJetstreamEvent: Hashable, Sendable {
    public enum Body: Hashable, Sendable {
        case commit(operation: JetstreamOperation, collection: String, rkey: String)
        /// `handle` is present when the identity event carried one; one
        /// without it means "resolve this DID again".
        case identity(handle: String?)
        case account(active: Bool, status: String?)
    }

    public let did: String
    /// Microseconds since the epoch.
    public let timeUs: Int
    public let body: Body
    /// The message text as received.
    public let raw: String

    public init(did: String, timeUs: Int, body: Body, raw: String) {
        self.did = did
        self.timeUs = timeUs
        self.body = body
        self.raw = raw
    }

    /// The event type: the commit's operation, or identity or account.
    public var kind: StreamKind {
        switch body {
        case .commit(let operation, _, _):
            switch operation {
            case .create: return .create
            case .update: return .update
            case .delete: return .delete
            }
        case .identity: return .identity
        case .account: return .account
        }
    }

    public var collection: String? {
        if case .commit(_, let collection, _) = body { return collection }
        return nil
    }

    public var probe: StreamProbe {
        StreamProbe(source: .jetstream, kind: kind, did: did, collection: collection, raw: raw)
    }
}

/// A PLC operation as the export carries it (`PlcStreamOperation`).
/// `plc_operation` and `plc_tombstone` use the modern fields; DIDs created
/// before those existed have a legacy `create` genesis with `handle`,
/// `service`, `signingKey` and `recoveryKey`. Every field is read leniently.
public struct PlcStreamOperation: Hashable, Sendable {
    public var type: String?
    public var prev: String?
    public var alsoKnownAs: [String]?
    /// Service id (`atproto_pds`) to its endpoint.
    public var serviceEndpoints: [String: String]?
    public var rotationKeys: [String]?
    public var verificationMethods: [String: String]?
    public var handle: String?
    public var service: String?
    public var signingKey: String?
    public var recoveryKey: String?

    public init(
        type: String? = nil,
        prev: String? = nil,
        alsoKnownAs: [String]? = nil,
        serviceEndpoints: [String: String]? = nil,
        rotationKeys: [String]? = nil,
        verificationMethods: [String: String]? = nil,
        handle: String? = nil,
        service: String? = nil,
        signingKey: String? = nil,
        recoveryKey: String? = nil
    ) {
        self.type = type
        self.prev = prev
        self.alsoKnownAs = alsoKnownAs
        self.serviceEndpoints = serviceEndpoints
        self.rotationKeys = rotationKeys
        self.verificationMethods = verificationMethods
        self.handle = handle
        self.service = service
        self.signingKey = signingKey
        self.recoveryKey = recoveryKey
    }

    public init(json: JSONValue) {
        type = json["type"]?.stringValue
        prev = json["prev"]?.stringValue
        alsoKnownAs = json["alsoKnownAs"]?.arrayValue?.compactMap(\.stringValue)
        if let services = json["services"]?.objectValue {
            var endpoints: [String: String] = [:]
            for (id, entry) in services {
                if let endpoint = entry["endpoint"]?.stringValue { endpoints[id] = endpoint }
            }
            serviceEndpoints = endpoints
        }
        rotationKeys = json["rotationKeys"]?.arrayValue?.compactMap(\.stringValue)
        if let methods = json["verificationMethods"]?.objectValue {
            var keys: [String: String] = [:]
            for (id, value) in methods {
                if let key = value.stringValue { keys[id] = key }
            }
            verificationMethods = keys
        }
        handle = json["handle"]?.stringValue
        service = json["service"]?.stringValue
        signingKey = json["signingKey"]?.stringValue
        recoveryKey = json["recoveryKey"]?.stringValue
    }
}

/// One sequenced operation from `wss://plc.directory/export/stream`
/// (`PlcStreamEntry`): the shape `/export` returns, with a `seq`.
public struct PlcStreamEntry: Hashable, Sendable {
    public let seq: Int
    public let did: String
    public let operation: PlcStreamOperation
    public let cid: String
    public let createdAt: String
    public let nullified: Bool
    /// The message text as received.
    public let raw: String
    /// The message as JSON.
    public let data: JSONValue

    public init(seq: Int, did: String, operation: PlcStreamOperation, cid: String, createdAt: String, nullified: Bool = false, raw: String, data: JSONValue) {
        self.seq = seq
        self.did = did
        self.operation = operation
        self.cid = cid
        self.createdAt = createdAt
        self.nullified = nullified
        self.raw = raw
        self.data = data
    }

    public var probe: StreamProbe {
        StreamProbe(source: .plc, kind: StreamMonitor.plcKind(operation), did: did, collection: nil, raw: raw)
    }
}

/// One entry of a DID's audit log, read with the legacy fields kept, so a
/// change from a legacy genesis names what it changed.
public struct PlcStreamAuditEntry: Hashable, Sendable {
    public let did: String
    public let operation: PlcStreamOperation
    public let cid: String?
    public let nullified: Bool
    public let createdAt: String

    public init(did: String, operation: PlcStreamOperation, cid: String?, nullified: Bool = false, createdAt: String = "") {
        self.did = did
        self.operation = operation
        self.cid = cid
        self.nullified = nullified
        self.createdAt = createdAt
    }

    public init(json: JSONValue) {
        did = json["did"]?.stringValue ?? ""
        operation = PlcStreamOperation(json: json["operation"] ?? .object([:]))
        cid = json["cid"]?.stringValue
        nullified = json["nullified"]?.boolValue ?? false
        createdAt = json["createdAt"]?.stringValue ?? ""
    }
}

/// `PlcChange`: one field a PLC operation changed.
public struct StreamPlcChange: Hashable, Sendable, Identifiable {
    public enum Field: String, Hashable, Sendable {
        case handle = "Handle"
        case pds = "PDS"
        case signingKey = "Signing key"
        case rotationKeys = "Rotation keys"
    }

    public var id: String { field.rawValue }
    public let field: Field
    public let from: String?
    public let to: String?

    public init(field: Field, from: String?, to: String?) {
        self.field = field
        self.from = from
        self.to = to
    }

    public var label: String { field.rawValue }
}

/// `AccountToken`.
public enum StreamAccountToken: Hashable, Sendable {
    case did(String)
    case handle(String)

    /// The value the filter keeps: the DID, or the lowercased handle.
    public var value: String {
        switch self {
        case .did(let did): return did
        case .handle(let handle): return handle
        }
    }
}

/// `StreamProbe`: the parts of an event the filters look at, before a row
/// is built.
public struct StreamProbe: Hashable, Sendable {
    public let source: StreamSource
    public let kind: StreamKind
    public let did: String
    public let collection: String?
    public let raw: String

    public init(source: StreamSource, kind: StreamKind, did: String, collection: String? = nil, raw: String) {
        self.source = source
        self.kind = kind
        self.did = did
        self.collection = collection
        self.raw = raw
    }
}

/// `CompiledFilter`.
public struct StreamCompiledFilter: Hashable, Sendable {
    public let source: StreamSourceChoice
    public let kinds: Set<StreamKind>
    /// nil: no account filter. Empty: accounts asked for, none resolved yet.
    public let dids: Set<String>?
    public let collections: [String]
    /// Lowercased.
    public let needle: String
}

/// `MonitorView`: what the monitor shows, as the link keeps it.
public struct StreamMonitorFilters: Hashable, Sendable {
    public var source: StreamSourceChoice
    public var kinds: [StreamKind]
    /// As typed, handles included; resolved to DIDs by the model.
    public var accounts: [String]
    public var collections: [String]
    public var text: String

    public init(
        source: StreamSourceChoice = .both,
        kinds: [StreamKind] = StreamMonitor.allKinds,
        accounts: [String] = [],
        collections: [String] = [],
        text: String = ""
    ) {
        self.source = source
        self.kinds = kinds
        self.accounts = accounts
        self.collections = collections
        self.text = text
    }

    /// `DEFAULT_VIEW`.
    public static let `default` = StreamMonitorFilters()
}

/// `Preset`: a starting point offered as a chip.
public struct StreamPreset: Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let hint: String
    public let filters: StreamMonitorFilters
}

public enum StreamMonitor {
    /// `STREAM_KINDS`.
    public static let kinds: [StreamKindMeta] = [
        StreamKindMeta(id: .create, source: .jetstream, label: "Create", badge: "create", hint: "A record was written to a repo"),
        StreamKindMeta(id: .update, source: .jetstream, label: "Update", badge: "update", hint: "A record was replaced"),
        StreamKindMeta(id: .delete, source: .jetstream, label: "Delete", badge: "delete", hint: "A record was removed"),
        StreamKindMeta(
            id: .identity, source: .jetstream, label: "Identity", badge: "identity",
            hint: "A handle or DID document may have changed"
        ),
        StreamKindMeta(
            id: .account, source: .jetstream, label: "Account", badge: "account",
            hint: "An account was activated, deactivated, suspended or taken down"
        ),
        StreamKindMeta(id: .plcNew, source: .plc, label: "New DID", badge: "new DID", hint: "The first operation for a did:plc"),
        StreamKindMeta(
            id: .plcUpdate, source: .plc, label: "DID update", badge: "DID update",
            hint: "A change to an existing DID: handle, PDS or keys"
        ),
        StreamKindMeta(
            id: .plcTombstone, source: .plc, label: "Tombstone", badge: "tombstone",
            hint: "A DID was permanently deactivated"
        ),
    ]

    /// `ALL_KINDS`, in the web's order.
    public static let allKinds: [StreamKind] = StreamKind.allCases

    /// `kindsOf`.
    public static func kinds(of source: StreamSource) -> [StreamKind] {
        allKinds.filter { $0.source == source }
    }

    /// Jetstream's documented ceiling on `wantedCollections`.
    public static let maxCollections = 100
    /// Far below Jetstream's 10,000: the list lives in the query string.
    public static let maxAccounts = 100

    // MARK: Decoding

    /// The fields a Jetstream message is narrowed by. Everything else in the
    /// message, the record included, is left for the row builder.
    private struct JetstreamWire: Decodable {
        struct Commit: Decodable {
            let operation: String?
            let collection: String?
            let rkey: String?
        }

        struct Identity: Decodable {
            let handle: String?
        }

        struct Account: Decodable {
            let active: Bool?
            let status: String?
        }

        let did: String?
        let time_us: Int?
        let kind: String?
        let commit: Commit?
        let identity: Identity?
        let account: Account?
    }

    /// Narrow one Jetstream message to the three shapes Jetstream documents
    /// (`asJetstreamEvent`). Malformed messages and unknown kinds read as nil.
    public static func decodeJetstream(_ text: String) -> StreamJetstreamEvent? {
        guard let wire = try? JSONDecoder().decode(JetstreamWire.self, from: Data(text.utf8)),
            let did = wire.did
        else { return nil }
        let timeUs = wire.time_us ?? 0
        switch wire.kind ?? "" {
        case "commit":
            guard let commit = wire.commit, let collection = commit.collection,
                let operation = commit.operation.flatMap(JetstreamOperation.init(rawValue:))
            else { return nil }
            return StreamJetstreamEvent(
                did: did, timeUs: timeUs,
                body: .commit(operation: operation, collection: collection, rkey: commit.rkey ?? ""),
                raw: text
            )
        case "identity":
            guard let identity = wire.identity else { return nil }
            return StreamJetstreamEvent(did: did, timeUs: timeUs, body: .identity(handle: identity.handle), raw: text)
        case "account":
            guard let account = wire.account else { return nil }
            return StreamJetstreamEvent(
                did: did, timeUs: timeUs,
                body: .account(active: account.active ?? false, status: account.status),
                raw: text
            )
        default:
            return nil
        }
    }

    /// Narrow one PLC export message (`asPlcStreamEntry`): a `sequenced_op`
    /// with a numeric `seq`, a `did` and an `operation` object. Messages of
    /// any other type are skipped rather than guessed at.
    public static func decodePlc(_ text: String) -> PlcStreamEntry? {
        guard let json = try? JSONValue.parse(Data(text.utf8)),
            json["type"]?.stringValue == "sequenced_op",
            let seq = json["seq"]?.intValue,
            let did = json["did"]?.stringValue,
            let operation = json["operation"], operation.objectValue != nil
        else { return nil }
        return PlcStreamEntry(
            seq: seq,
            did: did,
            operation: PlcStreamOperation(json: operation),
            cid: json["cid"]?.stringValue ?? "",
            createdAt: json["createdAt"]?.stringValue ?? "",
            nullified: json["nullified"]?.boolValue ?? false,
            raw: text,
            data: json
        )
    }

    // MARK: Rows

    private static func repoHref(_ did: String) -> String {
        explorePath(fromAtUri: did) ?? "/explore/\(did)"
    }

    /// `itemFromJetstream`. The record and the JSON view are read from the
    /// raw message here, once a row is kept.
    public static func item(fromJetstream event: StreamJetstreamEvent, id: Int) -> StreamItem {
        let data = (try? JSONValue.parse(Data(event.raw.utf8))) ?? .object([:])
        var item: StreamItem
        let time = Date(timeIntervalSince1970: Double(event.timeUs) / 1_000_000)
        switch event.body {
        case .commit(let operation, let collection, let rkey):
            let record = data["commit"]?["record"]
            // previewFor falls back to createdAt, which the row's clock already shows.
            let preview = operation == .delete ? "" : RecordPreview.previewFor(record)
            let recordPath = explorePath(fromAtUri: "at://\(event.did)/\(collection)/\(rkey)")
            let collectionPath = explorePath(fromAtUri: "at://\(event.did)/\(collection)")
            // A deleted record has nothing left to open; its collection does.
            let href = (operation == .delete ? collectionPath : recordPath) ?? repoHref(event.did)
            item = StreamItem(id: id, source: .jetstream, kind: event.kind, did: event.did, time: time, href: href, raw: event.raw, data: data)
            item.collection = collection
            item.rkey = rkey
            let createdAt = record?["createdAt"]?.stringValue
            item.preview = !preview.isEmpty && preview != createdAt ? preview : nil
            if let record, record.objectValue != nil { item.record = record }
            item.cid = data["commit"]?["cid"]?.stringValue
        case .identity(let handle):
            item = StreamItem(id: id, source: .jetstream, kind: .identity, did: event.did, time: time, href: repoHref(event.did), raw: event.raw, data: data)
            item.handle = handle
        case .account(let active, let status):
            item = StreamItem(id: id, source: .jetstream, kind: .account, did: event.did, time: time, href: repoHref(event.did), raw: event.raw, data: data)
            item.active = active
            item.status = status
        }
        return item
    }

    /// `plcKind`.
    public static func plcKind(_ op: PlcStreamOperation) -> StreamKind {
        if op.type == "plc_tombstone" { return .plcTombstone }
        return op.prev == nil ? .plcNew : .plcUpdate
    }

    /// The first handle a PLC operation claims, from either operation format.
    public static func plcHandle(_ op: PlcStreamOperation) -> String? {
        if let aka = op.alsoKnownAs?.first(where: { $0.hasPrefix("at://") }) {
            return String(aka.dropFirst("at://".count))
        }
        return op.handle
    }

    /// The PDS host a PLC operation points at, without the scheme.
    public static func plcPdsHost(_ op: PlcStreamOperation) -> String? {
        guard let endpoint = op.serviceEndpoints?["atproto_pds"] ?? op.service, !endpoint.isEmpty else { return nil }
        var host = endpoint
        if host.hasPrefix("https://") {
            host.removeFirst("https://".count)
        } else if host.hasPrefix("http://") {
            host.removeFirst("http://".count)
        }
        if host.hasSuffix("/") { host.removeLast() }
        return host
    }

    /// `itemFromPlc`. A time the directory wrote badly reads as now.
    public static func item(fromPlc entry: PlcStreamEntry, id: Int, now: Date = Date()) -> StreamItem {
        let kind = plcKind(entry.operation)
        let tombstone = kind == .plcTombstone
        var item = StreamItem(
            id: id, source: .plc, kind: kind, did: entry.did,
            time: Formatting.isoDate(entry.createdAt) ?? now,
            href: repoHref(entry.did), raw: entry.raw, data: entry.data
        )
        item.handle = tombstone ? nil : plcHandle(entry.operation)
        item.pds = tombstone ? nil : plcPdsHost(entry.operation)
        item.plcEntry = entry
        return item
    }

    private static func signingKey(_ op: PlcStreamOperation) -> String? {
        op.verificationMethods?["atproto"] ?? op.signingKey
    }

    private static func rotationKeys(_ op: PlcStreamOperation) -> String {
        let keys = op.rotationKeys ?? [op.recoveryKey, op.signingKey].compactMap { $0 }.filter { !$0.isEmpty }
        return keys.joined(separator: " ")
    }

    /// What one PLC operation changed relative to the one before it, field
    /// by field, for the open row. A finer cut than `PLCClient.diffOps`,
    /// which says "services updated" where this names the PDS it moved from
    /// and to.
    public static func describePlcChange(prev: PlcStreamOperation?, next: PlcStreamOperation) -> [StreamPlcChange] {
        var changes: [StreamPlcChange] = []
        let pairs: [(StreamPlcChange.Field, (PlcStreamOperation) -> String?)] = [
            (.handle, plcHandle),
            (.pds, plcPdsHost),
            (.signingKey, signingKey),
        ]
        for (field, read) in pairs {
            let from = prev.flatMap(read)
            let to = read(next)
            if from != to { changes.append(StreamPlcChange(field: field, from: from, to: to)) }
        }
        if let prev, rotationKeys(prev) != rotationKeys(next) {
            changes.append(StreamPlcChange(field: .rotationKeys, from: nil, to: nil))
        }
        return changes
    }

    /// Case-insensitive match anywhere in the event's JSON. `needle` is lowercased.
    public static func matchesText(_ raw: String, needle: String) -> Bool {
        needle.isEmpty || raw.lowercased().contains(needle)
    }

    // MARK: Typed filters

    /// `HANDLE_RE`, run on the lowercased text.
    private static let handlePattern = #/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/#

    /// Read an account the way people paste one: a DID, a handle with or
    /// without the @, or an at:// URI (its authority is the account).
    public static func parseAccountToken(_ input: String) -> StreamAccountToken? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("at://") {
            s = String(s.dropFirst("at://".count).prefix { $0 != "/" })
        }
        if s.hasPrefix("@") { s.removeFirst() }
        if s.hasPrefix("did:") { return isValidDid(s) ? .did(s) : nil }
        let handle = s.lowercased()
        return handle.wholeMatch(of: handlePattern) != nil ? .handle(handle) : nil
    }

    /// A collection filter is a full NSID, or a namespace ending in `.*`,
    /// which Jetstream expands server-side (`app.bsky.graph.*`). A prefix is
    /// accepted when it could begin a valid NSID.
    public static func parseCollectionToken(_ input: String) -> String? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasSuffix(".*") {
            let prefix = String(s.dropLast(2))
            return prefix.contains(".") && isValidNsid(prefix + ".x") ? s : nil
        }
        return isValidNsid(s) ? s : nil
    }

    // MARK: Matching

    public static func compileFilter(_ filters: StreamMonitorFilters, dids: Set<String>?) -> StreamCompiledFilter {
        StreamCompiledFilter(
            source: filters.source,
            kinds: Set(filters.kinds),
            dids: dids,
            collections: filters.collections,
            needle: filters.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        )
    }

    /// Exact NSID, or a `.*` namespace as Jetstream reads one.
    public static func collectionMatches(_ collection: String, filters: [String]) -> Bool {
        filters.contains { filter in
            filter.hasSuffix(".*") ? collection.hasPrefix(String(filter.dropLast())) : collection == filter
        }
    }

    /// Every filter but the event type. The monitor counts what passes this
    /// per type, so a switched-off chip still says how much it is holding
    /// back.
    ///
    /// Collections narrow commits only, as they do on Jetstream itself:
    /// identity and account events carry no collection and pass through.
    public static func matchesExceptKind(_ filter: StreamCompiledFilter, _ probe: StreamProbe) -> Bool {
        if !filter.source.shows(probe.source) { return false }
        if let dids = filter.dids, !dids.contains(probe.did) { return false }
        if !filter.collections.isEmpty, let collection = probe.collection,
            !collectionMatches(collection, filters: filter.collections) {
            return false
        }
        return matchesText(probe.raw, needle: filter.needle)
    }

    public static func matchesFilter(_ filter: StreamCompiledFilter, _ probe: StreamProbe) -> Bool {
        filter.kinds.contains(probe.kind) && matchesExceptKind(filter, probe)
    }

    // MARK: Presets

    /// Kinds for a view that shows only `source`: the listed kinds, plus
    /// every kind of the other source, so switching the source back later
    /// finds it on.
    private static func only(_ source: StreamSource, _ kinds: [StreamKind]) -> [StreamKind] {
        allKinds.filter { kinds.contains($0) || $0.source != source }
    }

    /// `PRESETS`: starting points offered beside the intro, as the explorer
    /// offers handles.
    public static let presets: [StreamPreset] = [
        StreamPreset(
            id: "new-accounts", label: "New accounts",
            hint: "Each new did:plc, with the handle and PDS it starts on",
            filters: StreamMonitorFilters(source: .plc, kinds: only(.plc, [.plcNew]))
        ),
        StreamPreset(
            id: "moves", label: "Handle and PDS changes",
            hint: "Updates to existing DIDs: new handles, PDS migrations, key rotations",
            filters: StreamMonitorFilters(source: .plc, kinds: only(.plc, [.plcUpdate]))
        ),
        StreamPreset(
            id: "posts", label: "Bluesky posts",
            hint: "New app.bsky.feed.post records",
            filters: StreamMonitorFilters(source: .jetstream, kinds: only(.jetstream, [.create]), collections: ["app.bsky.feed.post"])
        ),
        StreamPreset(
            id: "follows", label: "Follows and unfollows",
            hint: "app.bsky.graph.follow records created and deleted",
            filters: StreamMonitorFilters(source: .jetstream, kinds: only(.jetstream, [.create, .delete]), collections: ["app.bsky.graph.follow"])
        ),
        StreamPreset(
            id: "profiles", label: "Profile edits",
            hint: "app.bsky.actor.profile records written",
            filters: StreamMonitorFilters(source: .jetstream, kinds: only(.jetstream, [.create, .update]), collections: ["app.bsky.actor.profile"])
        ),
        StreamPreset(
            id: "account-status", label: "Account status",
            hint: "Activations, deactivations, suspensions and takedowns",
            filters: StreamMonitorFilters(source: .jetstream, kinds: only(.jetstream, [.account]))
        ),
    ]

    // MARK: Filters <-> query string

    /// Only the kinds of the sources on show are written to the query
    /// string, and none at all when every one of them is on. Reading it
    /// back, a source the view hides keeps all its kinds, so switching from
    /// "PLC" back to "Both" after following a link doesn't find Jetstream
    /// switched off. `type=none` records a view with every visible kind off.
    public static func filters(from items: NetworkToolQueryItems) -> StreamMonitorFilters {
        let source = NetworkToolQuery.first("source", in: items).flatMap(StreamSourceChoice.init(rawValue:)) ?? .both

        let typed = NetworkToolQuery.all("type", in: items)
        var kinds = allKinds
        if !typed.isEmpty {
            let listed = Set(typed.compactMap(StreamKind.init(rawValue:)))
            kinds = allKinds.filter { listed.contains($0) || !source.shows($0.source) }
        }

        let accounts = unique(NetworkToolQuery.all("account", in: items).filter { parseAccountToken($0) != nil })
        let collections = unique(NetworkToolQuery.all("collection", in: items).filter { parseCollectionToken($0) != nil })

        return StreamMonitorFilters(
            source: source,
            kinds: kinds,
            accounts: Array(accounts.prefix(maxAccounts)),
            collections: Array(collections.prefix(maxCollections)),
            text: NetworkToolQuery.first("q", in: items) ?? ""
        )
    }

    /// The query a view is kept under (`viewToSearch`), as ordered pairs.
    public static func queryItems(for filters: StreamMonitorFilters) -> NetworkToolQueryItems {
        var items: NetworkToolQueryItems = []
        if filters.source != .both { items.append(("source", filters.source.rawValue)) }

        let visible = allKinds.filter { filters.source.shows($0.source) }
        let on = visible.filter { filters.kinds.contains($0) }
        if on.isEmpty {
            items.append(("type", "none"))
        } else if on.count < visible.count {
            for kind in on { items.append(("type", kind.rawValue)) }
        }

        for account in filters.accounts { items.append(("account", account)) }
        if filters.source != .plc {
            for collection in filters.collections { items.append(("collection", collection)) }
        }
        let text = filters.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { items.append(("q", text)) }
        return items
    }

    /// `viewToSearch`: the query string, encoded as `URLSearchParams` does.
    public static func search(for filters: StreamMonitorFilters) -> String {
        NetworkToolQuery.encode(queryItems(for: filters))
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    // MARK: Formatting

    /// `Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })`
    /// for counts of a thousand or more: 1234 -> "1.2K", 1000 -> "1K",
    /// 2_500_000 -> "2.5M".
    public static func formatCount(_ n: Int) -> String {
        if n < 1000 { return String(n) }
        let units: [(Double, String)] = [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")]
        let value = Double(n)
        for (index, unit) in units.enumerated() where value >= unit.0 {
            let scaled = (value / unit.0 * 10).rounded() / 10
            // 999_950 rounds to 1000K, which Intl writes as the next unit up.
            if scaled >= 1000, index > 0 {
                let bigger = units[index - 1]
                return trimmed((value / bigger.0 * 10).rounded() / 10) + bigger.1
            }
            return trimmed(scaled) + unit.1
        }
        return String(n)
    }

    private static func trimmed(_ value: Double) -> String {
        if value == value.rounded() { return String(Int(value)) }
        return String(format: "%.1f", value)
    }

    /// `formatRate`: one decimal under ten a second, a compact count above.
    public static func formatRate(_ perSecond: Double) -> String {
        if perSecond > 0 && perSecond < 10 { return String(format: "%.1f", perSecond) + "/s" }
        return formatCount(Int(perSecond.rounded())) + "/s"
    }

    /// `formatSpan`: "26s", "4m 12s", "1h 3m".
    public static func formatSpan(_ seconds: TimeInterval) -> String {
        let s = max(1, Int(seconds.rounded()))
        if s < 60 { return "\(s)s" }
        let m = s / 60
        return m < 60 ? "\(m)m \(s % 60)s" : "\(m / 60)h \(m % 60)m"
    }

    /// The row clock: 24-hour `HH:mm:ss` in the device's time zone, as the
    /// web's `Intl.DateTimeFormat(undefined, { hour12: false })` writes it.
    public static func clockTime(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.hour, .minute, .second], from: date)
        func two(_ n: Int?) -> String {
            let value = n ?? 0
            return value < 10 ? "0\(value)" : String(value)
        }
        return "\(two(parts.hour)):\(two(parts.minute)):\(two(parts.second))"
    }

    /// `shortValue`: a long key or DID cut in the middle for the changes list.
    public static func shortValue(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "\u{2014}" }
        guard value.count > 40 else { return value }
        return String(value.prefix(24)) + "\u{2026}" + String(value.suffix(8))
    }

    /// `compactPreview`: a record's preview line, with the references likes,
    /// reposts and follows carry cut down to what tells them apart:
    /// `feed.post by did:plc:abcd…wxyz` rather than the whole at:// URI.
    public static func compactPreview(_ preview: String) -> (text: String, mono: Bool) {
        if preview.hasPrefix("at://"), let parsed = AtUri(parsing: preview) {
            let tail = parsed.collection.map { $0.split(separator: ".").suffix(2).joined(separator: ".") } ?? "repo"
            return ("\(tail) by \(shortDid(parsed.repo))", true)
        }
        if preview.wholeMatch(of: #/did:[a-z]+:\S+/#) != nil { return (shortDid(preview), true) }
        return (preview, false)
    }
}
