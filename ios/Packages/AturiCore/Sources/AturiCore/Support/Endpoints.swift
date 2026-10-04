import Foundation

/// Shared endpoint constants for the protocol layer. Mirrors
/// `src/utils/atproto/config.ts` and `src/utils/ufos/config.ts`; keep the two
/// in step when a host changes.
public enum Endpoints {
    public static let appView = URL(string: "https://public.api.bsky.app")!
    public static let plcDirectory = URL(string: "https://plc.directory")!
    public static let constellation = URL(string: "https://constellation.microcosm.blue")!
    public static let slingshot = URL(string: "https://slingshot.microcosm.blue")!
    public static let jetstream = URL(string: "wss://jetstream2.us-east.bsky.network/subscribe")!
    public static let handleResolverFallback = URL(string: "https://bsky.social")!

    /// Relay used as a second opinion on `com.atproto.sync.getRepoStatus`,
    /// which both a PDS and a relay implement. Asked only about repos their
    /// own PDS has already reported inactive: the PDS answers the status but
    /// drops the `rev`, while the relay still carries the head rev it last
    /// saw. Never used for record reads; those belong to the account's PDS.
    public static let relay = URL(string: "https://relay1.us-east.bsky.network")!

    public static let ufos = URL(string: "https://ufos-api.microcosm.blue")!
    public static let credBlueAPI = URL(string: "https://api.cred.blue")!
    public static let aturiBase = URL(string: "https://aturi.to")!
    public static let aturiHost = "aturi.to"
}
