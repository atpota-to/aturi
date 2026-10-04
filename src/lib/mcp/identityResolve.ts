/**
 * SSRF-safe identity resolution for MCP tools.
 *
 * The shared resolveIdentifier() fetches the PDS endpoint declared in a DID
 * document, and resolves did:web by fetching an attacker-named host, before
 * any guard can see the address. Those documents are permissionless: a DID
 * anyone can mint may declare its PDS as http://169.254.169.254 or its
 * did:web host as 127.0.0.1. MCP inputs are attacker-controlled, so this
 * resolver guards every host it derives from input BEFORE fetching it:
 *
 *   - handle → DID goes through resolveHandle, which only ever talks to the
 *     hard-coded public AppView and bsky.social.
 *   - did:plc documents come from plc.directory (hard-coded).
 *   - did:web hosts are guarded, then fetched.
 *   - the PDS endpoint read out of the document is guarded before it is
 *     returned, so every downstream PDS call in the repo/lexicon tools hits
 *     an address that has already cleared the guard.
 *
 * Handle and services come from the document itself, so no describeRepo call
 * against the untrusted endpoint is needed to resolve identity.
 */

import { resolveHandle } from '@/utils/atproto/identity';
import { getPlcDocument } from '@/utils/atproto/plc';
import { fetchDidDocument } from '@/utils/didResolver';
import { McpToolError } from '@/lib/mcp/errors';
import { assertPublicServiceBase } from '@/lib/mcp/guard';

export type DidService = { id: string; type: string; serviceEndpoint: string };

export type GuardedIdentity = {
  did: string;
  handle: string | null;
  /** Origin-normalized PDS endpoint, already cleared by the SSRF guard. */
  pds: string;
  alsoKnownAs: string[];
  services: DidService[];
};

/**
 * The URL a did:web document will actually be fetched from.
 *
 * Guarding a host derived by a different rule than the fetcher uses is worse
 * than not guarding at all: it reports safety about an address nobody will
 * contact. fetchDidDocument() builds `https://<everything after did:web:>/
 * .well-known/did.json`, so this reproduces that string exactly and lets the
 * guard read its host. A DID whose remainder carries userinfo
 * (`did:web:example.com:@127.0.0.1`) therefore presents 127.0.0.1 to the
 * guard, which is the host that would really be dialled.
 */
function didWebFetchUrl(did: string): string {
  return `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
}

function handleFromAka(alsoKnownAs: string[] | undefined): string | null {
  for (const aka of alsoKnownAs ?? []) {
    if (aka.startsWith('at://')) return aka.slice('at://'.length);
  }
  return null;
}

function pdsFromServices(services: DidService[]): string | null {
  const pds =
    services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint ||
    services.find((s) => s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint ||
    null;
  return pds;
}

/**
 * Resolve a handle, DID, or at:// URI to a guarded identity bundle. Throws
 * McpToolError on any failure; the returned `pds` is safe to fetch.
 */
export async function resolveGuardedIdentity(identifier: string): Promise<GuardedIdentity> {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) {
    throw new McpToolError('missing_parameter', 'Empty identifier');
  }

  // Pull the repo segment out of an at:// URI; strip the presentation-only @.
  let target = trimmed;
  if (target.startsWith('at://')) {
    const m = target.match(/^at:\/\/([^/]+)/);
    if (m) target = m[1];
  }
  target = target.replace(/^@/, '');

  let did: string;
  if (target.startsWith('did:')) {
    did = target;
  } else {
    const resolved = await resolveHandle(target);
    if (!resolved) {
      throw new McpToolError(
        'not_found',
        `Could not resolve "${trimmed}" to an atproto identity`,
        'Check the spelling. Handles resolve via DNS or their PDS; a freshly created handle can take a minute to propagate.',
      );
    }
    did = resolved;
  }

  let alsoKnownAs: string[] = [];
  let services: DidService[] = [];

  if (did.startsWith('did:plc:')) {
    const doc = await getPlcDocument(did);
    alsoKnownAs = doc.alsoKnownAs ?? [];
    services = (doc.service ?? []) as DidService[];
  } else if (did.startsWith('did:web:')) {
    // Guard the exact URL the document will be fetched from, before fetching
    // it — this is the loopback/link-local vector (did:web:127.0.0.1).
    await assertPublicServiceBase(didWebFetchUrl(did), 'The did:web host');
    const doc = await fetchDidDocument(did);
    if (!doc) {
      throw new McpToolError('not_found', `Could not fetch the did:web document for ${did}`);
    }
    alsoKnownAs = doc.alsoKnownAs ?? [];
    services = (doc.service ?? []) as DidService[];
  } else {
    throw new McpToolError(
      'invalid_parameter',
      `Unsupported DID method: ${did}`,
      'Only did:plc and did:web identities are supported.',
    );
  }

  const rawPds = pdsFromServices(services);
  if (!rawPds) {
    throw new McpToolError(
      'not_found',
      `${did} resolved, but its DID document declares no PDS endpoint`,
      'The account may be deactivated or not fully provisioned.',
    );
  }
  // Guard the PDS host read out of the (attacker-influenceable) document
  // before returning it; every downstream tool trusts this value.
  const pds = await assertPublicServiceBase(rawPds, 'The resolved PDS endpoint');

  return { did, handle: handleFromAka(alsoKnownAs), pds, alsoKnownAs, services };
}
