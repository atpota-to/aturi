import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDocsTools } from '@/lib/mcp/tools/docs';
import { TOOL_GROUPS } from '@/lib/mcp/catalog';
import { DOC_PAGES } from '@/lib/mcp/docsManifest';
import { GITHUB_DOC_PAGES } from '@/lib/mcp/githubDocs';
import { API_METHODS } from '@/lib/mcp/apiManifest';
import { findPassages, queryTerms, toReadableMarkdown } from '@/utils/atprotoDocs';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerDocsTools);

test('registers exactly the documentation tools the catalog documents', () => {
  const documented = TOOL_GROUPS.find((g) => g.id === 'docs')!.tools.map((t) => t.name);
  assert.deepEqual([...tools.keys()].sort(), [...documented].sort());
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds the budget`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true, tool.name);
  }
});

test('the manifests are populated and internally consistent', () => {
  assert.ok(DOC_PAGES.length > 130, `only ${DOC_PAGES.length} doc pages`);
  assert.ok(API_METHODS.length > 300, `only ${API_METHODS.length} lexicons`);

  const ids = DOC_PAGES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate doc ids');
  const nsids = API_METHODS.map((m) => m.nsid);
  assert.equal(new Set(nsids).size, nsids.length, 'duplicate nsids');

  for (const page of DOC_PAGES) {
    assert.match(page.raw, /^https:\/\/raw\.githubusercontent\.com\//, `${page.id} raw url`);
    assert.match(
      page.url,
      /^https:\/\/(atproto\.com|docs\.bsky\.app|bsky\.network)\//,
      `${page.id} public url`,
    );
    assert.ok(page.title.length > 0, `${page.id} has no title`);
  }
  for (const method of API_METHODS) {
    assert.match(method.raw, /^https:\/\/raw\.githubusercontent\.com\//, `${method.nsid} raw url`);
    // The final NSID segment is camelCase (app.bsky.actor.contentVisibilityDeclaration).
    assert.match(method.nsid, /^[a-z][a-zA-Z0-9.-]+$/, `${method.nsid} is not an NSID`);
  }
});

test('all four source sets are represented, including bsky.network', () => {
  assert.ok(DOC_PAGES.some((p) => p.source === 'atproto'), 'no atproto.com pages');
  assert.ok(DOC_PAGES.some((p) => p.source === 'bsky'), 'no docs.bsky.app pages');
  assert.ok(DOC_PAGES.some((p) => p.source === 'bps'), 'no bsky.network pages');
  assert.ok(GITHUB_DOC_PAGES.length > 0, 'no selected GitHub guides');
  // The specs are the reason this exists; a manifest without them is broken.
  for (const id of ['specs/at-uri-scheme', 'specs/lexicon', 'specs/did']) {
    assert.ok(DOC_PAGES.some((p) => p.id === id), `${id} missing from the manifest`);
  }
});

test('curated GitHub guides have valid source URLs and unique IDs', () => {
  const ids = new Set(DOC_PAGES.map((p) => p.id));
  for (const page of GITHUB_DOC_PAGES) {
    assert.equal(page.source, 'github');
    assert.ok(!ids.has(page.id), `duplicate doc id: ${page.id}`);
    ids.add(page.id);
    assert.match(page.url, /^https:\/\/github\.com\/bluesky-social\/[^/]+\/blob\/main\/[^/]+/);
    assert.match(page.raw, /^https:\/\/raw\.githubusercontent\.com\/bluesky-social\/[^/]+\/main\/[^/]+/);
  }
  for (const id of ['github/atproto', 'github/atproto-lex', 'github/oauth-client-browser',
    'github/oauth-client-node', 'github/atproto-sync', 'github/social-app', 'github/social-app-build',
    'github/jetstream', 'github/feed-generator', 'github/statusphere', 'github/proposals']) {
    assert.ok(ids.has(id), `${id} missing from the guide index`);
  }
  assert.match(GITHUB_DOC_PAGES.find((p) => p.id === 'github/proposals')!.note!, /not adopted/);
  assert.match(GITHUB_DOC_PAGES.find((p) => p.id === 'github/social-app')!.note!, /not an AT Protocol specification/);
});

test('each id prefix belongs to exactly one source', () => {
  // read_atproto_doc looks a page up by id alone, and only the two Docusaurus
  // sources carry a source prefix — atproto.com pages keep their bare slug.
  // So the day upstream adds an atproto.com section called "bsky" or "bps",
  // ids start colliding. Catch that here rather than in a wrong answer.
  const owners = new Map<string, Set<string>>();
  for (const page of [...DOC_PAGES, ...GITHUB_DOC_PAGES]) {
    const prefix = page.id.split('/')[0];
    owners.set(prefix, (owners.get(prefix) ?? new Set()).add(page.source));
  }
  for (const [prefix, sources] of owners) {
    assert.equal(sources.size, 1, `prefix "${prefix}" is used by ${[...sources].join(' and ')}`);
  }
});

test('the operational sources answer what the specs hand off to them', () => {
  // The specs describe Jetstream and the relays but do not pin down which
  // endpoints are current — that is the whole reason bsky.network is indexed.
  for (const id of ['bps/jetstream', 'bps/relay', 'bps/rate-limits']) {
    assert.ok(DOC_PAGES.some((p) => p.id === id), `${id} missing from the manifest`);
  }
});

test('docs search filters selected GitHub guides and bsky.network pages', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response('## Quick Start\nGenerate TypeScript schemas with Lexicons.');
  try {
    const schema = tools.get('search_atproto_docs')!.config.inputSchema!;
    assert.equal(schema.safeParse({ query: 'lex', source: 'github' }).success, true);
    assert.equal(schema.safeParse({ query: 'lex', source: 'bps' }).success, true);
    const github = resultBody(await tools.get('search_atproto_docs')!.handler({
      query: 'TypeScript XRPC client Lexicon', source: 'github', limit: 2,
    }));
    const results = github.results as Array<{ id: string; source: string; url: string }>;
    assert.ok(results.length > 0);
    assert.ok(results.some((page) => page.id === 'github/atproto-lex'));
    assert.ok(results.every((page) => page.source === 'github' && page.url.startsWith('https://github.com/bluesky-social/')));

    const bps = resultBody(await tools.get('search_atproto_docs')!.handler({
      query: 'Jetstream', source: 'bps', limit: 1,
    }));
    assert.ok((bps.results as Array<{ url: string }>).every((page) => page.url.startsWith('https://bsky.network/')));
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('OAuth and app-build guides can be found in GitHub-only search', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (input) => new Response(
    String(input).includes('/proposals/')
      ? '# Bluesky Proposals\nThese are informal proposals.'
      : '## Setup\nBrowser OAuth client setup and app build.',
  );
  try {
    for (const [query, id] of [
      ['oauth-client-browser', 'github/oauth-client-browser'],
      ['oauth-client-node', 'github/oauth-client-node'],
      ['firehose sync', 'github/atproto-sync'],
      ['build iOS Android', 'github/social-app-build'],
    ]) {
      const body = resultBody(await tools.get('search_atproto_docs')!.handler({ query, source: 'github', limit: 4 }));
      assert.ok((body.results as Array<{ id: string }>).some((p) => p.id === id), `${query} did not find ${id}`);
    }
    const app = resultBody(await tools.get('read_atproto_doc')!.handler({ id: 'github/social-app-build' }));
    assert.equal(app.source, 'github');
    assert.match(String(app.note), /not a guide to implementing AT Protocol/);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('read_atproto_doc returns a GitHub URL and labels proposals', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response('# Bluesky Proposals\nThese are informal proposals.');
  try {
    const result = resultBody(await tools.get('read_atproto_doc')!.handler({ id: 'github/proposals' }));
    assert.equal(result.source, 'github');
    assert.equal(result.url, 'https://github.com/bluesky-social/proposals/blob/main/README.md');
    assert.match(String(result.note), /not adopted/);
    assert.match(String(result.markdown), /informal proposals/);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('api search finds a method by name and by what it does, offline', async () => {
  const byName = resultBody(await tools.get('search_api_methods')!.handler({ query: 'getAuthorFeed' }));
  const top = (byName.methods as Array<{ nsid: string }>)[0];
  assert.equal(top.nsid, 'app.bsky.feed.getAuthorFeed');

  const byPurpose = resultBody(await tools.get('search_api_methods')!.handler({ query: 'follow' }));
  const nsids = (byPurpose.methods as Array<{ nsid: string }>).map((m) => m.nsid);
  assert.ok(nsids.some((n) => n.includes('graph.follow')), `follow search returned ${nsids.join(', ')}`);
});

test('api search narrows by kind', async () => {
  const body = resultBody(
    await tools.get('search_api_methods')!.handler({ query: 'post', type: 'record', limit: 10 }),
  );
  for (const m of body.methods as Array<{ type: string }>) {
    assert.equal(m.type, 'record');
  }
});

test('an unknown nsid is a clear not_found, offline', async () => {
  const result = await tools.get('get_api_method')!.handler({ nsid: 'com.example.not.real' });
  assert.equal(result.isError, true);
  const body = resultBody(result);
  assert.equal(body.code, 'not_found');
  assert.match(String(body.hint), /search_api_methods/);
});

test('an unknown doc id is a clear not_found, offline', async () => {
  const result = await tools.get('read_atproto_doc')!.handler({ id: 'specs/does-not-exist' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'not_found');
});

test('a query with no searchable words is rejected before any fetch', async () => {
  for (const name of ['search_atproto_docs', 'search_api_methods']) {
    const result = await tools.get(name)!.handler({ query: '# $' });
    assert.equal(result.isError, true, name);
    assert.equal(resultBody(result).code, 'invalid_parameter', name);
  }
});

test('MDX machinery is stripped before prose is searched or quoted', () => {
  const source = [
    "import Foo from './foo.mdx'",
    '',
    "export const header = {",
    "  title: 'A Spec',",
    "}",
    '',
    '# A Spec',
    '',
    'The body survives. {{ className: "lead" }}',
  ].join('\n');
  const readable = toReadableMarkdown(source);
  assert.ok(!readable.includes('import Foo'), 'import line survived');
  assert.ok(!readable.includes('export const header'), 'header export survived');
  assert.ok(!readable.includes('className'), 'MDX attribute survived');
  assert.ok(readable.includes('The body survives.'));
});

test('passages come back per heading, ranked, and capped', () => {
  const markdown = [
    '## Unrelated',
    'Nothing to see.',
    '## Record Keys',
    'A record key identifies a record within a collection. TIDs are the common form.',
    '## Also unrelated',
    'Still nothing.',
  ].join('\n');
  const passages = findPassages(markdown, queryTerms('record key tid'));
  assert.ok(passages.length >= 1);
  assert.equal(passages[0].heading, 'Record Keys');
  assert.ok(passages[0].text.includes('record key identifies'));
  assert.ok(passages.every((p) => p.text.length <= 1200));
});

test('queryTerms drops noise and keeps NSID-shaped words whole', () => {
  assert.deepEqual(queryTerms('How do I use app.bsky.feed.post?'), [
    'how',
    'do',
    'use',
    'app.bsky.feed.post',
  ]);
});
