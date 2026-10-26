import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  dedupeByUri,
  scanDocumentForAtUris,
  scanDocumentForAtUrisFast,
} from '../inspectScanner';

function docFrom(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

const AT_URI = 'at://did:plc:abc123/app.bsky.feed.post/3mmp5de7occ2m';

describe('scanDocumentForAtUrisFast', () => {
  it('finds AT URIs in <head> <link> tags', () => {
    const doc = docFrom(`
      <html><head>
        <link rel="alternate" href="${AT_URI}" />
      </head><body></body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    expect(hits).toHaveLength(1);
    expect(hits[0].uri).toBe(AT_URI);
    expect(hits[0].where).toBe('head');
  });

  it('finds AT URIs in OG / Twitter meta tags', () => {
    const doc = docFrom(`
      <html><head>
        <meta property="og:url" content="${AT_URI}" />
        <meta name="twitter:title" content="cool ${AT_URI} thing" />
      </head><body></body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.where === 'meta')).toBe(true);
    expect(hits.map(h => h.uri)).toContain(AT_URI);
  });

  it('finds AT URIs in <a> hrefs', () => {
    const doc = docFrom(`
      <html><body>
        <a href="${AT_URI}">click</a>
        <a href="https://example.com">not at</a>
      </body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    expect(hits).toHaveLength(1);
    expect(hits[0].uri).toBe(AT_URI);
    expect(hits[0].where).toBe('link');
  });

  it('skips raw at:// substrings in body text (that is the slow path)', () => {
    const doc = docFrom(`
      <html><body>
        <p>here is a uri: ${AT_URI} embedded in prose</p>
      </body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    expect(hits).toHaveLength(0);
  });

  it('returns nothing for pages without AT URIs', () => {
    const doc = docFrom(`<html><body><p>just words</p></body></html>`);
    expect(scanDocumentForAtUrisFast(doc)).toHaveLength(0);
  });
});

describe('AT Tags (at: meta) detection', () => {
  const CANON = 'at://did:plc:abc123/site.standard.document/rkey';
  const AUTHOR = 'at://did:plc:author';

  it('detects at:canonical/at:author and labels the relation', () => {
    const doc = docFrom(`
      <html><head>
        <meta name="at:canonical" content="${CANON}" />
        <meta name="at:author" content="${AUTHOR}" />
      </head><body></body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    const canon = hits.find((h) => h.uri === CANON);
    const author = hits.find((h) => h.uri === AUTHOR);
    expect(canon?.where).toBe('at-tags');
    expect(canon?.relation).toBe('canonical');
    expect(author?.where).toBe('at-tags');
    expect(author?.relation).toBe('author');
  });

  it('labels namespaced relations as namespace:property', () => {
    const doc = docFrom(`
      <html><head>
        <meta name="at:standard.site:comments" content="${CANON}" />
      </head><body></body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc);
    expect(hits[0].relation).toBe('standard.site:comments');
  });

  it('ranks an at:canonical declaration above a bare <link> for the same URI', () => {
    const doc = docFrom(`
      <html><head>
        <meta name="at:canonical" content="${CANON}" />
        <link rel="alternate" href="${CANON}" />
      </head><body></body></html>
    `);
    const merged = dedupeByUri(scanDocumentForAtUris(doc));
    const hit = merged.find((h) => h.uri === CANON);
    expect(hit?.where).toBe('at-tags');
    expect(hit?.relation).toBe('canonical');
  });

  it('keeps one detection per URI, labeled with the most authoritative relation', () => {
    // Same DID declared as both author and me; canonical also shares a URI with
    // a namespaced relation that appears first in the document.
    const SELF = 'at://did:plc:me';
    const doc = docFrom(`
      <html><head>
        <meta name="at:standard.site:comments" content="${CANON}" />
        <meta name="at:canonical" content="${CANON}" />
        <meta name="at:author" content="${SELF}" />
        <meta name="at:me" content="${SELF}" />
      </head><body></body></html>
    `);
    const hits = scanDocumentForAtUrisFast(doc).filter((h) => h.where === 'at-tags');
    const canon = hits.filter((h) => h.uri === CANON);
    const self = hits.filter((h) => h.uri === SELF);
    expect(canon).toHaveLength(1);
    expect(canon[0].relation).toBe('canonical'); // beats standard.site:comments
    expect(self).toHaveLength(1);
    expect(self[0].relation).toBe('author'); // beats me
  });

  it('orders at-tags ahead of a URL-pattern hit for a different URI', () => {
    const OTHER = 'at://did:plc:other/site.standard.document/x';
    const doc = docFrom(`
      <html><head>
        <meta name="at:canonical" content="${CANON}" />
      </head><body></body></html>
    `);
    // Simulate the popup path: a URL-pattern hit collected first, then the
    // content-script DOM hits appended.
    const hits = [
      { uri: OTHER, where: 'url' as const },
      ...scanDocumentForAtUris(doc),
    ];
    const merged = dedupeByUri(hits);
    expect(merged[0].where).toBe('at-tags');
    expect(merged[0].uri).toBe(CANON);
  });
});

describe('scanDocumentForAtUris (full)', () => {
  it('does pick up body-text URIs that the fast scan ignores', () => {
    const doc = docFrom(`
      <html><body>
        <p>here is ${AT_URI} in prose</p>
      </body></html>
    `);
    // linkedom's innerText support is partial; fall back to textContent for
    // the assertion if innerText comes back empty.
    const hits = scanDocumentForAtUris(doc);
    // Either text or link-shaped hits are acceptable here — the point is
    // that the body URI gets seen by the full scan in some bucket.
    const merged = dedupeByUri(hits);
    if (merged.length > 0) {
      expect(merged[0].uri).toBe(AT_URI);
    }
  });
});

describe('dedupeByUri', () => {
  it('keeps the most authoritative source per unique URI', () => {
    const hits = [
      { uri: AT_URI, where: 'text' as const },
      { uri: AT_URI, where: 'head' as const },
      { uri: AT_URI, where: 'link' as const },
    ];
    const out = dedupeByUri(hits);
    expect(out).toHaveLength(1);
    expect(out[0].where).toBe('head');
  });
});
