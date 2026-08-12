import { matchSupportedUrl, parseAtUri } from './reverseParsers';
import type { ParsedURI } from './uriParser';
import type { WaypointType } from './waypoints.data';

/**
 * Universal links: the aturi.to URL for a record or an identity.
 *
 * A universal link is the client-agnostic address of an atproto record. Drop
 * one anywhere and the recipient lands on a preview of the record and picks
 * the client they want to open it in, instead of being pushed into whichever
 * app the sender happened to use.
 *
 * This module is the whole round trip:
 *   - `buildUniversalLink` turns anything that names a record — an AT URI, a
 *     handle, a DID, a URL from any client in the catalog — into that address.
 *   - `parseUniversalLink` turns one back into a `ParsedURI`.
 *   - `describeUniversalLink` adds the strings a share sheet or a copy button
 *     needs (a label, a `navigator.share()` payload, markdown/HTML snippets).
 *   - `buildUniversalLinkTags` emits the `<head>` tags that let *other* apps
 *     be resolved back into records — the read side of the same trip.
 *
 * Everything here is pure and synchronous. Nothing fetches.
 */

/** Where universal links point unless an `origin` says otherwise. */
export const UNIVERSAL_LINK_ORIGIN = 'https://aturi.to';

/**
 * The hosted oEmbed endpoint. Only `app.bsky.feed.post` records render, so
 * the oEmbed pointer is omitted for everything else rather than advertising a
 * URL that 404s.
 */
const OEMBED_PATH = '/api/oembed';
const OEMBED_COLLECTION = 'app.bsky.feed.post';

/** The oEmbed link `type` attribute, per the spec's discovery section. */
export const OEMBED_LINK_TYPE = 'application/json+oembed';

/**
 * Anything that names a record or an identity:
 *   - an AT URI (`at://did:plc:abc/app.bsky.feed.post/3k7`)
 *   - a bare handle or DID (`alice.bsky.social`, `@alice.bsky.social`, `did:plc:abc`)
 *   - a scheme-less AT URI (`alice.bsky.social/app.bsky.feed.post/3k7`)
 *   - a page URL from any client in the catalog, an aturi.to link included
 *   - a `ParsedURI` you already have from `parseURI` / `matchSupportedUrl`
 */
export type UniversalLinkTarget = string | ParsedURI;

export type UniversalLinkOptions = {
  /**
   * Origin to build against. Defaults to aturi.to; point it at your own
   * deployment if you run a fork. Trailing slashes are trimmed.
   */
  origin?: string;
  /**
   * DID for the target, for input that only carries a handle. Handle → DID
   * resolution is a network call, so this package never does it for you:
   * pass `resolveHandle`'s result if you want DID-stable links.
   */
  did?: string;
  /**
   * Address every link by DID instead of handle. A handle can be reassigned
   * to another identity; a DID is stable for the life of the account, so a
   * DID link never rots. Ignored when no DID is known.
   */
  preferDid?: boolean;
  /** Query parameters to append, e.g. `{ ref: 'my-app' }`. Empty values are dropped. */
  params?: Record<string, string | number | boolean | null | undefined>;
};

/** `navigator.share()`'s payload, which most native share sheets also accept. */
export type UniversalLinkSharePayload = {
  title: string;
  text: string;
  url: string;
};

/** Ready-to-paste forms of the same link. */
export type UniversalLinkSnippets = {
  url: string;
  atUri: string;
  markdown: string;
  html: string;
};

export type UniversalLink = {
  url: string;
  atUri: string;
  type: WaypointType;
  handle: string;
  did: string | null;
  collection: string | null;
  rkey: string | null;
  /** Human label for the target, e.g. `Post by @alice.bsky.social`. */
  label: string;
  share: UniversalLinkSharePayload;
  snippets: UniversalLinkSnippets;
  /** oEmbed endpoint for this link, or null for anything that isn't a post. */
  oembedUrl: string | null;
};

export type DescribeUniversalLinkOptions = UniversalLinkOptions & {
  /** Override the share sheet's title. Defaults to the label. */
  title?: string;
  /** Override the share sheet's text. Defaults to the label. */
  text?: string;
};

export type UniversalLinkMetaTag = { name: string; content: string };
export type UniversalLinkLinkTag = { rel: string; href: string; type?: string };

