import Foundation

/// The lists and verifications tool's logic. Port of
/// `src/lib/tools/memberships.ts`.
///
/// Neither a list membership nor a verification is written in the account
/// it is about. A list is a record in its curator's repository, and each
/// member is a separate `app.bsky.graph.listitem` record beside it that
/// names the list and the member. A verification is an
/// `app.bsky.graph.verification` record in the verifier's repository that
/// names who it vouches for. So the question "what points at this
/// account?" cannot be answered from the account's own repository at all:
/// it takes an index of every repository, which is what Constellation is.
///
/// Constellation returns coordinates (`{ did, collection, rkey }`), newest
/// first. Each list item is then read for the list it names, and each list
/// is looked up on the AppView for its name, purpose and size. A
/// verification is read for what it vouched for, and its issuer looked up
/// for whether Bluesky trusts it to verify: anyone can write a verification
/// record, and only those from trusted verifiers count for anything.
///
/// Blocks are records of the same kind and are left out on purpose.
///
/// Everything here is pure. The requests are in `MembershipsClient`.
public enum Memberships {
    /// Constellation's name for "list items whose `subject` is this DID".
    public static let listitemSource = "app.bsky.graph.listitem:subject"
    /// And for "verifications whose `subject` is this DID".
    public static let verificationSource = "app.bsky.graph.verification:subject"

    /// List memberships read per page. Each one costs two lookups to describe.
    public static let listPageSize = 25
    /// Verifications read at most. Constellation's page limit, and far more
    /// than any account has that count.
    public static let verificationLimit = 100

    public enum AccountInput: Hashable, Sendable {
        case ok(actor: String)
        case invalid(reason: String)

        public var actor: String? {
            if case .ok(let actor) = self { return actor }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }
    }

    static let accountsOnly = "Lists and verifications belong to accounts. Enter a handle or a DID."

