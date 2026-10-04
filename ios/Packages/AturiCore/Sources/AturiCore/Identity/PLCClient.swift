import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The DID document plc.directory serves for a did:plc, port of `PlcDocument`
/// in `src/utils/atproto/plc.ts`. Same shape as `DIDDocument` plus the JSON-LD
/// `@context`; the nested types are shared.
public struct PlcDocument: Codable, Hashable, Sendable {
    public var id: String
    public var context: [String]?
    public var alsoKnownAs: [String]?
    public var verificationMethod: [DIDDocument.VerificationMethod]?
    public var service: [DIDDocument.Service]?

    public init(
        id: String,
        context: [String]? = nil,
        alsoKnownAs: [String]? = nil,
        verificationMethod: [DIDDocument.VerificationMethod]? = nil,
        service: [DIDDocument.Service]? = nil
    ) {
        self.id = id
        self.context = context
        self.alsoKnownAs = alsoKnownAs
        self.verificationMethod = verificationMethod
        self.service = service
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case context = "@context"
        case alsoKnownAs, verificationMethod, service
    }

    public init(from decoder: Decoder) throws {
        // Reuse DIDDocument's lenient element decoding, then pick up the
        // one extra key.
        let base = try DIDDocument(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = base.id
        context = try? container.decodeIfPresent([String].self, forKey: .context)
        alsoKnownAs = base.alsoKnownAs
        verificationMethod = base.verificationMethod
        service = base.service
    }

    /// The same document as the resolver's `DIDDocument`.
    public var didDocument: DIDDocument {
        DIDDocument(id: id, alsoKnownAs: alsoKnownAs, verificationMethod: verificationMethod, service: service)
    }
}

/// One PLC operation as the audit log carries it. Every field is optional
/// and decoded leniently: legacy `create` operations and `plc_tombstone`
/// entries carry a different shape, and a field the directory changes the
/// type of should not break the audit view.
public struct PlcOperation: Codable, Hashable, Sendable {
    public struct ServiceEntry: Codable, Hashable, Sendable {
        public var type: String
        public var endpoint: String

        public init(type: String, endpoint: String) {
            self.type = type
            self.endpoint = endpoint
        }
    }

    public var type: String?
    public var prev: String?
    public var alsoKnownAs: [String]?
    public var services: [String: ServiceEntry]?
    public var rotationKeys: [String]?
    public var verificationMethods: [String: String]?
    public var sig: String?

    public init(
        type: String? = nil,
        prev: String? = nil,
        alsoKnownAs: [String]? = nil,
        services: [String: ServiceEntry]? = nil,
        rotationKeys: [String]? = nil,
        verificationMethods: [String: String]? = nil,
        sig: String? = nil
    ) {
        self.type = type
        self.prev = prev
        self.alsoKnownAs = alsoKnownAs
        self.services = services
        self.rotationKeys = rotationKeys
        self.verificationMethods = verificationMethods
        self.sig = sig
    }

    private enum CodingKeys: String, CodingKey {
        case type, prev, alsoKnownAs, services, rotationKeys, verificationMethods, sig
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try? container.decodeIfPresent(String.self, forKey: .type)
        prev = try? container.decodeIfPresent(String.self, forKey: .prev)
        alsoKnownAs = try? container.decodeIfPresent([String].self, forKey: .alsoKnownAs)
        services = try? container.decodeIfPresent([String: ServiceEntry].self, forKey: .services)
        rotationKeys = try? container.decodeIfPresent([String].self, forKey: .rotationKeys)
        verificationMethods = try? container.decodeIfPresent([String: String].self, forKey: .verificationMethods)
        sig = try? container.decodeIfPresent(String.self, forKey: .sig)
    }
}

public struct PlcAuditEntry: Codable, Hashable, Sendable {
    public var did: String
    public var operation: PlcOperation
    public var cid: String?
    public var nullified: Bool?
    /// ISO timestamp as the directory wrote it; `createdDate` parses it.
    public var createdAt: String

