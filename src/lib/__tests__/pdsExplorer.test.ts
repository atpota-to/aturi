import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareAccounts,
  countFacets,
  isPdsPath,
  matchesCommit,
  matchesStatus,
  parsePdsLocation,
  pdsAddress,
  standingOf,
  statusLabel,
  type PdsLocation,
  type SortableAccount,
} from '@/lib/pdsExplorer';

const q = (s = '') => new URLSearchParams(s);
const PATH = '/explore/pds/pds.example.com';

test('knows the PDS route and nothing else', () => {
  assert.equal(isPdsPath(PATH), true);
  assert.equal(isPdsPath('/explore/pds/'), false);
  assert.equal(isPdsPath('/explore/pds'), false);
  assert.equal(isPdsPath('/explore/pds/a/b'), false);
  assert.equal(isPdsPath('/explore/alice.example'), false);
  assert.equal(isPdsPath(null), false);
});

test('a bare address names no view, and the host is decoded', () => {
  const loc = parsePdsLocation('/explore/pds/localhost%3A2583', q());
  assert.equal(loc?.host, 'localhost:2583');
  assert.equal(loc?.tab, null);
  assert.equal(loc?.status, 'all');
  assert.equal(loc?.sort, 'listed');
  assert.equal(loc?.desc, false);
  assert.equal(loc?.account, null);
});

test('any account parameter implies the accounts view', () => {
  assert.equal(parsePdsLocation(PATH, q('status=active'))?.tab, 'accounts');
  assert.equal(parsePdsLocation(PATH, q('commit=7d'))?.tab, 'accounts');
  assert.equal(parsePdsLocation(PATH, q('sort=commit'))?.tab, 'accounts');
  assert.equal(parsePdsLocation(PATH, q('account=did:plc:abc'))?.tab, 'accounts');
  // The default direction of the default order says nothing.
  assert.equal(parsePdsLocation(PATH, q('dir=asc'))?.tab, null);
});

test('account parameters are dropped from another view', () => {
  const loc = parsePdsLocation(PATH, q('tab=relays&status=active&account=did:plc:abc'));
  assert.equal(loc?.tab, 'relays');
  assert.equal(loc?.status, 'all');
  assert.equal(loc?.account, null);
});

test('unknown values are ignored, not refused', () => {
  const loc = parsePdsLocation(PATH, q('tab=nope&status=Not%20A%20Status&commit=2d&sort=size&account=alice'));
  assert.equal(loc?.tab, null);
  assert.equal(loc?.status, 'all');
  assert.equal(loc?.commit, null);
  assert.equal(loc?.sort, 'listed');
  assert.equal(loc?.account, null);
  // A status the explorer has no words for is still a status.
  assert.equal(parsePdsLocation(PATH, q('status=throttled'))?.status, 'throttled');
});

test('each order has its own natural direction', () => {
  assert.equal(parsePdsLocation(PATH, q('sort=commit'))?.desc, true);
  assert.equal(parsePdsLocation(PATH, q('sort=commit&dir=asc'))?.desc, false);
  assert.equal(parsePdsLocation(PATH, q('sort=handle'))?.desc, false);
  assert.equal(parsePdsLocation(PATH, q('sort=listed&dir=desc'))?.desc, true);
});

test('addresses are the shortest that read back the same', () => {
  const base = parsePdsLocation(PATH, q()) as PdsLocation;
  assert.equal(pdsAddress(base), PATH);
  assert.equal(pdsAddress({ ...base, tab: 'overview' }, 'overview'), PATH);
  assert.equal(pdsAddress({ ...base, tab: 'overview' }, 'accounts'), `${PATH}?tab=overview`);
  assert.equal(pdsAddress({ ...base, tab: 'accounts' }, 'overview'), `${PATH}?tab=accounts`);
  assert.equal(pdsAddress({ ...base, tab: 'accounts' }, 'accounts'), PATH);
  // A filter says "accounts" by itself.
  assert.equal(pdsAddress({ ...base, tab: 'accounts', status: 'active' }, 'overview'), `${PATH}?status=active`);
  assert.equal(pdsAddress({ ...base, tab: 'accounts', sort: 'commit', desc: true }), `${PATH}?sort=commit`);
  assert.equal(pdsAddress({ ...base, tab: 'accounts', sort: 'commit', desc: false }), `${PATH}?sort=commit&dir=asc`);
  // Another view carries no account parameters.
  assert.equal(pdsAddress({ ...base, tab: 'relays', status: 'active' }), `${PATH}?tab=relays`);
});

