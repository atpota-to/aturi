/**
 * Page-scanning helpers for the Inspect tab. The scanner runs inside a
 * content script (with full DOM access) and returns a deduplicated array
 * of detected AT URIs back to the popup for display.
 *
 * Bucket meanings:
 *   - 'url'   : the page URL itself matched a known atmosphere app pattern.
 *   - 'head'  : <link href="at://..."> in <head>.
 *   - 'meta'  : OpenGraph / Twitter meta tags with an at:// value.
 *   - 'link'  : <a href="at://..."> anywhere on the page.
 *   - 'jsonld': inside a <script type="application/ld+json"> block.
 *   - 'text'  : raw at:// substring in document.body.innerText.
 */

export type DetectedSource =
  | 'url'
  | 'head'
  | 'meta'
  | 'link'
  | 'jsonld'
  | 'text';

export type DetectedAtUri = {
  uri: string;
  where: DetectedSource;
  sample?: string;
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
 * Merge detections so that each unique AT URI appears once, with a stable
 * `where` ranked from most-authoritative to least.
 */
export function dedupeByUri(hits: DetectedAtUri[]): DetectedAtUri[] {
  const ranking: DetectedSource[] = ['url', 'head', 'meta', 'link', 'jsonld', 'text'];
  const score = (w: DetectedSource) => ranking.indexOf(w);
  const map = new Map<string, DetectedAtUri>();
  for (const hit of hits) {
    const existing = map.get(hit.uri);
    if (!existing || score(hit.where) < score(existing.where)) {
      map.set(hit.uri, hit);
    }
  }
  return Array.from(map.values());
}