export type UniversalLinkTags = {
  meta: UniversalLinkMetaTag[];
  link: UniversalLinkLinkTag[];
  /** The same tags as a ready-to-paste `<head>` fragment. */
  html: string;
};

/**
 * Build the aturi.to link for a target. Returns null for input that doesn't
 * name a record or an identity.
 *
 * ```ts
 * buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
 * // 'https://aturi.to/profile/did:plc:abc/post/3k7'
 * buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7');
 * // 'https://aturi.to/profile/alice.bsky.social/post/3k7'
 * ```
 */
export function buildUniversalLink(
  input: UniversalLinkTarget,
  options: UniversalLinkOptions = {},
): string | null {
  const parsed = parseTarget(input);
  if (!parsed) return null;

  const origin = normalizeOrigin(options.origin);
  const did = options.did ?? parsed.did;
  const { collection, rkey } = parsed;

  // Deliberately the same shape the `aturi` waypoint's own `getUrl` produces,
  // so a link copied out of the catalog and a link built here are the same
  // string: posts and lists take the friendly `/post/` and `/lists/` aliases
  // and keep whichever identifier they were given, while the generic record
  // route prefers a DID when one is known. `preferDid` overrides all of it.
  const identifier = options.preferDid && did ? did : parsed.handle;

  let path: string;
  if (collection && rkey) {
    if (collection === 'app.bsky.feed.post') {
      path = `/profile/${seg(identifier)}/post/${seg(rkey)}`;
    } else if (collection === 'app.bsky.graph.list') {
      path = `/profile/${seg(identifier)}/lists/${seg(rkey)}`;
    } else {
      path = `/profile/${seg(did || parsed.handle)}/${seg(collection)}/${seg(rkey)}`;
    }
  } else {
    path = `/profile/${seg(identifier)}`;
  }

  return `${origin}${path}${queryString(options.params)}`;
}

/**
 * Turn an aturi.to URL back into the record it addresses. Accepts every shape
 * the site serves: the canonical `/profile/…` links, the `/explore/…` record
 * views, the legacy bare-path (`aturi.to/{handle}/{collection}/{rkey}`) and
 * `at://`-in-path forms. Returns null for any other host or path.
 */
export function parseUniversalLink(
  url: string | URL,
  options: Pick<UniversalLinkOptions, 'origin'> = {},
): ParsedURI | null {
  let target: URL;
  try {
    target = typeof url === 'string' ? new URL(url.trim()) : url;
  } catch {
    return null;
  }
  if (!/^https?:$/.test(target.protocol)) return null;

  let expectedHost: string;
  try {
    expectedHost = bareHost(new URL(normalizeOrigin(options.origin)).hostname);
  } catch {
    return null;
  }
  if (bareHost(target.hostname) !== expectedHost) return null;

  // The catalog's reverse parsers key off the aturi.to hostname, so a link
  // from a fork's own origin is rewritten onto it before matching. The host
  // has already been checked against `origin` above.
  const probe = new URL(target.toString());
  probe.protocol = 'https:';
  probe.hostname = 'aturi.to';
  probe.port = '';

  const match = matchSupportedUrl(probe);
  if (match && (match.source === 'aturi' || match.source === 'aturiExplore')) {
    return normalizeParsed(match.parsed);
  }

  return parseEmbeddedAtUri(probe.pathname) ?? parsePath(probe.pathname);
}

/** Whether a URL is an aturi.to link this package can resolve to a record. */
export function isUniversalLink(
  url: string | URL,
  options: Pick<UniversalLinkOptions, 'origin'> = {},
): boolean {
  return parseUniversalLink(url, options) !== null;
}

/**
 * Everything a copy button or a share sheet needs for one target: the link
 * itself, a human label, a `navigator.share()` payload, and the link in the
 * forms people paste it in.
 *
 * ```ts
 * const link = describeUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
 * await navigator.share(link.share);
 * await navigator.clipboard.writeText(link.snippets.markdown);
 * ```
 */
