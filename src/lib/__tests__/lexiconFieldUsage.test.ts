import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseFor,
  declaredRecordFields,
  fieldReport,
  kindOf,
  measureFieldUsage,
  percentText,
  usageByPath,
} from '@/lib/lexiconFieldUsage';
import { summarizeLexicon } from '@/lib/lexiconSchema';

// A trimmed record schema with one inline object, and records written by
// three accounts the way a lexicon's clients actually differ.
const PLAY = {
  id: 'fm.example.play',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        required: ['trackName', 'playedTime'],
        properties: {
          trackName: { type: 'string' },
          playedTime: { type: 'string', format: 'datetime' },
          duration: { type: 'integer' },
          isrc: { type: 'string' },
          source: {
            type: 'object',
            properties: { url: { type: 'string' }, client: { type: 'string' } },
          },
        },
      },
    },
  },
};

const RECORDS = [
  {
    did: 'did:plc:a',
    time_us: 3_000_000,
    record: { $type: 'fm.example.play', trackName: 'One', playedTime: 't', duration: 200, source: { url: 'u' } },
  },
  {
    did: 'did:plc:a',
    time_us: 2_000_000,
    record: { $type: 'fm.example.play', trackName: 'Two', playedTime: 't', duration: 180.5, source: { url: 'u', app: 'x' } },
  },
  { did: 'did:plc:b', time_us: 1_000_000, record: { $type: 'fm.example.play', trackName: 'Three', mood: 'calm' } },
  { did: 'did:plc:c', time_us: 4_000_000, record: { $type: 'fm.example.play', trackName: 'Four', playedTime: 't' } },
];

test('counts the records and accounts that set each field, most used first', () => {
  const sample = measureFieldUsage(RECORDS);
  assert.equal(sample.records, 4);
  assert.equal(sample.accounts, 3);
  assert.deepEqual(
    sample.fields.map((f) => [f.path, f.records, f.accounts]),
    [
      ['trackName', 4, 3],
      ['playedTime', 3, 2],
      ['duration', 2, 1],
      ['source', 2, 1],
      ['mood', 1, 1],
    ],
  );
});

test('leaves out the type marker and records that are not objects', () => {
  const sample = measureFieldUsage([...RECORDS, { did: 'did:plc:d', record: 'nope' }, { did: 'did:plc:e', record: null }]);
  assert.equal(sample.records, 4);
  assert.equal(sample.accounts, 3);
  assert.ok(!sample.fields.some((f) => f.name === '$type'));
});

test('keeps the time span of the sample', () => {
  const sample = measureFieldUsage(RECORDS);
  assert.equal(sample.newest, 4_000);
  assert.equal(sample.oldest, 1_000);
  assert.equal(measureFieldUsage([{ did: 'did:plc:a', record: {} }]).newest, null);
});

test('names each value the way the data model does', () => {
  assert.equal(kindOf('x'), 'string');
  assert.equal(kindOf(3), 'integer');
  assert.equal(kindOf(3.5), 'number');
  assert.equal(kindOf(false), 'boolean');
  assert.equal(kindOf(null), 'null');
  assert.equal(kindOf([]), 'array');
  assert.equal(kindOf({ a: 1 }), 'object');
  assert.equal(kindOf({ $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: 1 }), 'blob');
  assert.equal(kindOf({ $link: 'bafy' }), 'cid-link');
  assert.equal(kindOf({ $bytes: 'AAAA' }), 'bytes');
  assert.equal(kindOf({ $type: 'app.bsky.embed.images', images: [] }), 'app.bsky.embed.images');
});

test('lists every kind a field held, most common first', () => {
  const sample = measureFieldUsage(RECORDS);
  assert.deepEqual(sample.fields.find((f) => f.name === 'duration')?.kinds, ['integer', 'number']);
});

test('counts inside plain objects, against the records that set them', () => {
  const sample = measureFieldUsage(RECORDS);
  const source = sample.fields.find((f) => f.name === 'source')!;
  assert.deepEqual(
    source.children.map((f) => [f.path, f.records]),
    [
      ['source.url', 2],
      ['source.app', 1],
    ],
  );
  const byPath = usageByPath(sample.fields);
  assert.equal(byPath.get('source.url')?.records, 2);
  assert.equal(baseFor('source.url', sample, byPath), 2);
  assert.equal(baseFor('trackName', sample, byPath), 4);
  assert.equal(baseFor('missing.child', sample, byPath), 0);
});

test('does not count inside typed objects or arrays', () => {
  const sample = measureFieldUsage([
    {
      did: 'did:plc:a',
      record: { embed: { $type: 'app.bsky.embed.images', images: [{ alt: '' }] }, tags: [{ a: 1 }] },
    },
  ]);
  assert.deepEqual(sample.fields.map((f) => [f.name, f.children.length]), [
    ['embed', 0],
    ['tags', 0],
  ]);
});

test('stops counting three levels down', () => {
  const sample = measureFieldUsage([{ did: 'did:plc:a', record: { a: { b: { c: { d: 1 } } } } }]);
  const c = usageByPath(sample.fields).get('a.b.c');
  assert.ok(c);
  assert.deepEqual(c.children, []);
});

test('reads a record schema’s declared fields by path, inline objects included', () => {
  const declared = declaredRecordFields(summarizeLexicon(PLAY, PLAY.id));
  assert.deepEqual(
    [...declared!.values()].map((d) => [d.path, d.required]),
    [
      ['trackName', true],
      ['playedTime', true],
      ['duration', false],
      ['isrc', false],
      ['source', false],
      ['source.url', false],
      ['source.client', false],
    ],
  );
});

test('has no declared fields to compare for anything but a record', () => {
  const query = { id: 'x.y.get', defs: { main: { type: 'query' } } };
  assert.equal(declaredRecordFields(summarizeLexicon(query, query.id)), null);
  assert.equal(declaredRecordFields(null), null);
});

test('reports declared fields in the schema’s order, then what records add', () => {
  const sample = measureFieldUsage(RECORDS);
  const rows = fieldReport(sample, declaredRecordFields(summarizeLexicon(PLAY, PLAY.id)));
  assert.deepEqual(
    rows.map((r) => [r.path, r.declared, r.required, r.records, r.of]),
    [
      ['trackName', true, true, 4, 4],
      ['playedTime', true, true, 3, 4],
      ['duration', true, false, 2, 4],
      ['isrc', true, false, 0, 4],
      ['source', true, false, 2, 4],
      ['source.url', true, false, 2, 2],
      ['source.client', true, false, 0, 2],
      ['source.app', false, false, 1, 2],
      ['mood', false, false, 1, 4],
    ],
  );
});

test('reports every field seen, undeclared or not, without a schema', () => {
  const rows = fieldReport(measureFieldUsage(RECORDS), null);
  assert.deepEqual(
    rows.map((r) => [r.path, r.declared]),
    [
      ['trackName', null],
      ['playedTime', null],
      ['duration', null],
      ['source', null],
      ['source.url', null],
      ['source.app', null],
      ['mood', null],
    ],
  );
});

test('never rounds a share to a misleading 0% or 100%', () => {
  assert.equal(percentText(0, 42), '0%');
  assert.equal(percentText(42, 42), '100%');
  assert.equal(percentText(37, 42), '88%');
  assert.equal(percentText(1, 300), '<1%');
  assert.equal(percentText(299, 300), '>99%');
  assert.equal(percentText(0, 0), '–');
});
