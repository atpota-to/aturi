import Foundation

// `SessionState` itself (`.signedOut` / `.signedIn(OAuthSession)`, with the
// `session` and `isSignedIn` accessors) is declared in OAuth/OAuthSession.swift
// next to the session it wraps. The view models only ever need the identity
// of the signed-in account, so the identity accessors live here with them
// rather than beside the token material.

extension SessionState {
    /// The signed-in account's DID, nil when nobody is signed in.
    public var did: String? {
        session?.did
    }

    /// The signed-in account's handle as the authorization server reported
    /// it. Nil when signed out, and also when the server sent no handle;
    /// `displayIdentifier` covers the second case.
    public var handle: String? {
        session?.handle
    }

    /// The PDS the signed-in account lives on.
    public var pds: URL? {
        session?.pds
    }

    /// `handle || did`: what to print for the account when a handle is not
    /// known yet, the same fallback the explorer landing uses for its
    /// "your repo" chip.
    public var displayIdentifier: String? {
        guard let session else { return nil }
        if let handle = session.handle, !handle.isEmpty { return handle }
        return session.did
    }
}
