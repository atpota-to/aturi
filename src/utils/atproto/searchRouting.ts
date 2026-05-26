/**
 * Shared input-routing for the explorer search boxes. Given a free-form
 * string, returns the explorer path the user most likely wants to land
 * on. Recognises at:// URIs, PDS host URLs / bare PDS hostnames, and
 * falls back to treating the input as a handle/DID for repo lookup.
 */

import { encodeRepo } from './urls';
import { pdsHostname } from './pdsServer';

/**
 * Bare hostnames that begin with `pds.` are overwhelmingly atproto PDS
 * hosts (pds.atpota.to, pds.bsky.network, …). Anything else without a
 * protocol scheme is treated as a handle by default — there's no
 * reliable way to distinguish "pds-less" PDS hostnames from handles
 * without a network call.
 */
function looksLikeBarePdsHostname(input: string): boolean {
  if (input.includes('/')) return false;
  if (input.startsWith('did:') || input.startsWith('at://')) return false;
  if (!/^pds\.[^\s.]+\.[^\s.]+/i.test(input)) return false;
  return true;
}

export function resolveSearchPath(rawInput: string): string | null {
  const v = rawInput.trim();
  if (!v) return null;

  // 1. at:// URIs — drill down as far as the URI allows.
  if (v.startsWith('at://')) {
    const m = v.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
    if (m) return `/explore/${encodeRepo(m[1])}/${m[2]}/${encodeURIComponent(m[3])}`;
    const m2 = v.match(/^at:\/\/([^/]+)\/([^/?#]+)/);
    if (m2) return `/explore/${encodeRepo(m2[1])}/${m2[2]}`;
    const m3 = v.match(/^at:\/\/([^/?#]+)/);
    if (m3) return `/explore/${encodeRepo(m3[1])}`;
    return null;
  }

  // 2. Explicit URL → PDS host page. Anything with a protocol is a URL,
  //    not a handle. Path / query / fragment are stripped down to the
  //    host so users can paste a `/xrpc/...` URL and still land on the
  //    right page.
  if (/^https?:\/\//i.test(v)) {
    const host = pdsHostname(v);
    if (host) return `/explore/pds/${encodeURIComponent(host)}`;
    return null;
  }

  // 3. Bare `pds.<domain>` shortcut — `pds.atpota.to` etc.
  if (looksLikeBarePdsHostname(v)) {
    return `/explore/pds/${encodeURIComponent(v)}`;
  }

  // 4. Default: treat as handle or DID.
  return `/explore/${encodeRepo(v)}`;
}
