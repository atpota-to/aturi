/**
 * Pure helpers behind `/api/favicon`, which finds and serves the icon of the
 * site a lexicon namespace reverses to (`app.bsky` -> bsky.app). No network
 * IO here; the route does the fetching.
 *
 * Why a route at all, rather than `<img src="https://{domain}/favicon.ico">`:
 * plenty of sites have no icon at that path. bsky.app answers it with a 404
 * and declares its icons in `<link rel="icon">` tags pointing at a CDN, so the
 * page itself has to be read, which a browser cannot do across origins. Going
 * through the route also means a visitor's browser asks aturi.to for forty
 * icons rather than asking forty sites it never chose to visit.
 */

import { appDomainFor } from './ufos/nsid';
import { isBlockedFetchHost } from './ssrfGuard';

/**
 * The route only serves domains `appDomainFor` could have produced: two
 * labels (three under a per-project host or a country second level), each a
 * hostname label. Anything deeper (`internal.corp.example.com`) is refused, so
 * the route cannot be aimed at an arbitrary host, and the SSRF guard still has
 * the last word on what is left.
 */
export function isFaviconDomain(domain: string): boolean {
  if (!domain || domain.length > 253 || domain !== domain.toLowerCase()) return false;
  const reversed = domain.split('.').reverse().join('.');
  return appDomainFor(reversed) === domain && !isBlockedFetchHost(domain);
}

/** Where the explorer loads a namespace's icon from, or null when its prefix
 * names no site (`a.guestbook`, `io.github`). */
export function faviconSrcFor(prefix: string): string | null {
  const domain = appDomainFor(prefix);
  return domain ? `/api/favicon?domain=${encodeURIComponent(domain)}` : null;
}

export type IconCandidate = { href: string; score: number };

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  // Skip the tag name itself: `<link` is the first match.
  const body = tag.replace(/^<link\b/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/** Largest edge named in a `sizes` attribute (`16x16 32x32` -> 32), Infinity
 * for `any`, null when absent or unparseable. */
function largestSize(sizes: string | undefined): number | null {
  if (!sizes) return null;
  let best: number | null = null;
  for (const token of sizes.toLowerCase().split(/\s+/)) {
    if (token === 'any') return Infinity;
    const m = token.match(/^(\d+)x(\d+)$/);
    if (m) best = Math.max(best ?? 0, Number(m[1]), Number(m[2]));
  }
  return best;
}

/**
 * How well a declared icon suits a 14–16px mark drawn at up to 3x: a raster
 * of 32–64px is ideal, a vector scales to anything, an apple-touch-icon is a
 * large opaque tile kept as a last resort before `/favicon.ico`. An icon
 * scoped by `media` (usually a dark-scheme variant) is drawn for a tab bar we
 * can't see, so it ranks below its unscoped sibling.
 */
function scoreIcon(rel: string[], attrs: Map<string, string>, href: string): number | null {
  const isIcon = rel.includes('icon');
  const isTouch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
  if (!isIcon && !isTouch) return null;
  let score: number;
  if (isTouch) {
    score = 40;
  } else {
    const type = (attrs.get('type') ?? '').toLowerCase();
    const size = largestSize(attrs.get('sizes'));
    const isSvg = type.includes('svg') || /\.svg(?:[?#]|$)/i.test(href);
    if (isSvg || size === Infinity) score = 90;
    else if (size === null) score = 75;
    else if (size >= 32 && size <= 64) score = 100;
    else if (size > 64) score = size > 256 ? 70 : 85;
    else score = size >= 16 ? 65 : 50;
  }
  if (attrs.has('media')) score -= 15;
  return score;
}

/**
 * Every icon a page declares, absolute and best first, with `/favicon.ico`
 * appended as the conventional fallback. Hrefs resolve against `base`; a
 * `<base href>` is not honoured, which costs nothing on the sites seen so far.
 * Only http(s) URLs survive, so a `data:` or `javascript:` href is dropped.
 */
export function iconCandidates(html: string | null, base: string): string[] {
  const found: IconCandidate[] = [];
  for (const [tag] of (html ?? '').matchAll(LINK_TAG)) {
    const attrs = attributesOf(tag);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const rawHref = attrs.get('href')?.trim();
    if (!rawHref) continue;
    let href: string;
    try {
      const url = new URL(rawHref, base);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      href = url.toString();
    } catch {
      continue;
    }
    const score = scoreIcon(rel, attrs, href);
    if (score !== null) found.push({ href, score });
  }
  // Stable sort: equal scores keep document order, which is the site's own.
  found.sort((a, b) => b.score - a.score);
  const ordered = found.map((c) => c.href);
  const fallback = new URL('/favicon.ico', base).toString();
  if (!ordered.includes(fallback)) ordered.push(fallback);
  return [...new Set(ordered)];
}

/** Image types the route will serve. Anything else is refused. */
export type IconType =
  | 'image/png'
  | 'image/x-icon'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/svg+xml';

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/**
 * What the bytes actually are, read from their signature rather than the
 * upstream `Content-Type`: servers label `.ico` files everything from
 * `image/vnd.microsoft.icon` to `application/octet-stream`, and a single-page
 * app answers a missing `/favicon.ico` with its HTML shell and a 200. The
 * route responds with this type, never the upstream one. Null for anything
 * that is not one of the formats above.
 */
export function sniffIconType(bytes: Uint8Array): IconType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  // SVG is text: an optional BOM, XML declaration, doctype and comments, then
  // the root element. HTML never opens with `<svg`, so a page is not mistaken
  // for one.
  const head = new TextDecoder('utf-8')
    .decode(bytes.subarray(0, 2048))
    .replace(/^﻿/, '')
    .replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
  if (/^<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}
