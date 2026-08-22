import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteJsonLd } from '@/lib/structuredData';
import { serializeJsonLd } from '@/utils/sanitize';

type JsonLdNode = Record<string, unknown>;

const graphOf = (base: string): JsonLdNode[] =>
  buildSiteJsonLd(base)['@graph'] as unknown as JsonLdNode[];

const graph = graphOf('https://example.test');
const node = (type: string): JsonLdNode =>
  graph.find(n => n['@type'] === type) as JsonLdNode;

test('emits Organization, WebSite and SoftwareApplication in one graph', () => {
  assert.equal(buildSiteJsonLd('https://example.test')['@context'], 'https://schema.org');
  assert.deepEqual(
    graph.map(n => n['@type']),
    ['Organization', 'WebSite', 'SoftwareApplication'],
  );
});

test('the base URL is normalised, never doubling the slash', () => {
  const trailing = graphOf('https://example.test/');
  assert.equal(trailing[0].url, 'https://example.test/');
  assert.equal(trailing[0]['@id'], 'https://example.test/#organization');
});

test('Organization carries the fields a legitimacy check looks for', () => {
  const org = node('Organization');
  assert.ok(org.name);
  assert.ok(org.description);
  assert.ok(org.email);
  assert.ok(org.logo);
  assert.ok((org.sameAs as string[]).length >= 2);

  const points = org.contactPoint as Record<string, string>[];
  assert.ok(points.length >= 1);
  for (const point of points) {
    assert.equal(point['@type'], 'ContactPoint');
    assert.ok(point.contactType, 'a ContactPoint without contactType is unusable');
    assert.match(point.email, /@/);
  }
});

test('the other nodes reference Organization by @id rather than repeating it', () => {
  const orgId = node('Organization')['@id'];
  assert.deepEqual(node('WebSite').publisher, { '@id': orgId });
  assert.deepEqual(node('SoftwareApplication').author, { '@id': orgId });
  assert.deepEqual(node('SoftwareApplication').publisher, { '@id': orgId });
});

test('SoftwareApplication states that the product is free', () => {
  const app = node('SoftwareApplication');
  assert.equal(app.isAccessibleForFree, true);
  // Omitting `offers` entirely reads as "pricing unknown" to a parser.
  assert.equal((app.offers as Record<string, string>).price, '0');
  assert.ok(app.applicationCategory);
  assert.ok(app.description);
});

test('no node publishes a postal address', () => {
  // Deliberate: this is a one-person project run from home. Structured-data
  // audits ask for PostalAddress; that is not a reason to publish one.
  for (const n of graph) assert.equal(n.address, undefined);
});

test('serialising for inline embedding escapes the HTML-significant characters', () => {
  const serialized = serializeJsonLd(buildSiteJsonLd('https://example.test'));
  for (const char of ['<', '>', '&']) {
    assert.ok(!serialized.includes(char), `${char} survived escaping`);
  }
  const roundTripped = JSON.parse(
    serialized
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&'),
  );
  assert.deepEqual(roundTripped, buildSiteJsonLd('https://example.test'));
});
