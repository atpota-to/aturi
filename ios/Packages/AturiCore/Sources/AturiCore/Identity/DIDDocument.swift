import Foundation

/// A DID document as plc.directory or a did:web host serves it. Port of the
/// `DidDocument` type in `src/utils/didResolver.ts`.
///
/// Decoding is lenient where the DID core spec allows variation the web's
/// loose typing tolerated silently: `serviceEndpoint` may be a string, an
/// array of strings (the first is taken) or a map (ignored), and a service
/// or key entry missing its id or type is dropped rather than failing the
/// whole document.
public struct DIDDocument: Codable, Hashable, Sendable {
    public struct VerificationMethod: Codable, Hashable, Sendable {
        public var id: String
        public var type: String
        public var controller: String?
        public var publicKeyMultibase: String?

        public init(id: String, type: String, controller: String? = nil, publicKeyMultibase: String? = nil) {
            self.id = id
            self.type = type
            self.controller = controller
            self.publicKeyMultibase = publicKeyMultibase
        }
    }

    public struct Service: Codable, Hashable, Sendable {
        public var id: String
        public var type: String
        public var serviceEndpoint: String

        public init(id: String, type: String, serviceEndpoint: String) {
            self.id = id
            self.type = type
            self.serviceEndpoint = serviceEndpoint
        }

        private enum CodingKeys: String, CodingKey {
            case id, type, serviceEndpoint
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            type = try container.decode(String.self, forKey: .type)
            if let single = try? container.decode(String.self, forKey: .serviceEndpoint) {
                serviceEndpoint = single
            } else if let many = try? container.decode([String].self, forKey: .serviceEndpoint), let first = many.first {
                serviceEndpoint = first
            } else {
                serviceEndpoint = ""
            }
        }
    }

    public var id: String
    public var alsoKnownAs: [String]?
    public var verificationMethod: [VerificationMethod]?
    public var service: [Service]?

    public init(
        id: String,
        alsoKnownAs: [String]? = nil,
        verificationMethod: [VerificationMethod]? = nil,
        service: [Service]? = nil
    ) {
        self.id = id
        self.alsoKnownAs = alsoKnownAs
        self.verificationMethod = verificationMethod
        self.service = service
    }

    private enum CodingKeys: String, CodingKey {
        case id, alsoKnownAs, verificationMethod, service
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        alsoKnownAs = try container.decodeIfPresent([String].self, forKey: .alsoKnownAs)
        verificationMethod = try container.decodeIfPresent(LossyEntries<VerificationMethod>.self, forKey: .verificationMethod)?.entries
        service = try container.decodeIfPresent(LossyEntries<Service>.self, forKey: .service)?.entries
    }

    /// The ATProto PDS service endpoint (`#atproto_pds`, or any service of
    /// type `AtprotoPersonalDataServer`), verbatim. Nil when the document
    /// names no PDS.
    public var pdsEndpoint: String? {
        let match = service?.first { $0.id == "#atproto_pds" || $0.type == "AtprotoPersonalDataServer" }
        guard let endpoint = match?.serviceEndpoint, !endpoint.isEmpty else { return nil }
        return endpoint
    }

    /// The handle the document claims: the first `at://` entry in
    /// alsoKnownAs. A claim, not a verification; the DID's controller writes
    /// this field and nothing here checks that it resolves back to the DID.
    public var handle: String? {
        guard let aka = alsoKnownAs?.first(where: { $0.hasPrefix("at://") }) else { return nil }
        let handle = String(aka.dropFirst("at://".count))
        return handle.isEmpty ? nil : handle
    }
}

/// Decodes an array element by element, dropping the ones that fail, so a
/// single malformed service entry does not take the document with it.
private struct LossyEntries<Element: Decodable>: Decodable {
    let entries: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var collected: [Element] = []
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                collected.append(element)
            } else {
                _ = try? container.decode(DiscardedEntry.self)
            }
        }
        entries = collected
    }
}

/// Consumes any JSON value so an unkeyed container can advance past an
/// element it could not decode.
private struct DiscardedEntry: Decodable {
    init(from decoder: Decoder) throws {
        _ = try JSONValue(from: decoder)
    }
}
