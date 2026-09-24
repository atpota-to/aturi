import Foundation

/// The granular OAuth scopes the sign-in picker offers, port of
/// `src/lib/oauth/scopes.ts` without the four permissioned-data (`space:`)
/// rows: the app has no spaces UI, so its metadata never advertises them and
/// the runtime request can never include one (`src/lib/iosApp.ts`).
public enum ScopeId: String, Codable, CaseIterable, Sendable, Hashable {
    case create
    case update
    case delete
    case blob
}

public struct GranularScope: Identifiable, Sendable, Hashable {
    public let id: ScopeId
    /// The exact token that goes on the wire. Never hand-copied elsewhere:
    /// the declared-vs-requested check at the authorization server is a
    /// byte-exact membership test against the metadata string.
    public let scope: String
    public let label: String
    public let hint: String
    /// Whether the picker ticks this row when it opens. The write-side
    /// actions have always defaulted on; the rows that shipped unticked on
    /// the web were the space scopes, which this port leaves out.
    public let defaultOn: Bool

    public init(id: ScopeId, scope: String, label: String, hint: String, defaultOn: Bool = true) {
        self.id = id
        self.scope = scope
        self.label = label
        self.hint = hint
        self.defaultOn = defaultOn
    }
}

public enum Scopes {
    /// Reads from the Bluesky AppView (profile lookups, viewer state, post
    /// threads) go through the user's PDS, which requires an explicit `rpc:`
    /// grant before it proxies the call with a user-identifying service-auth
    /// token. `lxm` must be a literal `*` or a full NSID (prefix wildcards are
    /// dropped during scope normalization) and the `#` in the audience DID
    /// fragment must be URL-encoded as `%23`. Read-only and core to the
    /// explorer working at all, so it is part of the base scope rather than
    /// a picker row.
    public static let appViewRPCScope = "rpc:*?aud=did:web:api.bsky.app%23bsky_appview"

    /// `BASE_SCOPE`: what every sign-in asks for regardless of the picker.
    public static let baseScope = ["atproto", appViewRPCScope].joined(separator: " ")

    /// `GRANULAR_SCOPES` minus the space rows, in picker order.
    public static let granular: [GranularScope] = [
        GranularScope(
            id: .create,
            scope: "repo:*?action=create",
            label: "Create",
            hint: "Add records to your repo."
        ),
        GranularScope(
            id: .update,
            scope: "repo:*?action=update",
            label: "Update",
            hint: "Change records you already have."
        ),
        GranularScope(
            id: .delete,
            scope: "repo:*?action=delete",
            label: "Delete",
            hint: "Delete records from your repo."
        ),
        GranularScope(
            id: .blob,
            scope: "blob:*/*",
            label: "Upload",
            hint: "Attach images and other media."
        ),
    ]

    /// `IOS_METADATA_SCOPE`: the superset string baked into
    /// `/oauth-client-metadata-ios.json`. Per the atproto PAR rules the
    /// runtime-requested scope must be a subset of this, so it is the union
    /// of every granular scope above. `src/lib/__tests__/iosApp.test.ts`
    /// pins the same literal on the web side.
    public static let metadataScope = ([baseScope] + granular.map(\.scope)).joined(separator: " ")

    /// Every granular id. Nothing should select this as a default without
    /// checking `defaultOn`; `defaultScopeIds` is the "everything we ask for
    /// unprompted" set.
    public static let allScopeIds: Set<ScopeId> = Set(granular.map(\.id))

    /// What the picker ticks when it opens.
    public static let defaultScopeIds: Set<ScopeId> = Set(granular.filter(\.defaultOn).map(\.id))

    /// Build the runtime scope string from a set of selected granular ids.
    /// Order follows the table, not the selection, so the result is stable
    /// and every token is one the metadata declares.
    public static func buildScopeString(_ selected: Set<ScopeId>) -> String {
        let chosen = granular.filter { selected.contains($0.id) }.map(\.scope)
        return ([baseScope] + chosen).joined(separator: " ")
    }

    /// The granular ids a granted `scope` claim carries, read back off the
    /// token rather than assumed from what was requested: an authorization
    /// server may narrow a grant, and the account screen shows what was
    /// actually granted.
    public static func grantedScopeIds(from grantedScope: String?) -> Set<ScopeId> {
        guard let grantedScope, !grantedScope.isEmpty else { return [] }
        let tokens = Set(grantedScope.split(separator: " ").map(String.init))
        return Set(granular.filter { tokens.contains($0.scope) }.map(\.id))
    }

    /// Whether a granted scope string carries the base grant at all; a token
    /// without `atproto` was not issued for an atproto client.
    public static func hasBaseScope(_ grantedScope: String?) -> Bool {
        guard let grantedScope else { return false }
        return grantedScope.split(separator: " ").contains("atproto")
    }
}
