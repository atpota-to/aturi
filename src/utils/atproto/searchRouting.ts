/**
 * Shared input-routing for the explorer search boxes. Given a free-form
 * string, returns the explorer path the user most likely wants to land
 * on. Recognises at:// URIs, PDS host URLs / bare PDS hostnames, and
 * falls back to treating the input as a handle/DID for repo lookup.
 */

import { encodeRepo, explorePathFromAtUri, spaceExplorePathFromSegments } from './urls';
import { SPACE_MARKER } from './spaceUri';
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
 * `URL.pathname` keeps percent-escapes, and a space key or record key may
 * legitimately contain a colon that `spaceExplorePath` escaped on the way out.
 * Decode before validating so a link we produced round-trips. Malformed
 * escapes are left alone; the validators reject them.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Aturi's own links (the main app's `/profile/...` shapes and the explorer's
 * `/explore/...` shapes) route straight back into the explorer. Pasting an
 * `aturi.to` URL should land on the same record rather than being treated as
 * a PDS host, so we recognise our own domain explicitly.
 */
function explorePathFromAturiUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'aturi.to') return null;
  const parts = url.pathname.split('/').filter(Boolean);

  // `/explore/<id>[/<collection>[/<rkey>]]` — already an explorer path.
  if (parts[0] === 'explore') {
    // `/explore/<authority>/space/...` is a permissioned address with a
    // different path depth. Rebuilding it through the repo/collection/rkey
    // destructure below would truncate it to the space type.
    if (parts[2] === SPACE_MARKER) {
      return spaceExplorePathFromSegments(parts.slice(1).map(decodeSegment));
    }
    const [, id, collection, rkey] = parts;
    if (!id) return null;
    const repo = encodeRepo(id);
    if (collection && rkey) {
      return `/explore/${repo}/${collection}/${encodeURIComponent(rkey)}`;
    }
    if (collection) return `/explore/${repo}/${collection}`;
    return `/explore/${repo}`;
  }

  // `/profile/<id>[/(post|lists)/<rkey>]` or `/profile/<id>/<nsid>/<rkey>`.
  if (parts[0] === 'profile') {
    const id = parts[1];
    if (!id) return null;
    const repo = encodeRepo(id);
    const seg = parts[2];
    const rkey = parts[3];
    if (seg && rkey) {
      if (seg === 'post') {
        return `/explore/${repo}/app.bsky.feed.post/${encodeURIComponent(rkey)}`;
      }
      if (seg === 'lists' || seg === 'list') {
        return `/explore/${repo}/app.bsky.graph.list/${encodeURIComponent(rkey)}`;
      }
      // Generic record route: the collection NSID sits in the path verbatim.
      return `/explore/${repo}/${seg}/${encodeURIComponent(rkey)}`;
    }
    return `/explore/${repo}`;
  }

  return null;
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

/**
 * A routing decision plus how confident it is. `kind: 'pds-guess'` marks the
 * one low-confidence branch: an http(s) URL we couldn't reverse-parse, where
 * treating the host as a PDS is a guess rather than a match. That's the branch
 * `resolveSearchPathAsync` upgrades by asking the page for its AT Tags.
 */
export type SearchTarget =
  | { kind: 'match'; path: string }
  | { kind: 'pds-guess'; path: string; url: string };

export function resolveSearchTarget(rawInput: string): SearchTarget | null {
  const v = rawInput.trim();
  if (!v) return null;

  // 1. at:// URIs — drill down as far as the URI allows. `explorePathFromAtUri`
  //    already walks the same repo → collection → rkey ladder, and it is the
  //    only place that knows the permissioned-space grammar, so routing goes
  //    through it rather than re-deriving the ladder here.
  if (v.startsWith('at://')) {
    const path = explorePathFromAtUri(v);
    return path ? match(path) : null;
  }

  // 2. Explicit URL. Anything with a protocol is a URL, not a handle.
  if (/^https?:\/\//i.test(v)) {
    // 2a. Known waypoint apps (bsky.app, pdsls.dev, …) plus Aturi's own
    //     links — reverse-parse the URL back into repo/collection/rkey and
    //     drill into that record.
    try {
      const url = new URL(v);
      const own = explorePathFromAturiUrl(url);
      if (own) return match(own);
      const found = matchSupportedUrl(url);
      if (found) return match(explorePathFromParsed(found.parsed));
    } catch {
      // Not a parseable URL — fall through to PDS host handling.
    }

    // 2b. Otherwise treat it as a PDS host. Path / query / fragment are
    //     stripped down to the host so users can paste a `/xrpc/...` URL
    //     and still land on the right page. This is a guess, not a match —
    //     the async resolver gets a chance to beat it with the page's own
    //     AT Tags before we send anyone to a PDS page that may not exist.
    const host = pdsHostname(v);
    if (host) {
      return { kind: 'pds-guess', path: `/explore/pds/${encodeURIComponent(host)}`, url: v };
    }
    return null;
  }

  // 3. Bare `pds.<domain>` shortcut — `pds.atpota.to` etc.
  if (looksLikeBarePdsHostname(v)) {
    return match(`/explore/pds/${encodeURIComponent(v)}`);
  }

  // 4. Default: treat as handle or DID.
  return match(`/explore/${encodeRepo(v)}`);
}

function match(path: string): SearchTarget {
  return { kind: 'match', path };
}

/**
 * Synchronous routing — unchanged behaviour, used where a network round trip
 * isn't wanted (or as the immediate fallback if AT Tags discovery fails).
 */
export function resolveSearchPath(rawInput: string): string | null {
  return resolveSearchTarget(rawInput)?.path ?? null;
}

/**
 * Routing with AT Tags discovery. Identical to {@link resolveSearchPath} for
 * everything it already understands; the difference is the unrecognized-URL
 * case, where instead of blindly treating the host as a PDS we ask the page
 * what atproto records it references (the AT Tags proposal) and route to the
 * canonical one.
 *
 * So pasting a link to someone's standard.site blog post, or any other page
 * that declares `at:canonical`, lands on that record in the explorer rather
 * than on a PDS page for a host that isn't a PDS.
 *
 * Never throws and never blocks indefinitely: any failure (offline, timeout,
 * no tags, unparseable) falls back to the synchronous guess.
 */
export async function resolveSearchPathAsync(
  rawInput: string,
  opts?: { signal?: AbortSignal },
): Promise<string | null> {
  const target = resolveSearchTarget(rawInput);
  if (!target) return null;
  if (target.kind !== 'pds-guess') return target.path;

  try {
    const endpoint = `/api/at-tags?url=${encodeURIComponent(target.url)}`;
    const res = await fetch(endpoint, { signal: opts?.signal });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; primary?: string | null };
      if (data?.ok && data.primary) {
        const path = explorePathFromAtUri(data.primary);
        if (path) return path;
      }
    }
  } catch {
    /* offline, aborted, or malformed — fall through to the guess */
  }

  return target.path;
}