export function describeUniversalLink(
  input: UniversalLinkTarget,
  options: DescribeUniversalLinkOptions = {},
): UniversalLink | null {
  const parsed = parseTarget(input);
  if (!parsed) return null;
  const url = buildUniversalLink(parsed, options);
  if (!url) return null;

  const did = options.did ?? parsed.did ?? null;
  const collection = parsed.collection ?? null;
  const rkey = parsed.rkey ?? null;
  // A caller who supplies a DID gets AT URIs addressed by it — that's the
  // canonical, rename-proof form. Without one, the input's own identifier is
  // echoed back rather than silently changing what was passed in.
  const authority = did ?? parsed.handle;
  const atUri = collection && rkey
    ? `at://${authority}/${collection}/${rkey}`
    : `at://${authority}`;
  const label = describeTarget(parsed);

  return {
    url,
    atUri,
    type: parsed.type,
    handle: parsed.handle,
    did,
    collection,
    rkey,
    label,
    share: {
      title: options.title ?? label,
      text: options.text ?? label,
      url,
    },
    snippets: {
      url,
      atUri,
      markdown: `[${label}](${url})`,
      html: `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
    },
    oembedUrl: buildOEmbedUrl(url, collection, options.origin),
  };
}

/**
 * `<head>` tags that connect a page to the record it renders, so the rest of
 * the Atmosphere can find its way back. Two consumers today:
 *
 *   - `<meta name="at:canonical">` is the AT Tags proposal
 *     (https://tangled.org/chrisshank.com/at-tags/). Aturi's browser extension
 *     reads it off the live page and `aturi.to/api/resolve` reads it off the
 *     HTML, which is what turns your URL into "…and here are the 25 other
 *     clients that can open this". The `<link rel="alternate" href="at://…">`
 *     alongside it is the older spelling of the same declaration, kept because
 *     the resolver still falls back to it.
 *   - `<link type="application/json+oembed">` points unfurlers at the hosted
 *     oEmbed endpoint, so a link to your page previews as the post it is.
 *     Emitted for posts only, since that's all the endpoint renders.
 *
 * Serving these does not hand anything to aturi.to — they're static strings
 * describing a record you already display.
 */
export function buildUniversalLinkTags(
  input: UniversalLinkTarget,
  options: UniversalLinkOptions = {},
): UniversalLinkTags | null {
  const described = describeUniversalLink(input, options);
  if (!described) return null;

  const meta: UniversalLinkMetaTag[] = [
    { name: 'at:canonical', content: described.atUri },
  ];
  // A record lives in its author's repo, so the repo identifier *is* the
  // author. For a profile the canonical tag already says so; a second tag
  // naming the same identity would be noise.
  if (described.collection && described.rkey) {
    meta.push({
      name: 'at:author',
      content: `at://${described.did ?? described.handle}`,
    });
  }

  const link: UniversalLinkLinkTag[] = [
    { rel: 'alternate', href: described.atUri },
  ];
  if (described.oembedUrl) {
    link.push({
      rel: 'alternate',
      type: OEMBED_LINK_TYPE,
      href: described.oembedUrl,
    });
  }

  const html = [
    ...meta.map(
      (tag) =>
        `<meta name="${escapeHtml(tag.name)}" content="${escapeHtml(tag.content)}" />`,
    ),
    ...link.map((tag) => {
      const type = tag.type ? ` type="${escapeHtml(tag.type)}"` : '';
      return `<link rel="${escapeHtml(tag.rel)}"${type} href="${escapeHtml(tag.href)}" />`;
    }),
  ].join('\n');

  return { meta, link, html };
}

/**
 * Coerce any accepted target into a `ParsedURI`. Order matters: AT URIs and
 * page URLs are unambiguous, so they're tried first, and the loose bare-input
 * forms only get a look once those have declined.
 */
function parseTarget(input: UniversalLinkTarget): ParsedURI | null {
  if (typeof input !== 'string') {
    return input && input.handle ? normalizeParsed(input) : null;
  }

  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('at://')) {
    const parsed = parseAtUri(trimmed)?.parsed;
    return parsed ? normalizeParsed(parsed) : null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let target: URL;
    try {
      target = new URL(trimmed);
    } catch {
      return null;
    }
    // Any host can carry an AT URI in its path — `example.com/at://did:plc:…`,
    // and the single-slash `at:/…` spelling servers and browsers normalize it
    // to. Checked before the catalog's URL patterns because a host in the
    // catalog can serve both shapes.
    const embedded = parseEmbeddedAtUri(target.pathname);
    if (embedded) return embedded;
    const matched = matchSupportedUrl(target)?.parsed;
    return matched ? normalizeParsed(matched) : null;
  }

  // Bare identifiers and scheme-less AT URIs.
  return parsePath(trimmed.startsWith('@') ? trimmed.slice(1) : trimmed);
}

