/**
 * DID Resolution Utilities
 * Properly resolves DIDs and fetches DID documents for both did:plc and did:web identities
 * Based on ATProto specs
 */

import { upstreamFetch, logUpstreamHttpError } from './upstreamFetch';

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
    const response = await upstreamFetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!response.ok) {
      logUpstreamHttpError(`Failed to resolve handle ${handle}`, response);
      return null;
    }

    const data = await response.json();
    return data.did || null;
  } catch (error) {
    // Network-level failure after retry (timeout, connection reset) — the
    // upstream is unhealthy, not the user's input.
    // The handle is a caller-supplied value on MCP paths, and the plan's
    // posture is that no payload reaches the logs; record the failure, not
    // what was asked.
    console.error('Handle resolution failed:', error);
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

      const response = await upstreamFetch(url);
      if (!response.ok) {
        logUpstreamHttpError('PLC directory lookup failed', response);
        return null;
      }

      const didDoc = await response.json();
      return didDoc;
    } else if (did.startsWith('did:web:')) {
      // For did:web, query the domain's .well-known/did.json
      const domain = did.replace('did:web:', '');
      const url = `https://${domain}/.well-known/did.json`;

      // The host is named by the DID, so it is caller-controlled; a redirect
      // would move the fetch to an address no guard has seen.
      const response = await upstreamFetch(url, { redirect: 'error' });
      if (!response.ok) {
        logUpstreamHttpError('did:web document fetch failed', response);
        return null;
      }

      const didDoc = await response.json();
      return didDoc;
    } else {
      console.error(`Unsupported DID method: ${did.split(':')[1] ?? 'unknown'}`);
      return null;
    }
  } catch (error) {
    console.error('DID document fetch failed:', error);
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
 * Resolves a DID back to its handle by looking at the alsoKnownAs field
 */
export async function resolveDidToHandle(did: string): Promise<string | null> {
  try {
    const didDoc = await fetchDidDocument(did);
    if (!didDoc || !didDoc.alsoKnownAs || didDoc.alsoKnownAs.length === 0) {
      return null;
    }

    // alsoKnownAs contains URIs like "at://alice.bsky.social"
    for (const aka of didDoc.alsoKnownAs) {
      if (aka.startsWith('at://')) {
        const handle = aka.replace('at://', '');
        return handle;
      }
    }

    return null;
  } catch (error) {
    console.error('DID to handle resolution failed:', error);
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
    console.error('PDS endpoint resolution failed:', error);
    return null;
  }
}

