/**
 * Page-scanning helpers for the Inspect tab. The scanner runs inside a
 * content script (with full DOM access) and returns a deduplicated array
 * of detected AT URIs back to the popup for display.
 *
 * Bucket meanings:
 *   - 'url'    : the page URL itself matched a known atmosphere app pattern.
 *   - 'at-tags': the AT Tags proposal — <meta name="at:canonical" content="at://...">
 *                and its siblings (alternate / author / me / namespaced). This
 *                is an explicit, machine-readable declaration by the page, so
 *                it's the most authoritative DOM signal.
 *   - 'head'   : <link href="at://..."> in <head>.
 *   - 'meta'   : OpenGraph / Twitter meta tags with an at:// value.
 *   - 'link'   : <a href="at://..."> anywhere on the page.
 *   - 'jsonld' : inside a <script type="application/ld+json"> block.
 *   - 'text'   : raw at:// substring in document.body.innerText.
 */

import { parseAtTagsFromDocument } from '@aturi/atproto/atTags';

export type DetectedSource =
  | 'url'
  | 'at-tags'
  | 'head'
  | 'meta'
  | 'link'
  | 'jsonld'
  | 'text';

export type DetectedAtUri = {
  uri: string;
  where: DetectedSource;
  sample?: string;
  /**
   * The declared relationship for an AT Tags hit: a standard property
   * (`canonical` / `alternate` / `author` / `me`) or a namespaced
   * `namespace:property`. Only set when `where === 'at-tags'`.
   */
  relation?: string;
};

const AT_URI_REGEX = /at:\/\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._-]+)?(?:\/[A-Za-z0-9._~-]+)?/g;

function normalize(uri: string): string {
  return uri.replace(/[.,;:!?)\]]+$/, '');
}

function isLikelyAtUri(uri: string): boolean {
  if (!uri.startsWith('at://')) return false;
  const rest = uri.slice(5);
  // Must have something after the scheme, and the repo segment should look
  // like a handle, did:, or at least a domain-ish identifier.
  if (rest.length < 3) return false;
  const repo = rest.split('/')[0];
  if (!repo) return false;
  return /^(did:|[A-Za-z0-9])/.test(repo);
}

function addUnique(out: DetectedAtUri[], hit: DetectedAtUri): void {
  if (!isLikelyAtUri(hit.uri)) return;
  if (out.some((existing) => existing.uri === hit.uri && existing.where === hit.where)) return;
  out.push(hit);
}

// Which AT Tags relation wins the badge when one URI is declared under several
// (e.g. the same DID as both at:author and at:me). Lower is more authoritative;
// anything namespaced falls to the end.
const AT_TAG_RELATION_RANK: Record<string, number> = {
  canonical: 0,
  alternate: 1,
  author: 2,
  me: 3,
};
function atTagRelationRank(relation: string): number {
  return relation in AT_TAG_RELATION_RANK ? AT_TAG_RELATION_RANK[relation] : 4;
}

/**
 * Collect AT Tags (`<meta name="at:...">`) as detections, tagged with the
 * declared relationship so the popup can badge each hit (canonical, author,
 * etc.). A single URI can be declared under more than one relation; we keep one
 * detection per URI, labeled with the most authoritative relation (so the label
 * is deterministic rather than document-order dependent), preserving
 * first-appearance order so canonical/author lead the list.
 */
function collectAtTags(doc: Document, out: DetectedAtUri[]): void {
  try {
    const parsed = parseAtTagsFromDocument(doc);
    const best = new Map<string, string>();
    for (const tag of parsed.tags) {
      const relation =
        tag.kind === 'standard' ? tag.relation : `${tag.namespace}:${tag.property}`;
      const current = best.get(tag.uri);
      if (current === undefined || atTagRelationRank(relation) < atTagRelationRank(current)) {
        best.set(tag.uri, relation);
      }
    }
    for (const [uri, relation] of best) {
      addUnique(out, { uri, where: 'at-tags', relation });
    }
  } catch {
    /* ignore — a malformed DOM shouldn't sink the rest of the scan */
  }
}