    public init(did: String, operation: PlcOperation, cid: String? = nil, nullified: Bool? = nil, createdAt: String) {
        self.did = did
        self.operation = operation
        self.cid = cid
        self.nullified = nullified
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case did, operation, cid, nullified, createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        did = (try? container.decodeIfPresent(String.self, forKey: .did)) ?? ""
        operation = (try? container.decodeIfPresent(PlcOperation.self, forKey: .operation)) ?? PlcOperation()
        cid = try? container.decodeIfPresent(String.self, forKey: .cid)
        nullified = try? container.decodeIfPresent(Bool.self, forKey: .nullified)
        createdAt = (try? container.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
    }

    public var createdDate: Date? {
        Formatting.isoDate(createdAt)
    }
}

public enum PLCClientError: Error, Equatable, Sendable {
    case missingDid
}

/// PLC directory client, port of `src/utils/atproto/plc.ts`.
///
///   - document(did)  -> full DID document with services, keys, AKAs.
///   - auditLog(did)  -> raw operation log (oldest to newest).
///
/// Both responses are cached for 30 s so the repo screen's document and
/// audit panels share one fetch. The caches belong to the instance; use
/// `shared` from screens so they actually share.
public struct PLCClient: Sendable {
    public static let shared = PLCClient()

    /// Matches `PLC_TTL`.
    public static let cacheTTL: TimeInterval = 30

    private let http: HTTPClient
    private let documents: TTLCache<String, PlcDocument>
    private let audits: TTLCache<String, [PlcAuditEntry]>

    public init(http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        documents = TTLCache(ttl: PLCClient.cacheTTL, clock: clock)
        audits = TTLCache(ttl: PLCClient.cacheTTL, clock: clock)
    }

    public func document(did: String) async throws -> PlcDocument {
        guard !did.isEmpty else { throw PLCClientError.missingDid }
        if let cached = await documents.get(did) { return cached }
        // The web percent-encodes the DID here; plc.directory serves the raw
        // and encoded spellings identically, and makeURL keeps ':' as is.
        let url = makeURL(Endpoints.plcDirectory, path: did)
        let doc = try await http.getJSON(PlcDocument.self, from: url)
        await documents.set(did, doc)
        return doc
    }

    public func auditLog(did: String) async throws -> [PlcAuditEntry] {
        guard !did.isEmpty else { throw PLCClientError.missingDid }
        if let cached = await audits.get(did) { return cached }
        let url = makeURL(Endpoints.plcDirectory, path: did + "/log/audit")
        let log = try await http.getJSON([PlcAuditEntry].self, from: url)
        await audits.set(did, log)
        return log
    }

    /// Human-readable changes between two PLC operations: "+ handle x",
    /// "\u{2212} handle y", "services updated", "keys rotated". Used by the
    /// audit log view. Same output as the web's `diffOps`, except that
    /// service maps are compared as maps rather than by serialised key order.
    public static func diffOps(prev: PlcOperation?, next: PlcOperation?) -> [String] {
        guard let next else { return [] }
        var changes: [String] = []

        let prevAka = prev?.alsoKnownAs ?? []
        let nextAka = next.alsoKnownAs ?? []
        for handle in nextAka where !prevAka.contains(handle) {
            changes.append("+ handle \(handle)")
        }
        for handle in prevAka where !nextAka.contains(handle) {
            changes.append("\u{2212} handle \(handle)")
        }

        if (prev?.services ?? [:]) != (next.services ?? [:]) {
            changes.append("services updated")
        }

        if keyMaterial(of: prev) != keyMaterial(of: next) {
            changes.append("keys rotated")
        }

        return changes
    }

    /// `rotationKeys || verificationMethods || {}` as a JSON value, so an
    /// op that switches from one representation to the other reads as a
    /// rotation just as the web's stringified comparison does (an empty
    /// rotationKeys array is a value, not an absence).
    private static func keyMaterial(of op: PlcOperation?) -> JSONValue {
        if let keys = op?.rotationKeys {
            return .array(keys.map(JSONValue.string))
        }
        if let methods = op?.verificationMethods {
            return .object(methods.mapValues(JSONValue.string))
        }
        return .object([:])
    }

    /// The PDS endpoint a PLC document names: `#atproto_pds` first, then any
    /// `AtprotoPersonalDataServer`, then the first service at all. Trailing
    /// slash stripped; nil when there is none.
    public static func extractPds(from doc: PlcDocument) -> String? {
        let services = doc.service ?? []
        let endpoint = services.first { $0.id == "#atproto_pds" }?.serviceEndpoint.nonEmpty
            ?? services.first { $0.type == "AtprotoPersonalDataServer" }?.serviceEndpoint.nonEmpty
            ?? services.first?.serviceEndpoint.nonEmpty
        guard let endpoint else { return nil }
        return endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint
    }
}

private extension String {
    /// JS falsiness for the `||` chains above: "" is no endpoint.
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
