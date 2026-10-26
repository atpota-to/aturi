import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MARKDOWN_VARIANTS,
  NEGOTIABLE_TYPES,
  markdownResponse,
  markdownVariantFor,
} from '@/lib/markdownVariants';

test('maps each negotiating page to its Markdown twin', () => {
  assert.equal(markdownVariantFor('/'), '/index.md');
  assert.equal(markdownVariantFor('/docs'), '/docs.md');
  assert.equal(markdownVariantFor('/about'), '/about.md');
  assert.equal(markdownVariantFor('/contact'), '/contact.md');
});

test('normalises trailing slashes but never strips the root', () => {
  assert.equal(markdownVariantFor('/about/'), '/about.md');
  assert.equal(markdownVariantFor('/about//'), '/about.md');
  assert.equal(markdownVariantFor('/'), '/index.md');
});

test('pages without a twin do not negotiate', () => {
  for (const path of ['/terms', '/explore', '/links', '/docs.md', '/about.md', '/nope']) {
    assert.equal(markdownVariantFor(path), null, `${path} should not negotiate`);
  }
});

test('is not fooled by a path that merely starts with a negotiating one', () => {
  assert.equal(markdownVariantFor('/aboutus'), null);
  assert.equal(markdownVariantFor('/docs/advanced'), null);
});

test('every Markdown twin exists as a route handler', () => {
  for (const variant of Object.values(MARKDOWN_VARIANTS)) {
    assert.ok(
      existsSync(resolve(process.cwd(), `src/app${variant}/route.ts`)),
      `${variant} is registered but has no route handler`,
    );
  }
});

test("the middleware matcher covers exactly the registry's keys", () => {
  // Next compiles `config.matcher` statically, so it can't be derived from
  // MARKDOWN_VARIANTS at runtime. If the two drift, a page either negotiates
  // without middleware ever running, or middleware runs on pages it shouldn't.
  const source = readFileSync(resolve(process.cwd(), 'src/middleware.ts'), 'utf8');
  const matcherBlock = source.slice(source.indexOf('matcher:'));
  const matcher = [...matcherBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);

  assert.deepEqual(matcher.sort(), Object.keys(MARKDOWN_VARIANTS).sort());
});

test('HTML leads the offer list so no-preference clients get HTML', () => {
  assert.equal(NEGOTIABLE_TYPES[0], 'text/html');
  assert.deepEqual([...NEGOTIABLE_TYPES], ['text/html', 'text/markdown']);
});

test('the Markdown response carries the headers caching correctness depends on', () => {
  const response = markdownResponse('# hi\n');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  // Without Accept in Vary a CDN can serve this body to a browser.
  assert.match(response.headers.get('vary') ?? '', /\bAccept\b/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('a non-200 status is passed through', () => {
  assert.equal(markdownResponse('gone', 404).status, 404);
});