function walkJsonForAtUris(value: unknown, onHit: (uri: string) => void): void {
  if (typeof value === 'string') {
    if (value.includes('at://')) {
      const matches = value.match(AT_URI_REGEX);
      if (matches) matches.forEach((m) => onHit(normalize(m)));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => walkJsonForAtUris(v, onHit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walkJsonForAtUris(v, onHit);
    }
  }
}

/**
 * Scan the current document for AT URIs. Caller decides whether to also
 * report a URL-pattern match (handled in the content script, since the page
 * URL is known there).
 */
export function scanDocumentForAtUris(doc: Document): DetectedAtUri[] {
  const out: DetectedAtUri[] = [];

  // 0. AT Tags proposal: <meta name="at:canonical" content="at://..."> &c.
  //    Runs first so explicit, labeled declarations lead the results.
  collectAtTags(doc, out);

  // 1. <head> <link href="at://...">
  try {
    doc.querySelectorAll<HTMLLinkElement>('head link[href^="at://"]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) addUnique(out, { uri: normalize(href), where: 'head' });
    });
  } catch {
    /* ignore selector errors */
  }

  // 2. OG / Twitter meta tags containing at://
  try {
    doc.querySelectorAll<HTMLMetaElement>(
      'meta[property^="og:"], meta[name^="twitter:"], meta[name="atproto:uri"]',
    ).forEach((el) => {
      const content = el.getAttribute('content');
      if (content && content.includes('at://')) {
        const matches = content.match(AT_URI_REGEX);
        if (matches) {
          matches.forEach((m) => addUnique(out, { uri: normalize(m), where: 'meta' }));
        }
      }
    });
  } catch {
    /* ignore */
  }

  // 3. Anchor tags with at:// hrefs
  try {
    doc.querySelectorAll<HTMLAnchorElement>('a[href^="at://"]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) addUnique(out, { uri: normalize(href), where: 'link' });
    });
  } catch {
    /* ignore */
  }

  // 4. JSON-LD blocks
  try {
    doc
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
      .forEach((el) => {
        const raw = el.textContent;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          walkJsonForAtUris(parsed, (uri) => addUnique(out, { uri, where: 'jsonld' }));
        } catch {
          // Some sites embed broken JSON-LD; fall back to regex over the raw text.
          const matches = raw.match(AT_URI_REGEX);
          if (matches) matches.forEach((m) => addUnique(out, { uri: normalize(m), where: 'jsonld' }));
        }
      });
  } catch {
    /* ignore */
  }

  // 5. Plain text in <body>. Bail on huge pages to avoid blowing the popup latency.
  try {
    const text = doc.body?.innerText || '';
    if (text.length < 2_000_000) {
      const matches = text.match(AT_URI_REGEX);
      if (matches) {
        for (const m of matches.slice(0, 50)) {
          const uri = normalize(m);
          // Capture a tiny snippet of surrounding context for the popup card.
          const idx = text.indexOf(m);
          const sample =
            idx >= 0
              ? text.slice(Math.max(0, idx - 30), idx + m.length + 30).replace(/\s+/g, ' ').trim()
              : undefined;
          addUnique(out, { uri, where: 'text', sample });
        }
      }
    }
  } catch {
    /* ignore */
  }

  return out;
}

/**
 * Lightweight scan used by the always-on content script that drives the
 * toolbar badge. Skips the body-text regex (the expensive part) and only
 * looks at structured signals: `<link>` head tags, `<meta>` tags, and
 * `<a href="at://">` anchors. URL-pattern matching is the caller's job
 * since the scanner has no access to a URL by itself.
 */
export function scanDocumentForAtUrisFast(doc: Document): DetectedAtUri[] {
  const out: DetectedAtUri[] = [];

  // AT Tags are structured `<meta>` tags, so they're cheap enough for the
  // always-on badge scan too.
  collectAtTags(doc, out);

  try {
    doc.querySelectorAll<HTMLLinkElement>('head link[href^="at://"]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) addUnique(out, { uri: normalize(href), where: 'head' });
    });
  } catch {
    /* ignore */
  }

  try {
    doc.querySelectorAll<HTMLMetaElement>(
      'meta[property^="og:"], meta[name^="twitter:"], meta[name="atproto:uri"]',
    ).forEach((el) => {
      const content = el.getAttribute('content');
      if (content && content.includes('at://')) {
        const matches = content.match(AT_URI_REGEX);
        if (matches) {
          matches.forEach((m) => addUnique(out, { uri: normalize(m), where: 'meta' }));
        }
      }
    });
  } catch {
    /* ignore */
  }

  try {
    doc.querySelectorAll<HTMLAnchorElement>('a[href^="at://"]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) addUnique(out, { uri: normalize(href), where: 'link' });
    });
  } catch {
    /* ignore */
  }

  return out;
}

/**
 * Merge detections so that each unique AT URI appears once, keeping the
 * most-authoritative `where` for that URI, and order the result from
 * most-authoritative source to least. Ordering by rank (not just insertion)
 * means an explicit `at:canonical` declaration leads the list even when a
 * URL-pattern match for a *different* URI was collected first upstream. Ties
 * keep first-appearance order (Array.prototype.sort is stable).
 */
export function dedupeByUri(hits: DetectedAtUri[]): DetectedAtUri[] {
  const ranking: DetectedSource[] = ['at-tags', 'url', 'head', 'meta', 'link', 'jsonld', 'text'];
  const score = (w: DetectedSource) => {
    const i = ranking.indexOf(w);
    return i === -1 ? ranking.length : i;
  };
  const map = new Map<string, DetectedAtUri>();
  for (const hit of hits) {
    const existing = map.get(hit.uri);
    if (!existing || score(hit.where) < score(existing.where)) {
      map.set(hit.uri, hit);
    }
  }
  return Array.from(map.values()).sort((a, b) => score(a.where) - score(b.where));
}
