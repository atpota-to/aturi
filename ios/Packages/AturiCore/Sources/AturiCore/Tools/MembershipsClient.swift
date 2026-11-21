import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The lists and verifications tool's requests, port of
/// `src/lib/tools/membershipsClient.ts`. What they mean is in `Memberships`.
///
/// Three services, each for the one thing it holds:
///
///   - Constellation, for which records anywhere point at the account.
///   - Slingshot, for what each of those records says.
///   - The public AppView, for what a list is called and how big it is, who
///     an issuer is, and which verifications Bluesky itself accepts.
public struct MembershipsClient: Sendable {
    public struct Account: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var displayName: String?
        public var avatar: String?
        /// False when Bluesky's AppView has no profile for the account.
        public var onBluesky: Bool
        /// Bluesky shows the account as verified.
        public var verified: Bool
        /// Bluesky lets the account verify others.
        public var trustedVerifier: Bool
        /// The verifications the AppView considers, and whether each still holds.
        public var considered: [Memberships.Considered]

        public init(
            did: String,
            handle: String?,
            displayName: String?,
            avatar: String?,
            onBluesky: Bool,
            verified: Bool,
            trustedVerifier: Bool,
            considered: [Memberships.Considered]
        ) {
            self.did = did
            self.handle = handle
            self.displayName = displayName
            self.avatar = avatar
            self.onBluesky = onBluesky
            self.verified = verified
            self.trustedVerifier = trustedVerifier
            self.considered = considered
        }
    }

    public struct ListPage: Hashable, Sendable {
        public var items: [Memberships.Membership]
        /// Where the next page starts. Nil at the end.
        public var cursor: String?
        /// Every list item that names the account, across all pages.
        public var total: Int?

        public init(items: [Memberships.Membership], cursor: String?, total: Int?) {
            self.items = items
            self.cursor = cursor
            self.total = total
        }
    }

    public struct VerificationList: Hashable, Sendable {
        public var items: [Memberships.Verification]
        /// How many verification records name the account. The rows
        /// themselves when they all fit on one page, since Constellation's
        /// own total counts a few records it no longer returns; its total
        /// only when there are more.
        public var total: Int

        public init(items: [Memberships.Verification], total: Int) {
            self.items = items
            self.total = total
        }
    }

    /// A page of Constellation's backlinks with the count of every matching
    /// record, which `ConstellationClient`'s page leaves out.
    struct CountedPage: Hashable, Sendable {
        var records: [BacklinkRecord]
        var cursor: String?
        var total: Int?
    }

    /// Lists described at once. Each is its own AppView request.
    static let listConcurrency = 5

    private let http: HTTPClient
    private let labels: LabelsClient
    private let appView: AppViewClient
    private let slingshot: SlingshotClient
    private let constellation: URL

    public init(
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        constellation: URL = Endpoints.constellation
    ) {
        self.http = http
        labels = LabelsClient(http: http, resolver: resolver)
        appView = AppViewClient(client: http)
        slingshot = SlingshotClient(http: http)
        self.constellation = constellation
    }

    private static func cleanHandle(_ handle: String?) -> String? {
        guard let handle, !handle.isEmpty, handle != "handle.invalid" else { return nil }
        return handle
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    /// Who the account is. The AppView's profile carries its verification
    /// state; an account with no Bluesky profile can still be on lists, so
    /// it falls back to the bare identity rather than failing.
    public func loadAccount(_ actor: String) async throws -> Account {
        guard let did = await labels.resolveActor(actor) else {
            throw AccountCheckError("\(actor) does not resolve to an account. Check the spelling, or use its DID.")
        }
        try Task.checkCancellation()
        guard let profile = await appView.getProfile(did) else {
            try Task.checkCancellation()
            let doc = await slingshot.resolveMiniDoc(did)
            return Account(
                did: did,
                handle: Self.cleanHandle(doc?.handle),
                displayName: nil,
                avatar: nil,
                onBluesky: false,
                verified: false,
                trustedVerifier: false,
                considered: []
            )
        }
        let state = profile.verification
        let considered = (state?.verifications ?? []).compactMap { entry -> Memberships.Considered? in
            entry.uri.isEmpty ? nil : Memberships.Considered(uri: entry.uri, isValid: entry.isValid)
        }
        return Account(
            did: did,
            handle: Self.cleanHandle(profile.handle),
            displayName: Self.trimmed(profile.displayName),
            avatar: profile.avatar,
            onBluesky: true,
            verified: state?.verifiedStatus == "valid",
            trustedVerifier: state?.trustedVerifierStatus == "valid",
            considered: considered
        )
    }

    /// `blue.microcosm.links.getBacklinks`, as `getBacklinks` asks it, read
    /// with its `total`. Nil when Constellation did not answer.
    func backlinks(_ did: String, source: String, limit: Int, cursor: String?) async -> CountedPage? {
        var query = [("subject", did), ("source", source), ("limit", String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        let url = makeURL(constellation, path: "/xrpc/blue.microcosm.links.getBacklinks", query: query)
        guard let body = try? await http.getJSONValue(from: url), body.objectValue != nil else { return nil }
        let rows = body["records"]?.arrayValue ?? body["linking_records"]?.arrayValue ?? []
        let records = rows.compactMap { row -> BacklinkRecord? in
            guard let did = row["did"]?.stringValue,
                let collection = row["collection"]?.stringValue,
                let rkey = row["rkey"]?.stringValue
            else { return nil }
            return BacklinkRecord(did: did, collection: collection, rkey: rkey)
        }
        let next = body["cursor"]?.stringValue ?? ""
        return CountedPage(records: records, cursor: next.isEmpty ? nil : next, total: body["total"]?.intValue)
    }

    static func listInfo(_ uri: String, _ page: BskyListPage?) -> Memberships.ListInfo? {
        guard let list = page?.list, let creator = list.creator, !creator.did.isEmpty else { return nil }
        return Memberships.ListInfo(
            uri: uri,
            name: trimmed(list.name) ?? "Untitled list",
            purpose: Memberships.listPurpose(list.purpose),
            description: trimmed(list.description),
            avatar: list.avatar,
            memberCount: list.listItemCount,
            creator: Memberships.ListCreator(
                did: creator.did,
                handle: cleanHandle(creator.handle),
                displayName: trimmed(creator.displayName)
            )
        )
    }

    /// One page of the lists an account is on, newest first.
    ///
    /// Three steps, because no single service holds the whole answer:
    /// Constellation says which list item records name the account,
    /// Slingshot reads each one for the list it belongs to, and the AppView
    /// describes that list. A list the AppView will not describe (deleted,
    /// or its curator suspended) comes back with `list: nil` rather than
    /// being dropped, so the count on the page still adds up.
    public func loadListPage(_ did: String, cursor: String?) async throws -> ListPage {
        guard let page = await backlinks(did, source: Memberships.listitemSource, limit: Memberships.listPageSize, cursor: cursor) else {
            try Task.checkCancellation()
            throw AccountCheckError("Constellation did not answer. Try again in a moment.")
        }
        try Task.checkCancellation()

        let records = page.records
        let items = await slingshot.getRecordsByUris(records.map { $0.atUri })
        try Task.checkCancellation()
        let listUris: [String?] = records.map { record in
            guard let list = items[record.atUri]?.value["list"]?.stringValue, list.hasPrefix("at://") else { return nil }
            return list
        }

        var unique: [String] = []
        for uri in listUris.compactMap({ $0 }) where !unique.contains(uri) {
            unique.append(uri)
        }
        let appView = appView
        let views = (try? await SlingshotClient.mapWithConcurrency(unique, limit: Self.listConcurrency) { list, _ in
            await appView.getList(list: list, limit: 1)
        }) ?? []
        try Task.checkCancellation()
        var described: [String: Memberships.ListInfo] = [:]
        for (index, uri) in unique.enumerated() where index < views.count {
            if let info = Self.listInfo(uri, views[index]) {
                described[uri] = info
            }
        }

        let memberships = records.enumerated().map { pair -> Memberships.Membership in
            let record = pair.element
            let listUri = listUris[pair.offset]
            return Memberships.Membership(
                itemUri: record.atUri,
                listUri: listUri,
                addedAt: Memberships.recordedAt(items[record.atUri]?.value["createdAt"], rkey: record.rkey),
                list: listUri.flatMap { described[$0] }
            )
        }
        return ListPage(items: memberships, cursor: page.cursor, total: page.total)
    }

    /// The verification records that name an account, with each issuer's
    /// standing. `considered` is the AppView's own list for the account,
    /// which decides whether a trusted issuer's record still holds.
    public func loadVerifications(_ did: String, considered: [Memberships.Considered]) async throws -> VerificationList {
        guard let page = await backlinks(did, source: Memberships.verificationSource, limit: Memberships.verificationLimit, cursor: nil) else {
            try Task.checkCancellation()
            throw AccountCheckError("Constellation did not answer. Try again in a moment.")
        }
        let records = page.records
        if records.isEmpty {
            return VerificationList(items: [], total: 0)
        }

        let slingshot = slingshot
        let appView = appView
        async let fetchedValues = slingshot.getRecordsByUris(records.map { $0.atUri })
        async let fetchedIssuers = appView.getProfilesResult(records.map { $0.did })
        let values = await fetchedValues
        let issuerResult = await fetchedIssuers
        let issuers = issuerResult.profiles
        try Task.checkCancellation()

        let items = records.map { record -> Memberships.Verification in
            let uri = record.atUri
            let value = values[uri]?.value
            let profile = issuers[record.did]
            let issuerTrusted = profile?.verification?.trustedVerifierStatus == "valid"
            return Memberships.Verification(
                uri: uri,
                issuer: Memberships.Issuer(
                    did: record.did,
                    handle: Self.cleanHandle(profile?.handle),
                    displayName: Self.trimmed(profile?.displayName),
                    avatar: profile?.avatar
                ),
                issuerTrusted: issuerTrusted,
                displayName: value?["displayName"]?.stringValue,
                handle: value?["handle"]?.stringValue,
                createdAt: Memberships.recordedAt(value?["createdAt"], rkey: record.rkey),
                standing: Memberships.verificationStanding(uri, issuerTrusted: issuerTrusted, appview: considered)
            )
        }
        let total: Int
        if page.cursor != nil, let counted = page.total {
            total = max(counted, items.count)
        } else {
            total = items.count
        }
        return VerificationList(items: Memberships.sortVerifications(items), total: total)
    }
}
