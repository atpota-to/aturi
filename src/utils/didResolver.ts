/**
 * DID Resolution Utilities
 * Properly resolves DIDs and fetches DID documents for both did:plc and did:web identities
 * Based on ATProto specs
 */

export type DidDocument = {
  id: string;
  alsoKnownAs?: string[];
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }>;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
};

/**
 * Resolves a handle to a DID using the Bluesky public API
 * Supports both did:plc and did:web identities
 */
export async function resolveHandleToDid(handle: string): Promise<string | null> {
  try {
    // If it's already a DID, return it
    if (handle.startsWith('did:')) {
      return handle;
    }

    // Use the Bluesky public API for handle resolution
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!response.ok) {
      console.error(`Failed to resolve handle ${handle}: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.did || null;
  } catch (error) {
    console.error(`Error resolving handle ${handle}:`, error);
    return null;
  }
}

/**
 * Fetches a DID document for a given DID
 * Handles both did:plc (via plc.directory) and did:web (via .well-known/did.json)
 */
export async function fetchDidDocument(did: string): Promise<DidDocument | null> {
  try {
    if (did.startsWith('did:plc:')) {
      // For did:plc, query the PLC directory
      const url = `https://plc.directory/${did}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`PLC directory lookup failed: HTTP ${response.status}`);
        return null;
      }

      const didDoc = await response.json();
      return didDoc;
    } else if (did.startsWith('did:web:')) {
      // For did:web, query the domain's .well-known/did.json
      const domain = did.replace('did:web:', '');
      const url = `https://${domain}/.well-known/did.json`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`did:web document fetch failed: HTTP ${response.status}`);
        return null;
      }

      const didDoc = await response.json();
      return didDoc;
    } else {
      console.error(`Unsupported DID method: ${did}`);
      return null;
    }
  } catch (error) {
    console.error(`Failed to fetch DID document for ${did}:`, error);
    return null;
  }
}

/**
 * Extracts the PDS endpoint from a DID document
 */
export function extractPdsEndpoint(didDoc: DidDocument): string | null {
  try {
    // Look for the ATProto PDS service
    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    );

    if (pdsService && pdsService.serviceEndpoint) {
      return pdsService.serviceEndpoint;
    }

    console.warn('No PDS endpoint found in DID document');
    return null;
  } catch (error) {
    console.error('Failed to extract PDS endpoint:', error);
    return null;
  }
}

/**
 * Resolves a handle or DID to its PDS endpoint
 */
export async function resolvePdsEndpoint(
  actorHandleOrDid: string
): Promise<{ did: string; pdsEndpoint: string; didDoc: DidDocument } | null> {
  try {
    // Step 1: Resolve handle to DID if needed
    let did = actorHandleOrDid;
    if (!actorHandleOrDid.startsWith('did:')) {
      const resolvedDid = await resolveHandleToDid(actorHandleOrDid);
      if (!resolvedDid) {
        return null;
      }
      did = resolvedDid;
    }

    // Step 2: Fetch the DID document
    const didDoc = await fetchDidDocument(did);
    if (!didDoc) {
      return null;
    }

    // Step 3: Extract the PDS endpoint
    const pdsEndpoint = extractPdsEndpoint(didDoc);
    if (!pdsEndpoint) {
      return null;
    }

    return {
      did,
      pdsEndpoint,
      didDoc,
    };
  } catch (error) {
    console.error(`Failed to resolve PDS endpoint for ${actorHandleOrDid}:`, error);
    return null;
  }
}