test('every address round-trips', () => {
  const cases = [
    '',
    'tab=overview',
    'tab=accounts',
    'tab=relays',
    'status=inactive',
    'status=deactivated&commit=dormant',
    'commit=24h&sort=handle&dir=desc',
    'sort=status&account=did:plc:abc123',
    'account=did:web:example.com',
  ];
  for (const query of cases) {
    const loc = parsePdsLocation(PATH, q(query)) as PdsLocation;
    const again = new URL(pdsAddress(loc), 'https://aturi.to');
    assert.deepEqual(parsePdsLocation(again.pathname, again.searchParams), loc, query);
  }
});

test('an account stands as listRepos says, and as active when it says nothing', () => {
  assert.equal(standingOf({ active: true }), 'active');
  assert.equal(standingOf({}), 'active');
  assert.equal(standingOf({ active: false, status: 'deactivated' }), 'deactivated');
  assert.equal(standingOf({ active: false, status: 'TakenDown' }), 'takendown');
  assert.equal(standingOf({ active: false }), 'inactive');
  assert.equal(standingOf({ status: 'suspended' }), 'suspended');
  assert.equal(statusLabel('takendown'), 'Taken down');
  assert.equal(statusLabel('throttled'), 'Throttled');
  assert.equal(statusLabel('migrating'), 'Migrating');
});

test('status filters', () => {
  assert.equal(matchesStatus('active', 'all'), true);
  assert.equal(matchesStatus('active', 'active'), true);
  assert.equal(matchesStatus('deactivated', 'active'), false);
  assert.equal(matchesStatus('deactivated', 'inactive'), true);
  assert.equal(matchesStatus('deactivated', 'deactivated'), true);
  assert.equal(matchesStatus('takendown', 'deactivated'), false);
});

test('commit windows include one another, and dormant is the rest', () => {
  const now = Date.UTC(2026, 10, 18);
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);
  assert.equal(matchesCommit(hoursAgo(2), '24h', now), true);
  assert.equal(matchesCommit(hoursAgo(2), '7d', now), true);
  assert.equal(matchesCommit(hoursAgo(30), '24h', now), false);
  assert.equal(matchesCommit(hoursAgo(24 * 200), '1y', now), true);
  assert.equal(matchesCommit(hoursAgo(24 * 400), '1y', now), false);
  assert.equal(matchesCommit(hoursAgo(24 * 400), 'dormant', now), true);
  assert.equal(matchesCommit(null, '7d', now), false);
  assert.equal(matchesCommit(null, 'dormant', now), false);
  assert.equal(matchesCommit(null, null, now), true);
});

test('each facet counts under the other facet’s choice, not its own', () => {
  const now = Date.UTC(2026, 10, 18);
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);
  const rows = [
    { standing: 'active', date: daysAgo(0.5) },
    { standing: 'active', date: daysAgo(20) },
    { standing: 'deactivated', date: daysAgo(3) },
    { standing: 'takendown', date: daysAgo(500) },
    { standing: 'active', date: null },
  ];
  const all = countFacets(rows, 'all', null, now);
  assert.equal(all.statusAll, 5);
  assert.equal(all.byStatus.get('active'), 3);
  assert.equal(all.byCommit['7d'], 2);
  assert.equal(all.byCommit['30d'], 3);
  assert.equal(all.byCommit.dormant, 1);

  const activeThisWeek = countFacets(rows, 'active', '7d', now);
  // Status counts honour the week, not "active".
  assert.equal(activeThisWeek.statusAll, 2);
  assert.equal(activeThisWeek.byStatus.get('deactivated'), 1);
  // Commit counts honour "active", not the week.
  assert.equal(activeThisWeek.commitAll, 3);
  assert.equal(activeThisWeek.byCommit['30d'], 2);
  assert.equal(activeThisWeek.byCommit.dormant, 0);
});

test('sorting keeps the unknown last and ties in the host’s order', () => {
  const row = (index: number, handle: string | null, day: number | null, standing = 'active'): SortableAccount => ({
    index,
    handle,
    standing,
    date: day === null ? null : new Date(Date.UTC(2026, 0, day)),
  });
  const rows = [row(0, 'carol.test', 3), row(1, null, null, 'deactivated'), row(2, 'alice.test', 9), row(3, 'bob.test', 3, 'takendown')];
  const order = (sort: Parameters<typeof compareAccounts>[2], desc: boolean) =>
    [...rows].sort((a, b) => compareAccounts(a, b, sort, desc)).map((r) => r.index);

  assert.deepEqual(order('listed', false), [0, 1, 2, 3]);
  assert.deepEqual(order('listed', true), [3, 2, 1, 0]);
  assert.deepEqual(order('handle', false), [2, 3, 0, 1]);
  assert.deepEqual(order('handle', true), [0, 3, 2, 1]);
  assert.deepEqual(order('commit', true), [2, 0, 3, 1]);
  assert.deepEqual(order('commit', false), [0, 3, 2, 1]);
  assert.deepEqual(order('status', false), [0, 2, 1, 3]);
});
