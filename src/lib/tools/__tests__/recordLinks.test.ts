import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS, TOOL_GROUPS, toolBySlug, toolsByGroup } from '@/lib/tools/catalog';
import { toolLinksForAccount, toolLinksForRecord, type ToolLink } from '@/lib/tools/recordLinks';

const root = process.cwd();
const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';

/** The component a tool's page renders, read as text. */
function componentSource(slug: string): string {
  const page = readFileSync(resolve(root, `src/app/tools/${slug}/page.tsx`), 'utf8');
  const match = page.match(/from '@\/components\/tools\/([A-Za-z]+)'/);
  assert.ok(match, `the ${slug} page imports its component from src/components/tools`);
  return readFileSync(resolve(root, `src/components/tools/${match[1]}.tsx`), 'utf8');
}

/**
 * The explorer builds links into tools by hand (`?post=`, `?actor=`), and a
 * tool is free to rename the parameter it reads. Nothing would fail if the
 * two drifted: the link would open the tool with an empty field. So each
 * link's parameter has to appear among the keys its tool reads.
 */
function assertToolReadsItsParameter(link: ToolLink) {
  const url = new URL(link.href, 'https://aturi.to');
  assert.equal(url.pathname, `/tools/${link.slug}`);
  const [param] = [...url.searchParams.keys()];
  const source = componentSource(link.slug);
  const keys = source.match(/useToolQuery\(\[([^\]]*)\]/);
  assert.ok(keys, `${link.slug} reads its input with useToolQuery`);
  assert.ok(
    keys[1].includes(`'${param}'`),
    `${link.slug} is linked with ?${param}=, but reads ${keys[1].trim()}`,
  );
}

test('every catalog entry has a page, and every page a catalog entry', () => {
  const pages = readdirSync(resolve(root, 'src/app/tools'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(pages, TOOLS.map((tool) => tool.slug).sort());
  for (const tool of TOOLS) {
    assert.ok(existsSync(resolve(root, `src/app/tools/${tool.slug}/page.tsx`)), `${tool.slug} has a page`);
  }
});

test('catalog entries are complete and filed under a real group', () => {
  const groups = new Set(TOOL_GROUPS.map((group) => group.id));
  const slugs = new Set<string>();
  for (const tool of TOOLS) {
    assert.ok(!slugs.has(tool.slug), `${tool.slug} is listed once`);
    slugs.add(tool.slug);
    assert.match(tool.slug, /^[a-z]+$/);
    assert.ok(groups.has(tool.group), `${tool.slug} is in a known group`);
    assert.ok(tool.title && tool.desc && tool.lead, `${tool.slug} has its copy`);
    // One sentence each: they sit on tiles and in meta descriptions.
    assert.ok(tool.desc.length <= 160, `${tool.slug} description fits a meta description`);
    assert.ok(tool.desc.endsWith('.'), `${tool.slug} description is a sentence`);
  }
  assert.equal(toolsByGroup().reduce((total, entry) => total + entry.tools.length, 0), TOOLS.length);
  assert.throws(() => toolBySlug('nope'));
});

test('record links go to the tool for that kind of record', () => {
  const post = toolLinksForRecord('app.bsky.feed.post', `at://${DID}/app.bsky.feed.post/3n22yg6lg2k2f`, '3n22yg6lg2k2f');
  assert.deepEqual(post.map((link) => link.slug), ['post']);
  assert.equal(
    new URL(post[0].href, 'https://aturi.to').searchParams.get('post'),
    `at://${DID}/app.bsky.feed.post/3n22yg6lg2k2f`,
  );

  const feed = toolLinksForRecord('app.bsky.feed.generator', `at://${DID}/app.bsky.feed.generator/whats-hot`, 'whats-hot');
  assert.deepEqual(feed.map((link) => link.slug), ['feed']);

  // A schema record's key is the NSID it defines.
  const schema = toolLinksForRecord('com.atproto.lexicon.schema', `at://${DID}/com.atproto.lexicon.schema/app.bsky.feed.post`, 'app.bsky.feed.post');
  assert.equal(new URL(schema[0].href, 'https://aturi.to').searchParams.get('nsid'), 'app.bsky.feed.post');

  assert.deepEqual(toolLinksForRecord('app.bsky.feed.like', `at://${DID}/app.bsky.feed.like/3n22yg6lg2k2f`, '3n22yg6lg2k2f'), []);
});

test('each record link names a parameter its tool reads', () => {
  for (const collection of ['app.bsky.feed.post', 'app.bsky.feed.generator', 'com.atproto.lexicon.schema']) {
    for (const link of toolLinksForRecord(collection, `at://${DID}/${collection}/self`, 'self')) {
      assertToolReadsItsParameter(link);
    }
  }
});

test('each account link names a parameter its tool reads', () => {
  const links = toolLinksForAccount(DID);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(new URL(link.href, 'https://aturi.to').searchParams.values().next().value, DID);
    assertToolReadsItsParameter(link);
  }
});
