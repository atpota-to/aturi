import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// What createRecord and putRecord return: the record's new address and
/// content hash.
public struct PDSWriteResult: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var validationStatus: String?

    public init(uri: String, cid: String, validationStatus: String? = nil) {
        self.uri = uri
        self.cid = cid
        self.validationStatus = validationStatus
    }
}

/// Repo writes and reads against the signed-in account's PDS, each carrying
/// `Authorization: DPoP <token>` and a proof bound to the token (`ath`) and
/// to the server's nonce. Mirrors what the web does through the
/// `@atproto/api` Agent the OAuth session hands it, on the repo methods the
/// app needs (the four record calls plus `applyWrites` for bulk deletes),
/// one AppView read proxied through the PDS, and the preferences record
/// helpers from `src/utils/atproto/preferencesPds.ts`.
///
/// Redirects are refused: the PDS came from a DID document, and following a
/// redirect would hand a bearer credential to whatever host it named.
public struct AuthenticatedPDS: Sendable {
    public static let preferencesCollection = "to.aturi.actor.preferences"
    public static let preferencesRkey = "self"
    /// com.atproto.repo.applyWrites caps a batch at 200 operations (the
    /// lexicon's maxLength), so a larger selection is split into chunks.
    public static let applyWritesMax = 200
    /// The `atproto-proxy` value that makes the PDS forward an `app.bsky.*`
    /// call to the Bluesky AppView with a service-auth token naming the
    /// signed-in account. Without it the PDS still proxies, but anonymously,
    /// and the AppView leaves the `viewer` block empty.
    public static let appViewProxy = "did:web:api.bsky.app#bsky_appview"

    public let session: OAuthSession
    private let key: DPoPKey
    private let http: HTTPClient
    private let nonces: DPoPNonceStore

    public init(
        session: OAuthSession,
        key: DPoPKey,
        http: HTTPClient = .shared,
        nonces: DPoPNonceStore = DPoPNonceStore()
    ) {
        self.session = session
        self.key = key
        self.http = http
        self.nonces = nonces
    }

    // MARK: Repo methods

    /// com.atproto.repo.getRecord. `repo` defaults to the session's own DID.
    public func getRecord(collection: String, rkey: String, repo: String? = nil, cid: String? = nil) async throws -> AtRecord {
        var query = [("repo", repo ?? session.did), ("collection", collection), ("rkey", rkey)]
        if let cid, !cid.isEmpty {
            query.append(("cid", cid))
        }
        let data = try await send(method: "GET", nsid: "com.atproto.repo.getRecord", query: query, body: nil)
        return try JSONDecoder().decode(AtRecord.self, from: data)
    }

    /// com.atproto.repo.createRecord. Without an `rkey` the PDS mints a TID.
    public func createRecord(
        collection: String,
        record: JSONValue,
        rkey: String? = nil,
        validate: Bool? = nil
    ) async throws -> PDSWriteResult {
        var body: [String: JSONValue] = [
            "repo": .string(session.did),
            "collection": .string(collection),
            "record": Self.stamped(record, collection: collection),
        ]
        if let rkey, !rkey.isEmpty {
            body["rkey"] = .string(rkey)
        }
        if let validate {
            body["validate"] = .bool(validate)
        }
        let data = try await send(method: "POST", nsid: "com.atproto.repo.createRecord", query: [], body: .object(body))
        return try JSONDecoder().decode(PDSWriteResult.self, from: data)
    }

    /// com.atproto.repo.putRecord: create or replace at a known rkey.
    public func putRecord(
        collection: String,
        rkey: String,
        record: JSONValue,
        validate: Bool? = nil,
        swapRecord: String? = nil
    ) async throws -> PDSWriteResult {
        var body: [String: JSONValue] = [
            "repo": .string(session.did),
            "collection": .string(collection),
            "rkey": .string(rkey),
            "record": Self.stamped(record, collection: collection),
        ]
        if let validate {
            body["validate"] = .bool(validate)
        }
        if let swapRecord {
            body["swapRecord"] = .string(swapRecord)
        }
        let data = try await send(method: "POST", nsid: "com.atproto.repo.putRecord", query: [], body: .object(body))
        return try JSONDecoder().decode(PDSWriteResult.self, from: data)
    }

    /// com.atproto.repo.deleteRecord. Deleting a record that is already gone
    /// succeeds on the PDS, so this does too.
    public func deleteRecord(collection: String, rkey: String, swapRecord: String? = nil) async throws {
        var body: [String: JSONValue] = [
            "repo": .string(session.did),
            "collection": .string(collection),
            "rkey": .string(rkey),
        ]
        if let swapRecord {
            body["swapRecord"] = .string(swapRecord)
        }
        _ = try await send(method: "POST", nsid: "com.atproto.repo.deleteRecord", query: [], body: .object(body))
    }

