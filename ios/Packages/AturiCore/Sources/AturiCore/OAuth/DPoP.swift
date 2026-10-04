import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// The signing half of a DPoP key pair (RFC 9449). The package only ever
/// needs the public JWK for the proof header and a raw ES256 signature over
/// the JWT signing input; the app backs it with a CryptoKit P-256 key kept
/// in the Keychain, and tests with a deterministic fake, so nothing here
/// depends on a crypto library.
public protocol DPoPKey: Sendable {
    /// The public key as a JWK: `kty` `EC`, `crv` `P-256`, `x` and `y` as
    /// unpadded base64url. Never the private `d` component.
    var publicJWK: [String: String] { get }

    /// ES256 over `data` (the key hashes with SHA-256 itself): the raw
    /// `r || s` concatenation, 64 bytes, not DER.
    func sign(_ data: Data) throws -> Data
}

/// A key at rest: the private key as an opaque blob the app's key type
/// knows how to reopen (PKCS#8 DER for `P256DPoPKey`), plus the public JWK
/// so a session can be described without reopening the key. Encodes as
/// JSON with the blob in base64, which is what the Keychain item holds.
public struct DPoPKeySerialization: Codable, Hashable, Sendable {
    /// Names the blob's format so a future key type cannot misread another's.
    public static let pkcs8Format = "pkcs8"

    public var format: String
    public var privateKey: Data
    public var publicJWK: [String: String]

    public init(format: String = DPoPKeySerialization.pkcs8Format, privateKey: Data, publicJWK: [String: String]) {
        self.format = format
        self.privateKey = privateKey
        self.publicJWK = publicJWK
    }
}

public enum DPoPError: Error, Equatable {
    /// The JWK is missing `x` or `y`, or they are not 32-byte coordinates.
    case invalidPublicJWK
    /// The signature was not the 64 raw bytes ES256 demands.
    case invalidSignatureLength(Int)
    /// The stored blob could not be reopened as a key.
    case invalidSerializedKey(String)
    /// The URL has no scheme or host and cannot be an `htu`.
    case invalidTargetURL(String)
}

/// Builds the `DPoP` header value: a JWS with `typ: dpop+jwt`, `alg: ES256`
/// and the public JWK in the header, and `jti`, `htm`, `htu`, `iat`, plus
/// the server's `nonce` and the access token hash `ath` when they apply.
public enum DPoPProof {
    public static let type = "dpop+jwt"
    public static let algorithm = "ES256"

    /// `now` and `jti` are parameters so a test can pin the payload; callers
    /// take the defaults.
    public static func make(
        key: DPoPKey,
        htm: String,
        htu: URL,
        nonce: String? = nil,
        accessToken: String? = nil,
        now: Date = Date(),
        jti: String = OAuthRandom.token(bytes: 16)
    ) throws -> String {
        let jwk = key.publicJWK
        guard let x = jwk["x"], let y = jwk["y"],
            OAuthBase64URL.decode(x)?.count == 32, OAuthBase64URL.decode(y)?.count == 32
        else {
            throw DPoPError.invalidPublicJWK
        }

        let header: JSONValue = .object([
            "typ": .string(type),
            "alg": .string(algorithm),
            "jwk": .object([
                "kty": .string(jwk["kty"] ?? "EC"),
                "crv": .string(jwk["crv"] ?? "P-256"),
                "x": .string(x),
                "y": .string(y),
            ]),
        ])

        var claims: [String: JSONValue] = [
            "jti": .string(jti),
            "htm": .string(htm.uppercased()),
            "htu": .string(try targetURI(htu)),
            "iat": .number(now.timeIntervalSince1970.rounded(.down)),
        ]
        if let nonce, !nonce.isEmpty {
            claims["nonce"] = .string(nonce)
        }
        if let accessToken {
            claims["ath"] = .string(accessTokenHash(accessToken))
        }

        let signingInput = encodeSegment(header) + "." + encodeSegment(.object(claims))
        let signature = try key.sign(Data(signingInput.utf8))
        guard signature.count == 64 else {
            throw DPoPError.invalidSignatureLength(signature.count)
        }
        return signingInput + "." + OAuthBase64URL.encode(signature)
    }

    /// `ath`: base64url(SHA-256(access token)), which binds a proof on a
    /// resource request to the token it accompanies.
    public static func accessTokenHash(_ accessToken: String) -> String {
        OAuthBase64URL.encode(OAuthSHA256.hash(Data(accessToken.utf8)))
    }

    /// `htu`: the target URI without its query and fragment (RFC 9449
    /// section 4.2). Scheme and host are lowercased so the server's
    /// comparison, which normalizes the same way, matches.
    public static func targetURI(_ url: URL) throws -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: true),
            let scheme = components.scheme, let host = components.host, !host.isEmpty
        else {
            throw DPoPError.invalidTargetURL(url.absoluteString)
        }
        components.scheme = scheme.lowercased()
        components.host = host.lowercased()
        components.query = nil
        components.fragment = nil
        guard let target = components.url?.absoluteString else {
            throw DPoPError.invalidTargetURL(url.absoluteString)
        }
        return target
    }

    /// The decoded header and payload of a proof, for tests and diagnostics.
    public static func decode(_ proof: String) -> (header: JSONValue, payload: JSONValue, signature: Data)? {
        let parts = proof.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
            let headerData = OAuthBase64URL.decode(String(parts[0])),
            let payloadData = OAuthBase64URL.decode(String(parts[1])),
            let signature = OAuthBase64URL.decode(String(parts[2])),
            let header = try? JSONValue.parse(headerData),
            let payload = try? JSONValue.parse(payloadData)
        else {
            return nil
        }
        return (header, payload, signature)
    }

    private static func encodeSegment(_ value: JSONValue) -> String {
        OAuthBase64URL.encode(Data(value.compactString(sortKeys: true).utf8))
    }
}

