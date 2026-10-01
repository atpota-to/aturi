import Foundation

// The identity half of the universal-link pipeline, split out of
// `LinkResolverModel` so the app's Shortcuts and Siri actions resolve a
// link exactly the way the preview page does, with no screen behind them.
// A pasted or shared string goes in; the account (and record) it names
// comes out as a `ResolvedLink`. The model keeps the preview card, the
// picker and auto-redirect; everything up to the `ResolvedLink` lives here.

/// What resolving a link came to.
public enum LinkResolution: Hashable, Sendable {
    /// The identity resolved. The preview, the picker and every action
    /// carry on from here.
    case resolved(ResolvedLink)
    /// The input names nothing, or names it malformed. The message is the
    /// copy the preview page shows.
    case invalid(String)
    /// The handle definitively does not resolve: the web's 404.
    case notFound(handle: String)
    /// The resolver could not be reached. Never reported as "not found": it
    /// may be a real account that could not be looked up right now.
    case unavailable(String)

    /// The preview page's copy for input `extractAtUriComponents` cannot read.
    public static let unreadableInputMessage = "That doesn't look like an Atmosphere link. Paste an at:// URI, a handle, a DID, or a link from a supported app."

    /// The pipeline the web runs once per page: `extractAtUriComponents`
    /// reads the input, `parseURI` types it, `resolveHandleStatus` decides
    /// between a real account, "no such handle" and "the resolver is down",
    /// and a DID input is shown by the handle its document names.
    ///
    /// Throws `CancellationError` when the task is cancelled between network
    /// hops, so a caller that has started a newer resolution never sees this
    /// one land.
    public static func resolve(_ input: String, identity: IdentityResolver = .shared) async throws -> LinkResolution {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = extractAtUriComponents(trimmed) else {
            return .invalid(unreadableInputMessage)
        }
        // The pages strip a presentation-only `@` before resolving.
        if components.identifier.hasPrefix("@") {
            components.identifier.removeFirst()
        }

        let parsed = parseURI(handle: components.identifier, collection: components.collection, rkey: components.rkey)
        if let error = parsed.error {
            return .invalid(error)
        }
        let type = WaypointType(rawValue: parsed.type.rawValue) ?? .unknown

        // A definitive miss is the web's 404; a resolver that is down is a
        // retry, never "not found".
        let resolution = await identity.resolveHandleStatus(parsed.handle)
        try Task.checkCancellation()
        let did: String
        switch resolution {
        case .notFound:
            return .notFound(handle: parsed.handle)
        case .unavailable:
            return .unavailable("We couldn't reach the atproto resolver to look up \"\(parsed.handle)\". This is usually temporary; try again in a moment.")
        case .did(let resolved):
            did = resolved
        }

        // `resolveDidToHandle(resolvedDid) || handle`: a DID input is shown
        // by its handle when the DID document names one.
        var handle = parsed.handle
        if parsed.handle.hasPrefix("did:") {
            handle = await identity.resolveDIDHandle(did) ?? parsed.handle
            try Task.checkCancellation()
        }

        let atUri: String
        if let collection = parsed.collection, let rkey = parsed.rkey {
            atUri = "at://\(did)/\(collection)/\(rkey)"
        } else {
            atUri = "at://\(did)"
        }
        return .resolved(ResolvedLink(
            components: components,
            parsed: parsed,
            type: type,
            did: did,
            handle: handle,
            displayName: displayName(handle: handle, did: did),
            collection: parsed.collection,
            rkey: parsed.rkey,
            atUri: atUri,
            aturiLink: generateAturiLink(AtUriComponents(identifier: handle, collection: parsed.collection, rkey: parsed.rkey))
        ))
    }
}

extension ResolvedLink {
    /// Port of `fetchRecord`: the account's PDS first, then the public
    /// AppView's getRecord proxy so a link still renders when the DID
    /// document cannot be fetched (cold caches and the like). The bundle's
    /// `pds` names whichever host answered. Nil for a link that names an
    /// account rather than a record, and when neither host has the record.
    public func fetchRecord(identity: IdentityResolver, pds: PDSClient) async -> (AtRecord, IdentityBundle)? {
        guard let collection, let rkey else { return nil }
        let claimedHandle = handle.hasPrefix("did:") ? nil : handle
        if let pdsResolution = await identity.resolvePDS(did) {
            if Task.isCancelled { return nil }
            let base = PDSServer.normalizePdsBase(pdsResolution.pdsEndpoint)
            if let record = try? await pds.getRecord(pds: base, repo: pdsResolution.did, collection: collection, rkey: rkey) {
                let recordHandle = pdsResolution.didDoc.handle ?? claimedHandle
                return (record, IdentityBundle(did: pdsResolution.did, handle: recordHandle, pds: base))
            }
        }
        if Task.isCancelled { return nil }
        let fallback = Endpoints.appView.absoluteString
        if let record = try? await pds.getRecord(pds: fallback, repo: did, collection: collection, rkey: rkey) {
            return (record, IdentityBundle(did: did, handle: claimedHandle, pds: fallback))
        }
        return nil
    }
}
