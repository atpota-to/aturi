import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedFetchHost, toPublicHttpUrl } from '@/utils/ssrfGuard';

/**
 * The guard is a string check over `url.hostname`, so the cases that matter
 * are the spellings that reach a blocked address without matching its
 * literal text. Each case here is a host that resolves somewhere it must not.
 */

const BLOCKED: Array<[string, string]> = [
  ['localhost', 'the plain name'],
  ['localhost.', 'fully-qualified form of the same name'],
  ['LOCALHOST', 'case is normalized'],
  ['sub.localhost', 'subdomains of localhost'],
  ['thing.local', 'mDNS'],
  ['pds.internal', 'internal TLD'],
  ['127.0.0.1', 'loopback'],
  ['127.1.2.3', 'the whole loopback /8'],
  ['0.0.0.0', 'all-interfaces'],
  ['10.1.2.3', 'RFC1918 /8'],
  ['192.168.1.1', 'RFC1918 /16'],
  ['172.16.0.1', 'RFC1918 /12, low end'],
  ['172.31.255.254', 'RFC1918 /12, high end'],
  ['169.254.169.254', 'cloud metadata'],
  ['::1', 'IPv6 loopback'],
  ['[::1]', 'IPv6 loopback, bracketed'],
  ['fd00::1', 'IPv6 unique-local'],
  ['fe80::1', 'IPv6 link-local'],
  ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback, dotted'],
  ['::ffff:7f00:1', 'IPv4-mapped IPv6 loopback, hex groups'],
  ['[::ffff:a9fe:a9fe]', 'IPv4-mapped IPv6 cloud metadata'],
  ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 metadata, dotted'],
];

const ALLOWED = [
  'aturi.to',
  'public.api.bsky.app',
  'pds.atpota.to',
  'constellation.microcosm.blue',
  '8.8.8.8',
  '172.15.0.1',
  '172.32.0.1',
  '169.253.0.1',
  'fdcdn.example.com', // starts with "fd" but is a name, not an IPv6 address
  'fcbarcelona.com',
  'fe80s-revival.example',
];

test('blocks every spelling of an internal address', () => {
  for (const [host, why] of BLOCKED) {
    assert.equal(isBlockedFetchHost(host), true, `${host} should be blocked (${why})`);
  }
});

test('allows ordinary public hosts', () => {
  for (const host of ALLOWED) {
    assert.equal(isBlockedFetchHost(host), false, `${host} should be allowed`);
  }
});

test('treats an absent host as blocked', () => {
  assert.equal(isBlockedFetchHost(''), true);
  assert.equal(isBlockedFetchHost(null), true);
  assert.equal(isBlockedFetchHost(undefined), true);
});

test('alternate integer spellings are canonicalized by the URL parser', () => {
  // Decimal, hex and octal IPv4 never reach the guard in those forms: the
  // parser rewrites them first. Assert that, so nobody later "fixes" the
  // guard with redundant integer parsing.
  assert.equal(new URL('http://2130706433/').hostname, '127.0.0.1');
  assert.equal(new URL('http://0x7f000001/').hostname, '127.0.0.1');
  assert.equal(new URL('http://2852039166/').hostname, '169.254.169.254');
  for (const raw of ['http://2130706433/', 'http://0x7f000001/', 'http://2852039166/']) {
    assert.equal(toPublicHttpUrl(raw), null, `${raw} should not survive toPublicHttpUrl`);
  }
});

test('toPublicHttpUrl rejects non-http schemes and blocked hosts, keeps public ones', () => {
  assert.equal(toPublicHttpUrl('file:///etc/passwd'), null);
  assert.equal(toPublicHttpUrl('gopher://example.com/'), null);
  assert.equal(toPublicHttpUrl('http://localhost./x'), null);
  assert.equal(toPublicHttpUrl('not a url'), null);
  assert.equal(toPublicHttpUrl(''), null);
  assert.equal(toPublicHttpUrl('https://aturi.to/x')?.hostname, 'aturi.to');
});