    /// com.atproto.repo.applyWrites with one `#delete` per rkey: the whole
    /// batch lands as one atomic commit, or none of it does. At most
    /// `applyWritesMax` rkeys per call; the caller chunks a larger set.
    public func applyWrites(deletes rkeys: [String], collection: String) async throws {
        precondition(rkeys.count <= Self.applyWritesMax, "applyWrites batch exceeds the lexicon's maxLength")
        guard !rkeys.isEmpty else { return }
        let writes: [JSONValue] = rkeys.map { rkey in
            .object([
                "$type": .string("com.atproto.repo.applyWrites#delete"),
                "collection": .string(collection),
                "rkey": .string(rkey),
            ])
        }
        let body: [String: JSONValue] = [
            "repo": .string(session.did),
            "writes": .array(writes),
        ]
        _ = try await send(method: "POST", nsid: "com.atproto.repo.applyWrites", query: [], body: .object(body))
    }

    // MARK: AppView through the PDS

    /// `app.bsky.actor.getProfile` as the signed-in account sees it, with
    /// the `viewer` and `knownFollowers` blocks the public AppView omits.
    /// Port of `getProfileWithViewer`: the call goes to the PDS, which
    /// proxies it to the AppView under the account's service auth because
    /// of the `atproto-proxy` header. Nil when the AppView has no profile
    /// for the actor (an account it does not index).
    public func getProfileWithViewer(_ actor: String) async throws -> BskyProfile? {
        guard !actor.isEmpty else { return nil }
        let data = try await send(
            method: "GET",
            nsid: "app.bsky.actor.getProfile",
            query: [("actor", actor)],
            body: nil,
            headers: ["atproto-proxy": Self.appViewProxy]
        )
        return BskyProfile(json: try JSONValue.parse(data))
    }

    // MARK: Preferences record

    /// The `to.aturi.actor.preferences/self` record's value, or nil when it
    /// has not been written yet. Only `RecordNotFound` counts as missing:
    /// the caller writes local preferences to the PDS on a nil, so a
    /// transient 400 or rate limit misread as "missing" would overwrite the
    /// user's saved preferences (the same rule as `readPreferencesFromPds`).
    public func readPreferencesRecord() async throws -> JSONValue? {
        do {
            let record = try await getRecord(collection: Self.preferencesCollection, rkey: Self.preferencesRkey)
            return record.value
        } catch let error as HTTPError where Self.isRecordNotFound(error) {
            return nil
        }
    }

    /// Replace the preferences record. The app builds the value with the
    /// web's field names (and a fresh `updatedAt`); this only guarantees the
    /// `$type`.
    public func writePreferencesRecord(_ value: JSONValue) async throws -> PDSWriteResult {
        try await putRecord(collection: Self.preferencesCollection, rkey: Self.preferencesRkey, record: value)
    }

    /// The PDS answers `RecordNotFound` ("Could not locate record") when
    /// the record simply does not exist.
    public static func isRecordNotFound(_ error: HTTPError) -> Bool {
        let body = error.body
        if let json = try? JSONValue.parse(Data(body.utf8)) {
            if json["error"]?.stringValue?.lowercased() == "recordnotfound" { return true }
            if let message = json["message"]?.stringValue, message.lowercased().contains("could not locate record") {
                return true
            }
        }
        let lowered = body.lowercased()
        return lowered.contains("recordnotfound") || lowered.contains("could not locate record")
    }

    /// Whether the PDS rejected the credential itself (expired or revoked
    /// token), which is the cue to refresh the session and try again rather
    /// than report the operation as failed.
    public static func isAuthenticationError(_ error: HTTPError) -> Bool {
        if error.status == 401 { return true }
        guard error.status == 400, let json = try? JSONValue.parse(Data(error.body.utf8)),
            let name = json["error"]?.stringValue
        else {
            return false
        }
        return name == "ExpiredToken" || name == "InvalidToken"
    }

    // MARK: Plumbing

    /// A record written under a collection carries that collection as its
    /// `$type`; the PDS sets it when absent and rejects a different one.
    private static func stamped(_ record: JSONValue, collection: String) -> JSONValue {
        guard var object = record.objectValue else { return record }
        if object["$type"] == nil {
            object["$type"] = .string(collection)
        }
        return .object(object)
    }

    /// One XRPC call with the DPoP header pair, the single nonce retry, a
    /// refused redirect, and `HTTPError` for any non-2xx so callers see the
    /// same error shape `PDSClient` produces.
    private func send(
        method: String,
        nsid: String,
        query: [(String, String)],
        body: JSONValue?,
        headers: [String: String] = [:]
    ) async throws -> Data {
        let url = makeURL(session.pds, path: "/xrpc/" + nsid, query: query)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("\(session.tokenType) \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("1", forHTTPHeaderField: URLSessionTransport.noRedirectHeader)
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body {
            request.httpBody = Data(body.compactString(sortKeys: true).utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await DPoPRequestSender.send(
            request, http: http, key: key, nonces: nonces, accessToken: session.accessToken
        )
        if (300..<400).contains(response.statusCode) {
            let location = HTTPClient.header("Location", in: response)
                .flatMap { URL(string: $0, relativeTo: url)?.absoluteURL }
            throw HTTPFailure.redirectRefused(location ?? url)
        }
        guard (200..<300).contains(response.statusCode) else {
            throw HTTPError(status: response.statusCode, body: String(decoding: data, as: UTF8.self), url: url)
        }
        return data
    }
}