/**
 * Parse `{identifier}[/{collection}/{rkey}]` — the shape shared by a bare
 * handle, a scheme-less AT URI, and aturi.to's legacy bare paths. The
 * identifier must look like a DID or a dotted handle, which is what keeps
 * ordinary site paths (`/docs`, `/explore/lexicons`) from parsing as repos.
 */
function parsePath(path: string): ParsedURI | null {
  const segments = path.split('/').filter(Boolean);
  const handle = decodeSegment(segments[0] ?? '');
  if (!handle) return null;
  if (!handle.startsWith('did:') && !handle.includes('.')) return null;

  // Parsed from the raw segments so an escaped character can never be mistaken
  // for a path separator, then decoded on the way out.
  const parsed = parseAtUri(`at://${segments.join('/')}`)?.parsed;
  if (!parsed) return null;

  const collection = parsed.collection
    ? decodeSegment(parsed.collection)
    : undefined;
  const rkey = parsed.rkey ? decodeSegment(parsed.rkey) : undefined;
  return {
    ...parsed,
    handle,
    did: handle.startsWith('did:') ? handle : undefined,
    collection,
    rkey,
    uri:
      collection && rkey
        ? `at://${handle}/${collection}/${rkey}`
        : `at://${handle}`,
  };
}

/**
 * An `@` in front of a handle is display sugar, never part of the identifier —
 * but some clients put it in the path (`tangled.org/@alice.example`), so the
 * catalog's reverse parsers hand it back attached. Strip it before it reaches
 * a URL, where it would be escaped to `%40` and address nobody.
 */
function normalizeParsed(parsed: ParsedURI): ParsedURI {
  if (!parsed.handle.startsWith('@')) return parsed;
  const handle = parsed.handle.slice(1);
  if (!handle) return parsed;
  return {
    ...parsed,
    handle,
    uri:
      parsed.collection && parsed.rkey
        ? `at://${handle}/${parsed.collection}/${parsed.rkey}`
        : `at://${handle}`,
  };
}

/** Pull `at://…` out of a URL path that embeds one. */
function parseEmbeddedAtUri(pathname: string): ParsedURI | null {
  const match = /^\/at:\/{1,2}(.+)$/i.exec(pathname);
  if (!match) return null;
  return parsePath(match[1]);
}

function buildOEmbedUrl(
  url: string,
  collection: string | null,
  origin?: string,
): string | null {
  if (collection !== OEMBED_COLLECTION) return null;
  return `${normalizeOrigin(origin)}${OEMBED_PATH}?url=${encodeURIComponent(url)}`;
}

function describeTarget(parsed: ParsedURI): string {
  const who = parsed.handle.startsWith('did:')
    ? parsed.handle
    : `@${parsed.handle}`;
  if (parsed.type === 'post') return `Post by ${who}`;
  if (parsed.type === 'list') return `List by ${who}`;
  if (parsed.collection) return `${parsed.collection} record by ${who}`;
  return who;
}

function normalizeOrigin(origin?: string): string {
  if (!origin) return UNIVERSAL_LINK_ORIGIN;
  return origin.trim().replace(/\/+$/, '') || UNIVERSAL_LINK_ORIGIN;
}

/** Hostnames compare without a `www.` prefix; aturi.to serves both. */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Percent-encode a path segment without touching the characters atproto
 * identifiers are made of. `encodeURIComponent` would turn the colons in
 * `did:plc:…` into `%3A`, and these routes serve DIDs unencoded — an encoded
 * one points at a URL that doesn't exist. DIDs, NSIDs and record keys are
 * drawn from alphabets that need no escaping, so they pass through
 * byte-identical; anything else still gets escaped rather than forming a
 * broken URL.
 */
function seg(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':');
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function queryString(params?: UniversalLinkOptions['params']): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
