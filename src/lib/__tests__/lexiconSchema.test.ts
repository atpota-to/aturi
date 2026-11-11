import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLexiconRef, summarizeLexicon, typeText } from '@/lib/lexiconSchema';

// Trimmed from the published app.bsky.feed.post and app.bsky.feed.getTimeline
// schema records.
const POST = {
  lexicon: 1,
  id: 'app.bsky.feed.post',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      description: 'Record containing a Bluesky post.',
      record: {
        type: 'object',
        required: ['text', 'createdAt'],
        properties: {
          text: { type: 'string', maxLength: 3000, maxGraphemes: 300, description: 'The primary post content.' },
          tags: { type: 'array', maxLength: 8, items: { type: 'string', maxLength: 640, maxGraphemes: 64 } },
          embed: { type: 'union', refs: ['app.bsky.embed.images', 'app.bsky.embed.record'] },
          reply: { type: 'ref', ref: '#replyRef' },
          facets: { type: 'array', items: { type: 'ref', ref: 'app.bsky.richtext.facet' } },
          labels: { type: 'union', refs: ['com.atproto.label.defs#selfLabels'] },
          entities: { type: 'array', items: { type: 'ref', ref: '#entity' }, description: 'DEPRECATED: replaced by app.bsky.richtext.facet.' },
          createdAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    replyRef: {
      type: 'object',
      required: ['root', 'parent'],
      properties: {
        root: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
        parent: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
      },
    },
    entity: { type: 'object', properties: { value: { type: 'string' } } },
  },
};

const TIMELINE = {
  id: 'app.bsky.feed.getTimeline',
  defs: {
    main: {
      type: 'query',
      description: 'Get a view of the home timeline.',
      parameters: {
        type: 'params',
        properties: {
          limit: { type: 'integer', default: 50, maximum: 100, minimum: 1 },
          cursor: { type: 'string' },
        },
      },
      output: {
        encoding: 'application/json',
        schema: {
          type: 'object',
          required: ['feed'],
          properties: {
            feed: { type: 'array', items: { type: 'ref', ref: 'app.bsky.feed.defs#feedViewPost' } },
          },
        },
      },
      errors: [{ name: 'BlockedActor' }, { description: 'no name' }],
    },
  },
};

test('reads refs against the document they appear in', () => {
  assert.deepEqual(parseLexiconRef('#replyRef', 'app.bsky.feed.post'), {
    label: '#replyRef',
    nsid: 'app.bsky.feed.post',
    def: 'replyRef',
    local: true,
  });
  assert.deepEqual(parseLexiconRef('app.bsky.richtext.facet', 'app.bsky.feed.post'), {
    label: 'app.bsky.richtext.facet',
    nsid: 'app.bsky.richtext.facet',
    def: 'main',
    local: false,
  });
  assert.equal(parseLexiconRef('com.atproto.label.defs#selfLabels', 'x.y.z').label, 'com.atproto.label.defs#selfLabels');
  assert.equal(parseLexiconRef('app.bsky.feed.post#replyRef', 'app.bsky.feed.post').local, true);
});

test('a record: its key, its fields and what each one allows', () => {
  const doc = summarizeLexicon(POST, 'app.bsky.feed.post');
  assert.ok(doc?.main);
  assert.equal(doc.description, 'Record containing a Bluesky post.');
  assert.equal(doc.main.type, 'record');
  assert.equal(doc.main.key, 'tid');
  const fields = doc.main.sections[0].fields;
  const text = fields.find((f) => f.name === 'text');
  assert.equal(text?.required, true);
  assert.deepEqual(text?.constraints, ['≤ 300 graphemes', '≤ 3,000 bytes']);
  const tags = fields.find((f) => f.name === 'tags');
  assert.equal(typeText(tags!.type), 'string[]');
  assert.deepEqual(tags?.constraints, ['≤ 8 items', 'each ≤ 64 graphemes', 'each ≤ 640 bytes']);
  assert.equal(fields.find((f) => f.name === 'createdAt')?.constraints[0], 'datetime');
  assert.equal(typeText(fields.find((f) => f.name === 'reply')!.type), '#replyRef');
  assert.equal(fields.find((f) => f.name === 'entities')?.deprecated, true);
  assert.deepEqual(
    doc.defs.map((d) => d.name),
    ['replyRef', 'entity'],
  );
});

test('lists every other lexicon referred to, once each', () => {
  const doc = summarizeLexicon(POST, 'app.bsky.feed.post');
  assert.deepEqual(doc?.references, [
    'app.bsky.embed.images',
    'app.bsky.embed.record',
    'app.bsky.richtext.facet',
    'com.atproto.label.defs',
    'com.atproto.repo.strongRef',
  ]);
});

test('a query: its parameters, output and errors', () => {
  const doc = summarizeLexicon(TIMELINE, 'app.bsky.feed.getTimeline');
  const main = doc?.main;
  assert.equal(main?.type, 'query');
  assert.deepEqual(
    main?.sections.map((s) => s.title),
    ['Parameters', 'Output'],
  );
  const limit = main?.sections[0].fields.find((f) => f.name === 'limit');
  assert.deepEqual(limit?.constraints, ['1–100', 'default 50']);
  assert.equal(main?.sections[1].encoding, 'application/json');
  assert.equal(typeText(main!.sections[1].fields[0].type), 'app.bsky.feed.defs#feedViewPost[]');
  assert.deepEqual(main?.errors, [{ name: 'BlockedActor', description: null }]);
});

test('refuses what is not a lexicon document and tolerates odd ones', () => {
  assert.equal(summarizeLexicon(null, 'a.b.c'), null);
  assert.equal(summarizeLexicon({ id: 'a.b.c' }, 'a.b.c'), null);
  const odd = summarizeLexicon({ defs: { main: { type: 'string', knownValues: ['a', 'b'] }, weird: 7 } }, 'a.b.c');
  assert.equal(odd?.id, 'a.b.c');
  assert.equal(odd?.main?.type, 'string');
  assert.deepEqual(odd?.main?.constraints, ['known: a, b']);
  assert.equal(odd?.defs[0].type, 'unknown');
});
