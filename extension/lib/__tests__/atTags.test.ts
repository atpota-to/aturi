import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  parseAtTagName,
  parseAtTags,
  parseAtTagsFromDocument,
  parseAtTagsFromHtml,
  primaryRecordFromAtTags,
  buildAtTagsMetadata,
  isValidAtUri,
  isDidOnlyAtUri,
  type MetaEntry,
} from '@aturi/atproto/atTags';

function docFrom(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

const RECORD = 'at://did:plc:abc123/site.standard.document/rkey';
const RECORD_2 = 'at://did:plc:xyz789/site.standard.publication/rkey';
const AUTHOR = 'at://did:plc:author';
const ME = 'at://did:plc:my-did';

describe('parseAtTagName', () => {
  it('recognizes the four standard properties', () => {
    expect(parseAtTagName('at:canonical')).toEqual({ kind: 'standard', relation: 'canonical' });
    expect(parseAtTagName('at:alternate')).toEqual({ kind: 'standard', relation: 'alternate' });
    expect(parseAtTagName('at:author')).toEqual({ kind: 'standard', relation: 'author' });
    expect(parseAtTagName('at:me')).toEqual({ kind: 'standard', relation: 'me' });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(parseAtTagName('  AT:Canonical ')).toEqual({ kind: 'standard', relation: 'canonical' });
  });

  it('parses namespaced properties as at:{namespace}:{property}', () => {
    expect(parseAtTagName('at:standard.site:comments')).toEqual({
      kind: 'namespaced',
      namespace: 'standard.site',
      property: 'comments',
    });
    expect(parseAtTagName('at:standard.site:syndicated-by')).toEqual({
      kind: 'namespaced',
      namespace: 'standard.site',
      property: 'syndicated-by',
    });
  });

  it('preserves the original case of namespace and property segments', () => {
    // Only the `at:` prefix and standard-relation keywords are lowercased;
    // case-sensitive property names must survive intact.
    expect(parseAtTagName('AT:com.example.myApp:syndicatedBy')).toEqual({
      kind: 'namespaced',
      namespace: 'com.example.myApp',
      property: 'syndicatedBy',
    });
  });

  it('ignores non-at names', () => {
    expect(parseAtTagName('og:title')).toBeNull();
    expect(parseAtTagName('twitter:card')).toBeNull();
    expect(parseAtTagName('description')).toBeNull();
    expect(parseAtTagName(null)).toBeNull();
    expect(parseAtTagName(undefined)).toBeNull();
  });

  it('ignores at properties that are neither standard nor namespaced', () => {
    // Per the proposal: "Any at property that is not part of the standard and
    // not namespaced should be ignored."
    expect(parseAtTagName('at:')).toBeNull();
    expect(parseAtTagName('at:bogus')).toBeNull();
    expect(parseAtTagName('at:standard.site:')).toBeNull(); // empty property
    expect(parseAtTagName('at::comments')).toBeNull(); // empty namespace
  });
});

describe('parseAtTags', () => {
  it('buckets standard properties', () => {
    const result = parseAtTags([
      { name: 'at:canonical', content: RECORD },
      { name: 'at:alternate', content: RECORD_2 },
      { name: 'at:author', content: AUTHOR },
      { name: 'at:me', content: ME },
    ]);
    expect(result.canonical).toEqual([RECORD]);
    expect(result.alternate).toEqual([RECORD_2]);
    expect(result.author).toEqual([AUTHOR]);
    expect(result.me).toEqual([ME]);
    expect(result.tags).toHaveLength(4);
  });

  it('follows array semantics for repeated properties', () => {
    const result = parseAtTags([
      { name: 'at:canonical', content: RECORD },
      { name: 'at:canonical', content: RECORD_2 },
      { name: 'at:author', content: AUTHOR },
      { name: 'at:author', content: ME },
    ]);
    expect(result.canonical).toEqual([RECORD, RECORD_2]);
    expect(result.author).toEqual([AUTHOR, ME]);
  });

  it('deduplicates identical values for the same property', () => {
    const result = parseAtTags([
      { name: 'at:canonical', content: RECORD },
      { name: 'at:canonical', content: RECORD },
    ]);
    expect(result.canonical).toEqual([RECORD]);
    expect(result.tags).toHaveLength(1);
  });

  it('drops tags whose content is not a valid AT URI', () => {
    const result = parseAtTags([
      { name: 'at:canonical', content: 'https://example.com/thing' },
      { name: 'at:canonical', content: 'not a uri' },
      { name: 'at:canonical', content: '' },
      { name: 'at:canonical', content: RECORD },
    ]);
    expect(result.canonical).toEqual([RECORD]);
  });

  it('nests namespaced properties under namespace -> property -> uris', () => {
    const result = parseAtTags([
      { name: 'at:standard.site:comments', content: RECORD },
      { name: 'at:standard.site:syndicated-by', content: RECORD_2 },
      { name: 'at:standard.site:comments', content: RECORD_2 },
    ]);
    expect(result.namespaces['standard.site'].comments).toEqual([RECORD, RECORD_2]);
    expect(result.namespaces['standard.site']['syndicated-by']).toEqual([RECORD_2]);
  });

  it('ignores unrecognized at properties entirely', () => {
    const result = parseAtTags([{ name: 'at:bogus', content: RECORD }]);
    expect(result.tags).toHaveLength(0);
    expect(result.canonical).toEqual([]);
  });

  it('records a flat, source-ordered tag list', () => {
    const entries: MetaEntry[] = [
      { name: 'at:author', content: AUTHOR },
      { name: 'at:canonical', content: RECORD },
      { name: 'at:standard.site:comments', content: RECORD_2 },
    ];
    const result = parseAtTags(entries);
    expect(result.tags.map((t) => t.name)).toEqual([
      'at:author',
      'at:canonical',
      'at:standard.site:comments',
    ]);
  });
});

describe('parseAtTagsFromDocument', () => {
  it('reads at: meta tags off a live DOM', () => {
    const doc = docFrom(`
      <html><head>
        <meta name="at:canonical" content="${RECORD}" />
        <meta name="at:alternate" content="${RECORD_2}" />
        <meta name="at:author" content="${AUTHOR}" />
        <meta name="at:me" content="${ME}" />
        <meta name="at:standard.site:comments" content="${RECORD_2}" />
        <meta name="og:title" content="unrelated" />
        <meta name="description" content="ignore me" />
      </head><body></body></html>
    `);
    const result = parseAtTagsFromDocument(doc);
    expect(result.canonical).toEqual([RECORD]);
    expect(result.alternate).toEqual([RECORD_2]);
    expect(result.author).toEqual([AUTHOR]);
    expect(result.me).toEqual([ME]);
    expect(result.namespaces['standard.site'].comments).toEqual([RECORD_2]);
  });

  it('returns an empty result for a page with no at: tags', () => {
    const doc = docFrom(`<html><head><meta name="og:title" content="x" /></head><body></body></html>`);
    const result = parseAtTagsFromDocument(doc);
    expect(result.tags).toHaveLength(0);
  });

  it('reads mixed-case at: names off the DOM (case-insensitive selection)', () => {
    // A case-sensitive `meta[name^="at:"]` selector would silently drop this.
    const doc = docFrom(`
      <html><head>
        <meta name="AT:canonical" content="${RECORD}" />
      </head><body></body></html>
    `);
    const result = parseAtTagsFromDocument(doc);
    expect(result.canonical).toEqual([RECORD]);
  });
});

describe('parseAtTagsFromHtml (DOM-free, server path)', () => {
  it('parses at: meta tags out of raw HTML', () => {
    const tags = parseAtTagsFromHtml(`
      <html><head>
        <meta name="at:canonical" content="${RECORD}">
        <meta name="at:author" content="${AUTHOR}">
      </head><body><p>hi</p></body></html>
    `);
    expect(tags.canonical).toEqual([RECORD]);
    expect(tags.author).toEqual([AUTHOR]);
  });

  it('tolerates reversed attribute order, single quotes, and self-closing tags', () => {
    const tags = parseAtTagsFromHtml(`
      <meta content='${RECORD}' name='at:canonical' />
      <meta content="${RECORD_2}" name="at:alternate">
    `);
    expect(tags.canonical).toEqual([RECORD]);
    expect(tags.alternate).toEqual([RECORD_2]);
  });

  it('keeps array semantics across repeated tags', () => {
    const tags = parseAtTagsFromHtml(`
      <meta name="at:canonical" content="${RECORD}">
      <meta name="at:canonical" content="${RECORD_2}">
    `);
    expect(tags.canonical).toEqual([RECORD, RECORD_2]);
  });

  it('decodes HTML entities in content', () => {
    // A DID containing an escaped ampersand round-trips to a literal one.
    const tags = parseAtTagsFromHtml(
      `<meta name="at:canonical" content="at://did:plc:abc123/app.bsky.feed.post/a&amp;b">`,
    );
    expect(tags.canonical).toEqual(['at://did:plc:abc123/app.bsky.feed.post/a&b']);
  });

  it('ignores meta tags that are not AT Tags', () => {
    const tags = parseAtTagsFromHtml(`
      <meta name="description" content="a page">
      <meta property="og:url" content="${RECORD}">
      <meta name="at:bogus" content="${RECORD}">
    `);
    expect(tags.tags).toHaveLength(0);
  });

  it('returns an empty result for empty or non-HTML input', () => {
    expect(parseAtTagsFromHtml('').tags).toHaveLength(0);
    expect(parseAtTagsFromHtml(null).tags).toHaveLength(0);
    expect(parseAtTagsFromHtml('just some text').tags).toHaveLength(0);
  });

  it('agrees with the DOM parser on the same markup', () => {
    const html = `
      <html><head>
        <meta name="at:canonical" content="${RECORD}">
        <meta name="at:alternate" content="${RECORD_2}">
        <meta name="at:standard.site:comments" content="${RECORD_2}">
      </head><body></body></html>
    `;
    const fromHtml = parseAtTagsFromHtml(html);
    const fromDom = parseAtTagsFromDocument(docFrom(html));
    expect(fromHtml.canonical).toEqual(fromDom.canonical);
    expect(fromHtml.alternate).toEqual(fromDom.alternate);
    expect(fromHtml.namespaces).toEqual(fromDom.namespaces);
  });
});

describe('primaryRecordFromAtTags', () => {
  it('prefers canonical, then alternate', () => {
    expect(
      primaryRecordFromAtTags(
        parseAtTags([
          { name: 'at:alternate', content: RECORD_2 },
          { name: 'at:canonical', content: RECORD },
        ]),
      ),
    ).toBe(RECORD);
    expect(
      primaryRecordFromAtTags(parseAtTags([{ name: 'at:alternate', content: RECORD_2 }])),
    ).toBe(RECORD_2);
  });

  it('ignores author/me, which point at a DID rather than a record', () => {
    const tags = parseAtTags([
      { name: 'at:author', content: AUTHOR },
      { name: 'at:me', content: ME },
    ]);
    expect(primaryRecordFromAtTags(tags)).toBeNull();
  });

  it('returns null when the page declares nothing', () => {
    expect(primaryRecordFromAtTags(parseAtTags([]))).toBeNull();
  });
});

describe('isValidAtUri / isDidOnlyAtUri', () => {
  it('accepts DID and handle authorities', () => {
    expect(isValidAtUri(RECORD)).toBe(true);
    expect(isValidAtUri(AUTHOR)).toBe(true);
    expect(isValidAtUri('at://alice.bsky.social/app.bsky.feed.post/xyz')).toBe(true);
  });

  it('rejects non-at URIs and junk authorities', () => {
    expect(isValidAtUri('https://example.com')).toBe(false);
    expect(isValidAtUri('at://')).toBe(false);
    expect(isValidAtUri('at://foo')).toBe(false); // no dot, not a DID
    expect(isValidAtUri('')).toBe(false);
    expect(isValidAtUri(null)).toBe(false);
  });

  it('distinguishes DID-only URIs from record URIs', () => {
    expect(isDidOnlyAtUri(AUTHOR)).toBe(true);
    expect(isDidOnlyAtUri(ME)).toBe(true);
    expect(isDidOnlyAtUri(RECORD)).toBe(false); // has collection + rkey
    expect(isDidOnlyAtUri('at://alice.bsky.social')).toBe(false); // handle, not DID
  });
});

describe('buildAtTagsMetadata', () => {
  it('emits a single string for one value and an array for many', () => {
    const meta = buildAtTagsMetadata({
      canonical: RECORD,
      author: [AUTHOR, ME],
    });
    expect(meta['at:canonical']).toBe(RECORD);
    expect(meta['at:author']).toEqual([AUTHOR, ME]);
  });

  it('drops invalid AT URIs and omits empty properties', () => {
    const meta = buildAtTagsMetadata({
      canonical: 'https://example.com',
      author: AUTHOR,
      me: null,
    });
    expect(meta['at:canonical']).toBeUndefined();
    expect(meta['at:author']).toBe(AUTHOR);
    expect(meta['at:me']).toBeUndefined();
  });

  it('emits namespaced tags with the at:{namespace}:{property} name', () => {
    const meta = buildAtTagsMetadata({
      canonical: RECORD,
      namespaces: {
        'standard.site': { comments: RECORD_2, 'syndicated-by': [RECORD, RECORD_2] },
      },
    });
    expect(meta['at:standard.site:comments']).toBe(RECORD_2);
    expect(meta['at:standard.site:syndicated-by']).toEqual([RECORD, RECORD_2]);
  });

  it('round-trips: built metadata parses back to the same values', () => {
    const meta = buildAtTagsMetadata({ canonical: [RECORD, RECORD_2], author: AUTHOR });
    const entries: MetaEntry[] = Object.entries(meta).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((content) => ({ name, content })),
    );
    const parsed = parseAtTags(entries);
    expect(parsed.canonical).toEqual([RECORD, RECORD_2]);
    expect(parsed.author).toEqual([AUTHOR]);
  });

  it('round-trips namespaced properties with case-sensitive segments', () => {
    const meta = buildAtTagsMetadata({
      namespaces: { 'com.example.myApp': { syndicatedBy: RECORD } },
    });
    expect(meta['at:com.example.myApp:syndicatedBy']).toBe(RECORD);
    const entries: MetaEntry[] = Object.entries(meta).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((content) => ({ name, content })),
    );
    const parsed = parseAtTags(entries);
    // The exact-case key must be recoverable — no silent lowercasing.
    expect(parsed.namespaces['com.example.myApp'].syndicatedBy).toEqual([RECORD]);
  });
});
