import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  homeScopeFor,
  isLexiconPath,
  lexiconAddress,
  parseLexiconLocation,
  type LexiconLocation,
} from '@/lib/lexiconExplorer';

const q = (s = '') => new URLSearchParams(s);

test('knows the three lexicon routes and nothing else', () => {
  assert.equal(isLexiconPath('/explore/lexicons'), true);
  assert.equal(isLexiconPath('/explore/lexicons/app.bsky.feed.post'), true);
  assert.equal(isLexiconPath('/explore/lexicons/group/app.bsky'), true);
  assert.equal(isLexiconPath('/explore/lexicons/group'), false);
  assert.equal(isLexiconPath('/explore/lexicons/group/app.bsky/extra'), false);
  assert.equal(isLexiconPath('/explore/alice.example'), false);
  assert.equal(isLexiconPath('/explore'), false);
  assert.equal(isLexiconPath(null), false);
});

test('the landing opens on the default list, or the one it names', () => {
  const landing = parseLexiconLocation('/explore/lexicons', q());
  assert.deepEqual(landing?.scope, { kind: 'list', list: 'trending' });
  assert.equal(landing?.nsid, null);
  assert.equal(landing?.window, '7d');
  assert.equal(landing?.metric, 'dids');
  assert.deepEqual(parseLexiconLocation('/explore/lexicons', q('list=new'))?.scope, { kind: 'list', list: 'new' });
  assert.deepEqual(parseLexiconLocation('/explore/lexicons', q('q=bsky'))?.scope, { kind: 'search', term: 'bsky' });
  // Unknown values are ignored, not refused.
  assert.deepEqual(parseLexiconLocation('/explore/lexicons', q('list=nope&window=2d&by=x'))?.scope, {
    kind: 'list',
    list: 'trending',
  });
});

test('the group route is a namespace with a dot and a search without one', () => {
  assert.deepEqual(parseLexiconLocation('/explore/lexicons/group/app.bsky', q())?.scope, {
    kind: 'namespace',
    prefix: 'app.bsky',
  });
  assert.deepEqual(parseLexiconLocation('/explore/lexicons/group/anisota', q())?.scope, {
    kind: 'search',
    term: 'anisota',
  });
});

test('a lexicon sits in its own namespace unless its address names another list', () => {
  const post = parseLexiconLocation('/explore/lexicons/app.bsky.feed.post', q());
  assert.equal(post?.nsid, 'app.bsky.feed.post');
  assert.deepEqual(post?.scope, { kind: 'namespace', prefix: 'app.bsky.feed' });
  assert.deepEqual(parseLexiconLocation('/explore/lexicons/app.bsky.feed.post', q('list=top'))?.scope, {
    kind: 'list',
    list: 'top',
  });
  assert.deepEqual(homeScopeFor('a.b'), { kind: 'list', list: 'trending' });
});

test('records and a peek only count with a lexicon open', () => {
  const peek = 'did:plc:abc/app.bsky.feed.post/3kabc';
  const open = parseLexiconLocation(
    '/explore/lexicons/app.bsky.feed.post',
    q(`records=1&peek=${encodeURIComponent(peek)}`),
  );
  assert.equal(open?.records, true);
  assert.deepEqual(open?.peek, { did: 'did:plc:abc', collection: 'app.bsky.feed.post', rkey: '3kabc' });
  const landing = parseLexiconLocation('/explore/lexicons', q('records=1'));
  assert.equal(landing?.records, false);
  const noRecords = parseLexiconLocation('/explore/lexicons/app.bsky.feed.post', q(`peek=${peek}`));
  assert.equal(noRecords?.peek, null);
});

test('addresses are the shortest spelling that reads back the same', () => {
  const base: LexiconLocation = {
    scope: { kind: 'list', list: 'trending' },
    nsid: null,
    records: false,
    peek: null,
    window: '7d',
    metric: 'dids',
  };
  assert.equal(lexiconAddress(base), '/explore/lexicons');
  assert.equal(lexiconAddress({ ...base, scope: { kind: 'list', list: 'top' } }), '/explore/lexicons?list=top');
  assert.equal(
    lexiconAddress({ ...base, scope: { kind: 'namespace', prefix: 'app.bsky' } }),
    '/explore/lexicons/group/app.bsky',
  );
  assert.equal(lexiconAddress({ ...base, scope: { kind: 'search', term: 'grain' } }), '/explore/lexicons?q=grain');
  assert.equal(
    lexiconAddress({ ...base, nsid: 'app.bsky.feed.post', scope: { kind: 'namespace', prefix: 'app.bsky.feed' } }),
    '/explore/lexicons/app.bsky.feed.post',
  );
  assert.equal(
    lexiconAddress({ ...base, nsid: 'app.bsky.feed.post', window: '30d', metric: 'creates' }),
    '/explore/lexicons/app.bsky.feed.post?list=trending&window=30d&by=creates',
  );
});

test('every address parses back to the location it was made from', () => {
  const locations: LexiconLocation[] = [
    { scope: { kind: 'list', list: 'all' }, nsid: null, records: false, peek: null, window: '1d', metric: 'creates' },
    { scope: { kind: 'search', term: 'grain' }, nsid: 'social.grain.photo', records: false, peek: null, window: '7d', metric: 'dids' },
    {
      scope: { kind: 'namespace', prefix: 'app.bsky.feed' },
      nsid: 'app.bsky.feed.like',
      records: true,
      peek: { did: 'did:plc:abc', collection: 'app.bsky.feed.like', rkey: '3kxyz' },
      window: '30d',
      metric: 'deletes',
    },
  ];
  for (const loc of locations) {
    const address = lexiconAddress(loc);
    const url = new URL(address, 'https://aturi.to');
    assert.deepEqual(parseLexiconLocation(url.pathname, url.searchParams), loc, address);
  }
});
