import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDraft,
  draftDiffersFrom,
  loadDraft,
  saveDraft,
} from '@/utils/recordDrafts';

/**
 * The composer loses a draft in one of two ways, and both are silent: storing
 * a body under the wrong key, or handing one back that the author has moved on
 * from. These cover the scoping and the two ways a draft stops being worth
 * keeping.
 */

const store = new Map<string, string>();

// A minimal localStorage, so the module under test can run outside a browser.
// Installed once; each test starts from an empty map.
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';

beforeEach(() => store.clear());

test('a draft comes back under the collection and account that saved it', () => {
  saveDraft(ME, { collection: 'a.b.one', rkey: 'k1', json: '{"text":"one"}' });
  const loaded = loadDraft(ME, 'a.b.one');
  assert.equal(loaded?.json, '{"text":"one"}');
  assert.equal(loaded?.rkey, 'k1');
});

test('collections and accounts each have their own', () => {
  saveDraft(ME, { collection: 'a.b.one', rkey: '', json: '{"n":1}' });
  saveDraft(ME, { collection: 'a.b.two', rkey: '', json: '{"n":2}' });

  assert.equal(loadDraft(ME, 'a.b.two')?.json, '{"n":2}');
  // Signing in as someone else must not surface the previous account's work.
  assert.equal(loadDraft(OTHER, 'a.b.one'), null);

  clearDraft(ME, 'a.b.one');
  assert.equal(loadDraft(ME, 'a.b.one'), null);
  assert.equal(loadDraft(ME, 'a.b.two')?.json, '{"n":2}');
});

test('emptying the body clears the draft rather than storing emptiness', () => {
  saveDraft(ME, { collection: 'a.b.one', rkey: '', json: '{"n":1}' });
  saveDraft(ME, { collection: 'a.b.one', rkey: '', json: '   ' });
  assert.equal(loadDraft(ME, 'a.b.one'), null);
});

test('an oversized draft is not kept', () => {
  // localStorage is a shared ~5MB budget the explorer also uses for
  // preferences and the write-rate ledger; an inlined blob must not eat it.
  saveDraft(ME, { collection: 'a.b.big', rkey: '', json: `{"b":"${'x'.repeat(200_000)}"}` });
  assert.equal(loadDraft(ME, 'a.b.big'), null);
});

test('a draft older than a week is dropped rather than offered back', () => {
  store.set(
    `aturi:recordDraft:${ME}:a.b.old`,
    JSON.stringify({
      collection: 'a.b.old',
      rkey: '',
      json: '{"a":1}',
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    }),
  );
  assert.equal(loadDraft(ME, 'a.b.old'), null);
  assert.equal(store.has(`aturi:recordDraft:${ME}:a.b.old`), false, 'and is cleaned up');
});

test('corrupt or foreign entries are ignored, not thrown on', () => {
  store.set(`aturi:recordDraft:${ME}:a.b.bad`, 'not json');
  assert.equal(loadDraft(ME, 'a.b.bad'), null);
  store.set(`aturi:recordDraft:${ME}:a.b.shape`, JSON.stringify({ nope: true }));
  assert.equal(loadDraft(ME, 'a.b.shape'), null);
});

test('formatting is not an edit, but a changed value is', () => {
  // The seeded template gets saved like any other body; a "restored" notice
  // over one nobody touched would be claiming work that was never done.
  assert.equal(draftDiffersFrom('{"a":1,"b":2}', '{"b":2,"a":1}'), false);
  assert.equal(draftDiffersFrom('{\n  "a": 1\n}\n', '{"a":1}'), false);
  assert.equal(draftDiffersFrom('{"a":2}', '{"a":1}'), true);
  // Neither side parsing falls back to a text comparison rather than throwing.
  assert.equal(draftDiffersFrom('{ broken', '{ broken '), false);
  assert.equal(draftDiffersFrom('{ broken', '{"a":1}'), true);
});