#if canImport(CryptoKit)
/// The production key: a CryptoKit P-256 signing key. `signature(for:)`
/// hashes with SHA-256 and `rawRepresentation` is `r || s`, exactly what
/// ES256 in a JWS wants. Persisted as PKCS#8 DER via `derRepresentation`.
public struct P256DPoPKey: DPoPKey, @unchecked Sendable {
    public let privateKey: P256.Signing.PrivateKey

    public init() {
        privateKey = P256.Signing.PrivateKey()
    }

    public init(privateKey: P256.Signing.PrivateKey) {
        self.privateKey = privateKey
    }

    /// Reopen a key from its PKCS#8 DER form.
    public init(pkcs8: Data) throws {
        do {
            privateKey = try P256.Signing.PrivateKey(derRepresentation: pkcs8)
        } catch {
            throw DPoPError.invalidSerializedKey(String(describing: error))
        }
    }

    /// Reopen a key from its 32-byte scalar (`rawRepresentation`).
    public init(rawRepresentation: Data) throws {
        do {
            privateKey = try P256.Signing.PrivateKey(rawRepresentation: rawRepresentation)
        } catch {
            throw DPoPError.invalidSerializedKey(String(describing: error))
        }
    }

    public init(serialized: DPoPKeySerialization) throws {
        guard serialized.format == DPoPKeySerialization.pkcs8Format else {
            throw DPoPError.invalidSerializedKey("unknown format \(serialized.format)")
        }
        try self.init(pkcs8: serialized.privateKey)
    }

    public var serialized: DPoPKeySerialization {
        DPoPKeySerialization(privateKey: privateKey.derRepresentation, publicJWK: publicJWK)
    }

    public var pkcs8: Data {
        privateKey.derRepresentation
    }

    public var rawRepresentation: Data {
        privateKey.rawRepresentation
    }

    public var publicJWK: [String: String] {
        // The public key's raw form is the uncompressed point without the
        // 0x04 prefix: 32 bytes of x followed by 32 bytes of y.
        let raw = privateKey.publicKey.rawRepresentation
        return [
            "kty": "EC",
            "crv": "P-256",
            "x": OAuthBase64URL.encode(raw.prefix(32)),
            "y": OAuthBase64URL.encode(raw.suffix(32)),
        ]
    }

    public func sign(_ data: Data) throws -> Data {
        try privateKey.signature(for: data).rawRepresentation
    }
}
#endif

// MARK: - Nonces and signed requests

/// The most recent `DPoP-Nonce` each server handed back, keyed by origin.
/// An authorization server and a PDS issue nonces independently, and a
/// proof carrying a stale or foreign nonce is rejected with
/// `use_dpop_nonce`, so remembering the last one per origin turns the
/// retry into the exception rather than the rule.
public actor DPoPNonceStore {
    private var nonces: [String: String] = [:]

    public init() {}

    public func nonce(for origin: String) -> String? {
        nonces[origin]
    }

    public func set(_ nonce: String?, for origin: String) {
        if let nonce, !nonce.isEmpty {
            nonces[origin] = nonce
        } else {
            nonces.removeValue(forKey: origin)
        }
    }

    public func clear() {
        nonces.removeAll()
    }
}

/// One HTTP exchange carrying a DPoP proof, with the single retry RFC 9449
/// section 8 asks for: when the answer is a `use_dpop_nonce` error (400 from
/// an authorization server, 401 with a `WWW-Authenticate` challenge from a
/// resource server) and a `DPoP-Nonce` header arrived with it, the proof is
/// rebuilt with that nonce and the request sent once more. Every response's
/// nonce is remembered for the next request to the same origin.
enum DPoPRequestSender {
    static let proofHeader = "DPoP"
    static let nonceHeader = "DPoP-Nonce"
    static let nonceRequiredError = "use_dpop_nonce"

    static func send(
        _ request: URLRequest,
        http: HTTPClient,
        key: DPoPKey,
        nonces: DPoPNonceStore,
        accessToken: String? = nil,
        initialNonce: String? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else {
            throw DPoPError.invalidTargetURL("")
        }
        let origin = OAuthDiscovery.origin(of: url) ?? url.absoluteString
        let method = request.httpMethod ?? "GET"

        var nonce = initialNonce
        if nonce == nil {
            nonce = await nonces.nonce(for: origin)
        }
        var attempt = 0
        while true {
            var signed = request
            let proof = try DPoPProof.make(key: key, htm: method, htu: url, nonce: nonce, accessToken: accessToken)
            signed.setValue(proof, forHTTPHeaderField: proofHeader)

            let (data, response) = try await http.send(signed)
            let freshNonce = HTTPClient.header(nonceHeader, in: response)
            if let freshNonce, !freshNonce.isEmpty {
                await nonces.set(freshNonce, for: origin)
            }

            if attempt == 0, let freshNonce, !freshNonce.isEmpty, freshNonce != nonce,
                requiresNonce(status: response.statusCode, body: data, response: response) {
                nonce = freshNonce
                attempt += 1
                continue
            }
            return (data, response)
        }
    }

    /// Whether a response is the server asking for a nonce rather than a
    /// verdict on the request itself.
    static func requiresNonce(status: Int, body: Data, response: HTTPURLResponse) -> Bool {
        guard status == 400 || status == 401 else { return false }
        if let challenge = HTTPClient.header("WWW-Authenticate", in: response),
            challenge.lowercased().contains(nonceRequiredError) {
            return true
        }
        if let json = try? JSONValue.parse(body), json["error"]?.stringValue == nonceRequiredError {
            return true
        }
        return false
    }
}