    /// A handle, a DID, an at:// URI of an account, or a profile link.
    public static func parseAccountInput(_ raw: String) -> AccountInput {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .invalid(reason: "Enter a handle or a DID.")
        }
        switch Labels.parseSubjectInput(raw) {
        case .invalid(let reason):
            return .invalid(reason: reason == Labels.notLabelled ? accountsOnly : reason)
        case .ok(let target):
            switch target {
            case .account(let actor): return .ok(actor: actor)
            case .post: return .invalid(reason: accountsOnly)
            }
        }
    }

    // MARK: - Lists

    /// What a list is for: `curate` to follow or build a feed from, `mod`
    /// to mute or block its members, `reference` when it is the member list
    /// behind a starter pack.
    public enum ListPurpose: String, Hashable, Sendable {
        case curate
        case mod
        case reference
        case other
    }

    public static func listPurpose(_ purpose: String?) -> ListPurpose {
        guard let purpose, !purpose.isEmpty else { return .other }
        if purpose.hasSuffix("#curatelist") { return .curate }
        if purpose.hasSuffix("#modlist") { return .mod }
        if purpose.hasSuffix("#referencelist") { return .reference }
        return .other
    }

    public struct ListCreator: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var displayName: String?

        public init(did: String, handle: String?, displayName: String?) {
            self.did = did
            self.handle = handle
            self.displayName = displayName
        }
    }

    public struct ListInfo: Hashable, Sendable {
        public var uri: String
        public var name: String
        public var purpose: ListPurpose
        public var description: String?
        public var avatar: String?
        public var memberCount: Int?
        public var creator: ListCreator

        public init(
            uri: String,
            name: String,
            purpose: ListPurpose,
            description: String?,
            avatar: String?,
            memberCount: Int?,
            creator: ListCreator
        ) {
            self.uri = uri
            self.name = name
            self.purpose = purpose
            self.description = description
            self.avatar = avatar
            self.memberCount = memberCount
            self.creator = creator
        }
    }

    public struct Membership: Hashable, Sendable {
        /// The list item record that puts the account on the list.
        public var itemUri: String
        /// The list it names. Nil when the item record could not be read.
        public var listUri: String?
        /// When the account was added, as an ISO timestamp.
        public var addedAt: String?
        /// Nil when the list is gone, hidden, or its curator's account is.
        public var list: ListInfo?

        public init(itemUri: String, listUri: String?, addedAt: String?, list: ListInfo?) {
            self.itemUri = itemUri
            self.listUri = listUri
            self.addedAt = addedAt
            self.list = list
        }
    }

    /// When a record was made, as `toISOString()` writes it: its own
    /// `createdAt` when that is a real date, otherwise the timestamp inside
    /// its record key.
    public static func recordedAt(_ createdAt: JSONValue?, rkey: String) -> String? {
        if let text = createdAt?.stringValue, let date = Formatting.isoDate(text) {
            return Formatting.isoTimestamp(date)
        }
        return TID.date(from: rkey).map { Formatting.isoTimestamp($0) }
    }

    /// Add a page of memberships to what is already loaded, keeping one row
    /// per list. An account is occasionally added to the same list twice,
    /// and Constellation counts both records; the page should not show the
    /// list twice.
    public static func mergeMemberships(_ existing: [Membership], _ incoming: [Membership]) -> [Membership] {
        var seen = Set<String>()
        var out: [Membership] = []
        for item in existing + incoming {
            let key = item.listUri ?? item.itemUri
            if seen.contains(key) { continue }
            seen.insert(key)
            out.append(item)
        }
        return out
    }

    public struct Groups: Hashable, Sendable {
        public var curate: [Membership]
        public var mod: [Membership]
        /// Starter packs, by way of their member lists.
        public var reference: [Membership]
        /// Lists that could not be described: deleted, or their curator is gone.
        public var unavailable: [Membership]

        public init(curate: [Membership] = [], mod: [Membership] = [], reference: [Membership] = [], unavailable: [Membership] = []) {
            self.curate = curate
            self.mod = mod
            self.reference = reference
            self.unavailable = unavailable
        }
    }

    public static func groupMemberships(_ items: [Membership]) -> Groups {
        var groups = Groups()
        for item in items {
            guard let list = item.list else {
                groups.unavailable.append(item)
                continue
            }
            switch list.purpose {
            case .mod: groups.mod.append(item)
            case .reference: groups.reference.append(item)
            case .curate, .other: groups.curate.append(item)
            }
        }
        return groups
    }

    // MARK: - Verifications

    /// How much a verification record counts for on Bluesky.
    ///
    ///   `valid`      from a trusted verifier, and the AppView accepts it.
    ///   `stale`      from a trusted verifier, but the name or handle it
    ///                vouched for has changed since, so the AppView no
    ///                longer accepts it.
    ///   `unlisted`   from a trusted verifier, yet absent from the AppView's
    ///                own list for the account, so it is not being counted.
    ///                A trusted verifier's verification of itself is the
    ///                usual case.
    ///   `untrusted`  the issuer is not a trusted verifier. The record
    ///                exists and says what it says; Bluesky shows nothing
    ///                for it.
    public enum VerificationStanding: String, Hashable, Sendable {
        case valid
        case stale
        case unlisted
        case untrusted

        var rank: Int {
            switch self {
            case .valid: return 0
            case .stale: return 1
            case .unlisted: return 2
            case .untrusted: return 3
            }
        }
    }

    public struct Issuer: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var displayName: String?
        public var avatar: String?

        public init(did: String, handle: String?, displayName: String?, avatar: String?) {
            self.did = did
            self.handle = handle
            self.displayName = displayName
            self.avatar = avatar
        }
    }

    public struct Verification: Hashable, Sendable {
        /// The verification record.
        public var uri: String
        public var issuer: Issuer
        /// Whether Bluesky lets the issuer verify others.
        public var issuerTrusted: Bool
        /// The name and handle the issuer vouched for, as written at the time.
        public var displayName: String?
        public var handle: String?
        public var createdAt: String?
        public var standing: VerificationStanding

        public init(
            uri: String,
            issuer: Issuer,
            issuerTrusted: Bool,
            displayName: String?,
            handle: String?,
            createdAt: String?,
            standing: VerificationStanding
        ) {
            self.uri = uri
            self.issuer = issuer
            self.issuerTrusted = issuerTrusted
            self.displayName = displayName
            self.handle = handle
            self.createdAt = createdAt
            self.standing = standing
        }
    }

    /// One verification the AppView considers for an account, and whether
    /// it still holds.
    public struct Considered: Hashable, Sendable {
        public var uri: String
        public var isValid: Bool

        public init(uri: String, isValid: Bool) {
            self.uri = uri
            self.isValid = isValid
        }
    }

    /// Place a verification, given what the AppView says about the
    /// subject's verifications and about the issuer.
    public static func verificationStanding(_ uri: String, issuerTrusted: Bool, appview: [Considered]) -> VerificationStanding {
        if let listed = appview.first(where: { $0.uri == uri }) {
            return listed.isValid ? .valid : .stale
        }
        return issuerTrusted ? .unlisted : .untrusted
    }

    /// The ones that count first, then newest first.
    public static func sortVerifications(_ items: [Verification]) -> [Verification] {
        toolsStableSorted(items) { a, b in
            if a.standing.rank != b.standing.rank { return a.standing.rank < b.standing.rank }
            return (a.createdAt ?? "") > (b.createdAt ?? "")
        }
    }

    // MARK: - The summary

    private static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(Labels.formatCount(n)) \(n == 1 ? one : many)"
    }

    /// "is on 12 lists and has 2 verifications", for the verdict's title. A
    /// count that could not be made (nil) is left out rather than guessed
    /// at; its own section says what went wrong.
    public static func membershipSummary(lists: Int?, verifications: Int?) -> String {
        var parts: [String] = []
        if let lists {
            parts.append(lists == 0 ? "is on no lists" : "is on \(plural(lists, "list", "lists"))")
        }
        if let verifications {
            parts.append(
                verifications == 0
                    ? "has no verifications"
                    : "has \(plural(verifications, "verification", "verifications"))"
            )
        }
        return parts.isEmpty ? "could not be looked up" : parts.joined(separator: " and ")
    }
}
