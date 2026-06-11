/**
 * Shared input-routing for the explorer search boxes. Given a free-form
 * string, returns the explorer path the user most likely wants to land
 * on. Recognises at:// URIs, PDS host URLs / bare PDS hostnames, and
 * falls back to treating the input as a handle/DID for repo lookup.
 */

import { encodeRepo } from './urls';
import { pdsHostname } from './pdsServer';
import { matchSupportedUrl } from '../reverseParsers';
import type { ParsedURI } from '../uriParser';

/**
 * Turn a reverse-parsed waypoint URL (bsky.app post, pdsls record, …) into
 * the explorer path that shows the same record. Drills down as far as the
 * parsed components allow: repo → collection → rkey.
 */
function explorePathFromParsed(parsed: ParsedURI): string {
  const repo = encodeRepo(parsed.handle);
  if (parsed.collection && parsed.rkey) {
    return `/explore/${repo}/${parsed.collection}/${encodeURIComponent(parsed.rkey)}`;
  }
  if (parsed.collection) {
    return `/explore/${repo}/${parsed.collection}`;
  }
  return `/explore/${repo}`;
}

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

  // 2. Explicit URL. Anything with a protocol is a URL, not a handle.
  if (/^https?:\/\//i.test(v)) {
    // 2a. Known waypoint apps (bsky.app, pdsls.dev, …) — reverse-parse the
    //     URL back into repo/collection/rkey and drill into that record.
    try {
      const match = matchSupportedUrl(new URL(v));
      if (match) return explorePathFromParsed(match.parsed);
    } catch {
      // Not a parseable URL — fall through to PDS host handling.
    }

    // 2b. Otherwise treat it as a PDS host. Path / query / fragment are
    //     stripped down to the host so users can paste a `/xrpc/...` URL
    //     and still land on the right page.
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
