/**
 * Resolving a space authority from its DID document.
 *
 * A space authority publishes two optional entries that a space client needs
 * before it can talk to the space at all:
 *
 *   - service `#atproto_space_host`  — where space-host requests go
 *   - verificationMethod `#atproto_space` — the key that signs space credentials
 *
 * Both are optional and both fall back to the account's ordinary atproto
 * entries (`#atproto_pds` and `#atproto`). An authority hosted on a PDS — which
 * is every simplespace authority — publishes neither, so in practice the
 * fallbacks are the common path and the dedicated entries are the exception.
 *
 * Note the space host is *not* the same thing as the audience a delegation
 * token is addressed to. That audience is always the literal
 * `{authorityDid}#atproto_space_host` whether or not the entry exists; the
 * authority derives it itself and the client never constructs it.
 */

import { fetchDidDocument, type DidDocument } from '../didResolver';
import { TTLMap } from './cache';

export type SpaceAuthority = {
  did: string;
  /** Where space-host requests go. */
  spaceHost: string;
  /**
   * True when spaceHost came from a dedicated #atproto_space_host entry
   * rather than the #atproto_pds fallback.
   */
  dedicatedHost: boolean;
  /** Which verification method signs this authority's credentials. */
  spaceKeyId: '#atproto' | '#atproto_space';
  spaceKeyMultibase: string | null;
};

const SPACE_HOST_FRAGMENT = '#atproto_space_host';
const PDS_FRAGMENT = '#atproto_pds';
const SPACE_KEY_FRAGMENT = '#atproto_space';
const SIGNING_KEY_FRAGMENT = '#atproto';

/**
 * DID documents spell entry ids either as a bare fragment (`#atproto_pds`, the
 * PLC directory's form) or fully qualified (`did:plc:…#atproto_pds`, common in
 * did:web documents). Match on the fragment either way.
 */
function hasFragment(id: string | undefined, fragment: string): boolean {
  return typeof id === 'string' && (id === fragment || id.endsWith(fragment));
}

/**
 * Resolve the space host endpoint, preferring a dedicated `#atproto_space_host`
 * service and falling back to the account's PDS. Written to mirror
 * `extractPdsEndpoint` in ../didResolver — find, truthy-check, warn, null.
 */
export function extractSpaceHost(
  didDoc: DidDocument,
): { endpoint: string | null; dedicated: boolean } {
  try {
    const dedicated = didDoc.service?.find((s) => hasFragment(s.id, SPACE_HOST_FRAGMENT));
    if (dedicated?.serviceEndpoint) {
      return { endpoint: stripTrailingSlash(dedicated.serviceEndpoint), dedicated: true };
    }

    const pds = didDoc.service?.find(
      (s) => hasFragment(s.id, PDS_FRAGMENT) || s.type === 'AtprotoPersonalDataServer',
    );
    if (pds?.serviceEndpoint) {
      return { endpoint: stripTrailingSlash(pds.serviceEndpoint), dedicated: false };
    }

    console.warn('No space host or PDS endpoint found in DID document');
    return { endpoint: null, dedicated: false };
  } catch (error) {
    console.error('Failed to extract space host:', error);
    return { endpoint: null, dedicated: false };
  }
}

/**
 * Resolve the key that verifies this authority's space credentials. The id is
 * returned alongside the key material so the UI can show whether the authority
 * publishes a dedicated space key or signs with its ordinary atproto key.
 *
 * `#atproto_space` is checked first, and the check is order-sensitive rather
 * than merely preferential: `…#atproto_space` does not end in `#atproto`, so
 * the two tests are disjoint, but the dedicated entry must still win when both
 * are published.
 */
export function extractSpaceKey(
  didDoc: DidDocument,
): { id: '#atproto' | '#atproto_space'; multibase: string | null } | null {
  try {
    const dedicated = didDoc.verificationMethod?.find((vm) =>
      hasFragment(vm.id, SPACE_KEY_FRAGMENT),
    );
    if (dedicated) {
      return { id: SPACE_KEY_FRAGMENT, multibase: dedicated.publicKeyMultibase ?? null };
    }

    const signing = didDoc.verificationMethod?.find((vm) =>
      hasFragment(vm.id, SIGNING_KEY_FRAGMENT),
    );
    if (signing) {
      return { id: SIGNING_KEY_FRAGMENT, multibase: signing.publicKeyMultibase ?? null };
    }

    console.warn('No space signing key found in DID document');
    return null;
  } catch (error) {
    console.error('Failed to extract space key:', error);
    return null;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * A resolved authority is the same shape for the whole life of a page and is
 * read on every space route, so it is cached for the same 30 minutes the
 * DID→handle cache uses. Only successes are cached: a transient PLC failure
 * should not pin an authority as unreachable.
 */
const AUTHORITY_TTL = 30 * 60_000;
const authorityCache = new TTLMap<string, SpaceAuthority>(AUTHORITY_TTL);
const authorityInflight = new Map<string, Promise<SpaceAuthority | null>>();

/**
 * Resolve a space authority DID to everything a space client needs to address
 * it. Returns null on any failure — an unresolvable DID document, a document
 * with no reachable endpoint — so callers keep their "unknown" state rather
 * than treating a lookup failure as a missing space.
 */
export async function resolveSpaceAuthority(did: string): Promise<SpaceAuthority | null> {
  if (!did || !did.startsWith('did:')) return null;

  const cached = authorityCache.get(did);
  if (cached) return cached;
  const existing = authorityInflight.get(did);
  if (existing) return existing;

  const pending = (async (): Promise<SpaceAuthority | null> => {
    const didDoc = await fetchDidDocument(did);
    if (!didDoc) return null;

    const { endpoint, dedicated } = extractSpaceHost(didDoc);
    if (!endpoint) return null;

    const key = extractSpaceKey(didDoc);
    const authority: SpaceAuthority = {
      did,
      spaceHost: endpoint,
      dedicatedHost: dedicated,
      spaceKeyId: key?.id ?? SIGNING_KEY_FRAGMENT,
      spaceKeyMultibase: key?.multibase ?? null,
    };
    authorityCache.set(did, authority);
    return authority;
  })()
    .catch(() => null)
    .finally(() => {
      authorityInflight.delete(did);
    });

  authorityInflight.set(did, pending);
  return pending;
}
