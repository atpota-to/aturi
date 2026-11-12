import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupMemberships,
  listPurpose,
  membershipSummary,
  mergeMemberships,
  parseAccountInput,
  recordedAt,
  sortVerifications,
  verificationStanding,
  type ListInfo,
  type Membership,
  type Verification,
} from '@/lib/tools/memberships';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const CURATOR = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

function list(rkey: string, purpose: ListInfo['purpose']): ListInfo {
  return {
    uri: `at://${CURATOR}/app.bsky.graph.list/${rkey}`,
    name: `List ${rkey}`,
    purpose,
    description: null,
    avatar: null,
    memberCount: 3,
    creator: { did: CURATOR, handle: 'curator.example.com', displayName: null },
  };
}

function membership(rkey: string, info: ListInfo | null, listUri?: string | null): Membership {
  return {
    itemUri: `at://${CURATOR}/app.bsky.graph.listitem/${rkey}`,
    listUri: listUri === undefined ? (info?.uri ?? `at://${CURATOR}/app.bsky.graph.list/gone-${rkey}`) : listUri,
    addedAt: null,
    list: info,
  };
}

test('parseAccountInput takes accounts and turns posts away', () => {
  assert.deepEqual(parseAccountInput('@Alice.Example.com'), { ok: true, actor: 'alice.example.com' });
  assert.deepEqual(parseAccountInput(DID), { ok: true, actor: DID });
  assert.deepEqual(parseAccountInput('https://bsky.app/profile/alice.example.com'), {
    ok: true,
    actor: 'alice.example.com',
  });
  const post = parseAccountInput(`at://${DID}/app.bsky.feed.post/3kabc`);
  assert.equal(post.ok, false);
  assert.match(post.ok ? '' : post.reason, /belong to accounts/);
  // The label checker's wording about labels never leaks into this tool.
  const other = parseAccountInput(`at://${DID}/app.bsky.graph.follow/3kabc`);
  assert.match(other.ok ? '' : other.reason, /belong to accounts/);
  assert.equal(parseAccountInput('  ').ok, false);
});

test('listPurpose reads the three purposes from their tokens', () => {
  assert.equal(listPurpose('app.bsky.graph.defs#curatelist'), 'curate');
  assert.equal(listPurpose('app.bsky.graph.defs#modlist'), 'mod');
  assert.equal(listPurpose('app.bsky.graph.defs#referencelist'), 'reference');
  assert.equal(listPurpose('app.example.defs#somethingelse'), 'other');
  assert.equal(listPurpose(undefined), 'other');
});

test('recordedAt prefers the record’s own date and falls back to its key', () => {
  assert.equal(recordedAt('2025-05-19T20:46:59.734Z', '3lpkgxwe3gm2m'), '2025-05-19T20:46:59.734Z');
  // No usable createdAt: the TID in the record key carries the time.
  const fromKey = recordedAt('yesterday', '3lpkgxwe3gm2m');
  assert.equal(fromKey?.slice(0, 10), '2025-05-19');
  assert.equal(recordedAt(undefined, '3lpkgxwe3gm2m')?.slice(0, 10), '2025-05-19');
  assert.equal(recordedAt(undefined, 'self'), null);
});

test('mergeMemberships shows a list once, however many items name it', () => {
  const a = list('a', 'curate');
  const first = [membership('1', a), membership('2', list('b', 'mod'))];
  const merged = mergeMemberships(first, [membership('3', a), membership('4', list('c', 'curate'))]);
  assert.deepEqual(merged.map((m) => m.itemUri.split('/').pop()), ['1', '2', '4']);
  // Items whose list could not be read are told apart by their own record.
  const unread = mergeMemberships([membership('5', null, null)], [membership('6', null, null)]);
  assert.equal(unread.length, 2);
});

test('groupMemberships splits by purpose and keeps the unavailable apart', () => {
  const groups = groupMemberships([
    membership('1', list('a', 'curate')),
    membership('2', list('b', 'mod')),
    membership('3', list('c', 'reference')),
    membership('4', list('d', 'other')),
    membership('5', null),
  ]);
  assert.deepEqual(
    [groups.curate.length, groups.mod.length, groups.reference.length, groups.unavailable.length],
    [2, 1, 1, 1],
  );
});

test('verificationStanding follows the AppView, then the issuer', () => {
  const uri = `at://${CURATOR}/app.bsky.graph.verification/3kabc`;
  assert.equal(verificationStanding(uri, true, [{ uri, isValid: true }]), 'valid');
  assert.equal(verificationStanding(uri, true, [{ uri, isValid: false }]), 'stale');
  assert.equal(verificationStanding(uri, true, []), 'unlisted');
  assert.equal(verificationStanding(uri, false, []), 'untrusted');
});

test('sortVerifications lists the ones that count first, then newest first', () => {
  const make = (id: string, standing: Verification['standing'], createdAt: string): Verification => ({
    uri: `at://${CURATOR}/app.bsky.graph.verification/${id}`,
    issuer: { did: CURATOR, handle: null, displayName: null, avatar: null },
    issuerTrusted: standing !== 'untrusted',
    displayName: null,
    handle: null,
    createdAt,
    standing,
  });
  const sorted = sortVerifications([
    make('old-untrusted', 'untrusted', '2025-01-01T00:00:00.000Z'),
    make('new-untrusted', 'untrusted', '2026-01-01T00:00:00.000Z'),
    make('stale', 'stale', '2025-06-01T00:00:00.000Z'),
    make('valid', 'valid', '2024-01-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(
    sorted.map((v) => v.uri.split('/').pop()),
    ['valid', 'stale', 'new-untrusted', 'old-untrusted'],
  );
});

test('membershipSummary reads naturally at zero, one and many', () => {
  assert.equal(membershipSummary(0, 0), 'is on no lists and has no verifications');
  assert.equal(membershipSummary(1, 1), 'is on 1 list and has 1 verification');
  assert.equal(membershipSummary(12, 2), 'is on 12 lists and has 2 verifications');
  assert.equal(membershipSummary(3, null), 'is on 3 lists');
  // A count that could not be made is left out, not guessed at.
  assert.equal(membershipSummary(null, 2), 'has 2 verifications');
  assert.equal(membershipSummary(null, null), 'could not be looked up');
});
