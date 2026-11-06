import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLinkingRecord, hasNoContext, listKind } from '@/utils/atproto/backlinkDetails';

test('a starter pack reads as its name', () => {
  assert.deepEqual(
    describeLinkingRecord('app.bsky.graph.starterpack', { name: 'Comic Artists', list: 'at://x' }),
    { kind: 'Starter pack', text: 'Comic Artists' },
  );
});

test('a document prefers its title to its body', () => {
  assert.deepEqual(
    describeLinkingRecord('site.standard.document', { title: 'Release notes', text: 'Long body' }),
    { kind: 'Document', text: 'Release notes' },
  );
});

test('an unknown record type keeps its text without a kind', () => {
  assert.deepEqual(
    describeLinkingRecord('place.stream.chat.message', { text: '  hello\n\n there ' }),
    { kind: null, text: 'hello there' },
  );
});

test('long text is cut with an ellipsis', () => {
  const ctx = describeLinkingRecord('app.example.note', { text: 'a'.repeat(500) });
  assert.equal(ctx?.text.length, 300);
  assert.ok(ctx?.text.endsWith('…'));
});

test('a record with no words has no context', () => {
  assert.equal(describeLinkingRecord('app.example.thing', { subject: 'did:plc:x', createdAt: '2026-01-01' }), null);
  assert.equal(describeLinkingRecord('app.example.thing', null), null);
});

test('list purposes name the list', () => {
  assert.equal(listKind('app.bsky.graph.defs#curatelist'), 'List');
  assert.equal(listKind('app.bsky.graph.defs#modlist'), 'Moderation list');
  assert.equal(listKind('app.bsky.graph.defs#referencelist'), 'Starter pack list');
  assert.equal(listKind(undefined), 'List');
});

test('follows and blocks are never fetched for context', () => {
  assert.equal(hasNoContext('app.bsky.graph.follow'), true);
  assert.equal(hasNoContext('network.cosmik.follow'), true);
  assert.equal(hasNoContext('app.bsky.feed.block'), true);
  assert.equal(hasNoContext('app.bsky.graph.listitem'), false);
  assert.equal(hasNoContext('app.bsky.feed.post'), false);
});
