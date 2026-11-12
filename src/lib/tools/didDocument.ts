/**
 * Read a DID document from a browser, for the tools that need more of it than
 * the explorer's identity bundle carries (every service, every key, every
 * `alsoKnownAs` entry).
 *
 * did:plc documents come from plc.directory, which allows cross-origin reads.
 * A did:web document is on its own host, which often does not, so a direct
 * read that fails is retried through the same-origin /api/did-doc proxy the
 * OAuth client already uses for the same reason.
 */

import { PLC_DIRECTORY } from '@/utils/atproto/config';

export type DidDocument = {
  id?: string;
  alsoKnownAs?: string[];
  verificationMethod?: { id: string; type?: string; controller?: string; publicKeyMultibase?: string }[];
  service?: { id: string; type?: string; serviceEndpoint?: unknown }[];
};

/** Where a did:web document is served. Null for a DID that is not a did:web. */
export function didWebDocumentUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const [host, ...path] = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
  if (!host) return null;
  return path.length
    ? `https://${host}/${path.join('/')}/did.json`
    : `https://${host}/.well-known/did.json`;
}

async function readJson(res: Response): Promise<DidDocument> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DidDocument;
}

export async function fetchDidDocument(did: string, signal?: AbortSignal): Promise<DidDocument> {
  if (did.startsWith('did:plc:')) {
    return readJson(await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`, { signal }));
  }
  const url = didWebDocumentUrl(did);
  if (!url) throw new Error('Only did:plc and did:web can be resolved');
  try {
    return await readJson(await fetch(url, { signal }));
  } catch (err) {
    if (signal?.aborted) throw err;
    return readJson(await fetch(`/api/did-doc?url=${encodeURIComponent(url)}`, { signal }));
  }
}

/** The endpoint of a service in a DID document, by its fragment id (`#atproto_pds`). */
export function serviceEndpoint(doc: DidDocument | null | undefined, fragment: string): string | null {
  const service = doc?.service?.find((s) => s.id === fragment || s.id.endsWith(fragment));
  return typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint.replace(/\/$/, '') : null;
}
