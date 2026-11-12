import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_METHODS } from '@/lib/mcp/apiManifest';
import { APPVIEW, RELAY } from '@/utils/atproto/config';
import {
  buildRequestUrl,
  cleanValues,
  curlFor,
  defaultHostFor,
  familiesOf,
  fixedOriginFor,
  formatBytes,
  formatDuration,
  groupMethods,
  isComplete,
  isParamName,
  isTextual,
  looksLikeMethodNsid,
  missingRequired,
  nextCursor,
  normalizeHostUrl,
  paramSetFromLexicon,
  pdsAccountFor,
  queriesFrom,
  readXrpcFailure,
  requestFromSearch,
  requestToSearch,
  searchMethods,
  summarizeMethodLexicon,
  withExtraParams,
  type ConsoleRequest,
} from '@/lib/tools/xrpc';

const QUERIES = queriesFrom(API_METHODS);

// A published lexicon record, as com.atproto.lexicon.schema holds one: keys
// sorted, so `required` is the only thing that says what comes first.
const AUTHOR_FEED = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'app.bsky.feed.getAuthorFeed',
  defs: {
    main: {
      type: 'query',
      description: "Get a view of an actor's 'author feed'.",
      parameters: {
        type: 'params',
        required: ['actor'],
        properties: {
          actor: { type: 'string', format: 'at-identifier' },
          cursor: { type: 'string' },
          filter: {
            type: 'string',
            default: 'posts_with_replies',
            description: 'Combinations of post/repost types to include in response.',
            knownValues: ['posts_with_replies', 'posts_no_replies'],
          },
          includePins: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
      output: { encoding: 'application/json' },
      errors: [{ name: 'BlockedActor' }, { name: 'BlockedByActor' }],
    },
  },
};

const GET_POSTS = {
  defs: {
    main: {
      type: 'query',
      parameters: {
        type: 'params',
        required: ['uris'],
        properties: { uris: { type: 'array', items: { type: 'string', format: 'at-uri' }, maxLength: 25 } },
      },
    },
  },
};

// --- the method list ---------------------------------------------------------

test('the list is the manifest’s queries and nothing else', () => {
  assert.ok(QUERIES.length > 100, `only ${QUERIES.length} queries`);
  assert.ok(QUERIES.every((method) => method.type === 'query'));
  assert.ok(QUERIES.some((method) => method.nsid === 'app.bsky.actor.getProfile'));
  assert.ok(!QUERIES.some((method) => method.nsid === 'com.atproto.repo.createRecord'));
  assert.ok(QUERIES.every((method) => looksLikeMethodNsid(method.nsid)), 'every listed NSID is well formed');
});

test('methods group by namespace, and families name the filter', () => {
  const groups = groupMethods(QUERIES);
  const feed = groups.find((group) => group.namespace === 'app.bsky.feed');
  assert.ok(feed && feed.methods.some((method) => method.nsid === 'app.bsky.feed.getAuthorFeed'));
  assert.equal(groups.reduce((sum, group) => sum + group.methods.length, 0), QUERIES.length);
  const families = familiesOf(QUERIES);
  assert.ok(families.includes('app.bsky') && families.includes('com.atproto'));
});

test('search ranks the method name first and finds a method by what it does', () => {
  assert.equal(searchMethods(QUERIES, 'getProfile')[0].nsid, 'app.bsky.actor.getProfile');
  assert.equal(searchMethods(QUERIES, 'com.atproto.repo.listRecords')[0].nsid, 'com.atproto.repo.listRecords');
  assert.ok(searchMethods(QUERIES, 'list records').some((method) => method.nsid === 'com.atproto.repo.listRecords'));
  assert.ok(searchMethods(QUERIES, 'followers').some((method) => method.nsid === 'app.bsky.graph.getFollowers'));
  assert.deepEqual(searchMethods(QUERIES, 'zzzznotamethod'), []);
  assert.equal(searchMethods(QUERIES, '', 5).length, 5);
});

test('looksLikeMethodNsid accepts method names and rejects the rest', () => {
  assert.ok(looksLikeMethodNsid('app.bsky.actor.getProfile'));
  assert.ok(looksLikeMethodNsid('blue.microcosm.identity.resolveMiniDoc'));
  assert.ok(!looksLikeMethodNsid('getProfile'));
  assert.ok(!looksLikeMethodNsid('bsky.app'));
  assert.ok(!looksLikeMethodNsid('app.bsky.actor.get-profile'));
  assert.ok(!looksLikeMethodNsid('app..getProfile'));
  assert.ok(!looksLikeMethodNsid('https://bsky.app/xrpc/app.bsky.actor.getProfile'));
});

// --- parameters --------------------------------------------------------------

test('parameters come from the lexicon, required ones first', () => {
  const set = paramSetFromLexicon(AUTHOR_FEED, ['actor']);
  assert.equal(set.source, 'lexicon');
  assert.deepEqual(
    set.specs.map((spec) => spec.name),
    ['actor', 'cursor', 'filter', 'includePins', 'limit'],
  );
  const [actor, , filter, includePins, limit] = set.specs;
  assert.deepEqual([actor.kind, actor.required, actor.format], ['string', true, 'at-identifier']);
  assert.deepEqual(filter.knownValues, ['posts_with_replies', 'posts_no_replies']);
  assert.equal(filter.defaultValue, 'posts_with_replies');
  assert.deepEqual([includePins.kind, includePins.defaultValue], ['boolean', 'false']);
  assert.deepEqual([limit.kind, limit.minimum, limit.maximum, limit.defaultValue], ['integer', 1, 100, '50']);
});

test('an array parameter knows what its items are', () => {
  const [uris] = paramSetFromLexicon(GET_POSTS, []).specs;
  assert.deepEqual([uris.kind, uris.itemKind, uris.format, uris.required, uris.maxLength], ['array', 'string', 'at-uri', true, 25]);
});

test('without a lexicon the names alone make text fields', () => {
  const set = paramSetFromLexicon(null, ['limit', 'cursor']);
  assert.equal(set.source, 'names');
  assert.deepEqual(
    set.specs.map((spec) => [spec.name, spec.kind, spec.required]),
    [
      ['limit', 'unknown', false],
      ['cursor', 'unknown', false],
    ],
  );
  // A lexicon with no parameters at all is still a lexicon: nothing to fill in.
  assert.deepEqual(paramSetFromLexicon({ defs: { main: { type: 'query' } } }, ['x']), { source: 'lexicon', specs: [] });
});

test('summarizeMethodLexicon reads the type, the output and the named errors', () => {
  assert.deepEqual(summarizeMethodLexicon(AUTHOR_FEED), {
    type: 'query',
    description: "Get a view of an actor's 'author feed'.",
    outputEncoding: 'application/json',
    errors: [
      { name: 'BlockedActor', description: undefined },
      { name: 'BlockedByActor', description: undefined },
    ],
  });
  assert.equal(summarizeMethodLexicon({}).type, null);
});

test('cleanValues and missingRequired ignore blanks', () => {
  assert.deepEqual(cleanValues({ a: [' x ', ''], b: ['  '], c: [] }), { a: ['x'] });
  const { specs } = paramSetFromLexicon(AUTHOR_FEED, []);
  assert.deepEqual(missingRequired(specs, {}), ['actor']);
  assert.deepEqual(missingRequired(specs, { actor: ['  '] }), ['actor']);
  assert.deepEqual(missingRequired(specs, { actor: ['bsky.app'] }), []);
});

test('a parameter the lexicon does not list still gets a field', () => {
  const { specs } = paramSetFromLexicon(AUTHOR_FEED, []);
  assert.equal(withExtraParams(specs, { actor: ['bsky.app'] }), specs);
  const fields = withExtraParams(specs, { actor: ['bsky.app'], zeta: ['1'], alpha: [''] });
  assert.deepEqual(
    fields.slice(specs.length).map((spec) => [spec.name, spec.kind, spec.extra]),
    [
      ['alpha', 'unknown', true],
      ['zeta', 'unknown', true],
    ],
  );
  assert.ok(isParamName('includePins'));
  assert.ok(isParamName('wanted_dids'));
  assert.ok(!isParamName(''));
  assert.ok(!isParamName('p.actor'));
  assert.ok(!isParamName('a b'));
  assert.ok(!isParamName('1st'));
});

// --- hosts -------------------------------------------------------------------

test('each namespace has a sensible default host', () => {
  assert.equal(defaultHostFor('app.bsky.actor.getProfile'), 'appview');
  assert.equal(defaultHostFor('com.atproto.identity.resolveHandle'), 'appview');
  assert.equal(defaultHostFor('com.atproto.repo.listRecords'), 'pds');
  assert.equal(defaultHostFor('com.atproto.sync.getRepoStatus'), 'pds');
  assert.equal(defaultHostFor('com.atproto.server.describeServer'), 'pds');
  assert.equal(defaultHostFor('com.atproto.sync.getHostStatus'), 'relay');
  assert.equal(defaultHostFor('com.atproto.sync.listReposByCollection'), 'relay');
  // Served by whoever runs the feed, the labeler or the Ozone instance.
  assert.equal(defaultHostFor('app.bsky.feed.getFeedSkeleton'), 'other');
  assert.equal(defaultHostFor('com.atproto.label.queryLabels'), 'other');
  assert.equal(defaultHostFor('tools.ozone.moderation.queryEvents'), 'other');
  assert.equal(defaultHostFor('blue.microcosm.identity.resolveMiniDoc'), 'other');
  assert.equal(fixedOriginFor('appview'), APPVIEW);
  assert.equal(fixedOriginFor('relay'), RELAY);
  assert.equal(fixedOriginFor('pds'), null);
  // The three relay methods are real queries in the index, not guesses.
  for (const nsid of ['com.atproto.sync.getHostStatus', 'com.atproto.sync.listHosts', 'com.atproto.sync.listReposByCollection']) {
    assert.ok(QUERIES.some((method) => method.nsid === nsid), `${nsid} is not in the manifest`);
  }
});

test('normalizeHostUrl turns a typed host into an origin', () => {
  assert.deepEqual(normalizeHostUrl('pds.example.com'), { ok: true, origin: 'https://pds.example.com' });
  assert.deepEqual(normalizeHostUrl(' https://pds.example.com/xrpc/x?y=1 '), { ok: true, origin: 'https://pds.example.com' });
  assert.deepEqual(normalizeHostUrl('http://localhost:2583'), { ok: true, origin: 'http://localhost:2583' });
  assert.equal(normalizeHostUrl('http://pds.example.com').ok, false);
  assert.equal(normalizeHostUrl('ftp://pds.example.com').ok, false);
  assert.equal(normalizeHostUrl('https://user:pw@pds.example.com').ok, false);
  assert.equal(normalizeHostUrl('').ok, false);
  assert.equal(normalizeHostUrl('not a host').ok, false);
});

// --- the link ----------------------------------------------------------------

test('a request survives the trip through the query string', () => {
  const request: ConsoleRequest = {
    method: 'app.bsky.feed.getPosts',
    host: 'appview',
    acct: '',
    url: '',
    params: { uris: ['at://did:plc:a/app.bsky.feed.post/1', 'at://did:plc:a/app.bsky.feed.post/2'] },
  };
  const search = requestToSearch(request);
  // The default host is left out, and a list repeats its key.
  assert.equal(
    search,
    'method=app.bsky.feed.getPosts&p.uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F1&p.uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F2',
  );
  assert.deepEqual(requestFromSearch(new URLSearchParams(search)), request);
});

test('host, acct and url are written only where they mean something', () => {
  const base = { method: 'com.atproto.repo.listRecords', params: { repo: ['bsky.app'], collection: ['app.bsky.feed.post'] } };
  assert.equal(
    requestToSearch({ ...base, host: 'pds', acct: '', url: 'https://ignored.example' }),
    'method=com.atproto.repo.listRecords&p.collection=app.bsky.feed.post&p.repo=bsky.app',
  );
  assert.match(requestToSearch({ ...base, host: 'pds', acct: 'jay.bsky.team', url: '' }), /&acct=jay\.bsky\.team&/);
  const other = requestToSearch({ ...base, host: 'other', acct: 'ignored', url: 'https://pds.example.com' });
  assert.match(other, /host=other&url=https%3A%2F%2Fpds\.example\.com/);
  assert.doesNotMatch(other, /acct=/);
  assert.equal(requestToSearch({ method: '', host: 'appview', acct: '', url: '', params: {} }), '');
});

test('a link with no host gets the method’s default, and a method’s own names cannot collide', () => {
  const request = requestFromSearch(new URLSearchParams('method=com.atproto.sync.getHostStatus&p.hostname=bsky.social&host=nonsense&p.host=x&p.=y'));
  assert.equal(request.host, 'relay');
  assert.deepEqual(request.params, { hostname: ['bsky.social'], host: ['x'] });
});

test('a PDS request goes to the named account, or the repo it is about', () => {
  assert.equal(pdsAccountFor({ acct: '@jay.bsky.team', params: { repo: ['bsky.app'] } }), 'jay.bsky.team');
  assert.equal(pdsAccountFor({ acct: '', params: { repo: ['bsky.app'] } }), 'bsky.app');
  assert.equal(pdsAccountFor({ acct: '', params: { did: ['did:plc:abc'] } }), 'did:plc:abc');
  assert.equal(pdsAccountFor({ acct: '', params: { limit: ['5'] } }), null);
});

test('a linked request is sent on its own only when nothing is missing', () => {
  const set = paramSetFromLexicon(AUTHOR_FEED, []);
  const request = (overrides: Partial<ConsoleRequest>): ConsoleRequest => ({
    method: 'app.bsky.feed.getAuthorFeed',
    host: 'appview',
    acct: '',
    url: '',
    params: { actor: ['bsky.app'] },
    ...overrides,
  });
  assert.equal(isComplete(request({}), set), true);
  assert.equal(isComplete(request({ params: {} }), set), false);
  assert.equal(isComplete(request({ method: '' }), set), false);
  // The lexicon has not arrived, or never will: nothing is known to be optional.
  assert.equal(isComplete(request({}), null), false);
  assert.equal(isComplete(request({}), paramSetFromLexicon(null, ['actor'])), false);
  // A host that has to be resolved or typed needs something to go on.
  assert.equal(isComplete(request({ host: 'pds' }), set), true);
  assert.equal(isComplete(request({ host: 'pds', params: { actor: [''] } }), set), false);
  assert.equal(isComplete(request({ host: 'other' }), set), false);
  assert.equal(isComplete(request({ host: 'other', url: 'pds.example.com' }), set), true);
});

// --- the request and the response ---------------------------------------------

test('buildRequestUrl orders parameters by the lexicon and repeats a list', () => {
  const { specs } = paramSetFromLexicon(AUTHOR_FEED, []);
  assert.equal(
    buildRequestUrl('https://public.api.bsky.app/', 'app.bsky.feed.getAuthorFeed', { limit: ['5'], actor: [' bsky.app '], cursor: [''], zz: ['1'] }, specs),
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=5&zz=1',
  );
  assert.equal(
    buildRequestUrl('https://public.api.bsky.app', 'app.bsky.feed.getPosts', { uris: ['at://a/b/c', 'at://d/e/f'] }),
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fa%2Fb%2Fc&uris=at%3A%2F%2Fd%2Fe%2Ff',
  );
  assert.equal(
    buildRequestUrl('https://pds.example.com', 'com.atproto.server.describeServer', {}),
    'https://pds.example.com/xrpc/com.atproto.server.describeServer',
  );
});

test('curlFor quotes the URL for a shell', () => {
  assert.equal(curlFor('https://h.example/xrpc/a.b.c?x=1&y=2'), "curl 'https://h.example/xrpc/a.b.c?x=1&y=2'");
  assert.equal(curlFor("https://h.example/xrpc/a.b.c?q=it's"), "curl 'https://h.example/xrpc/a.b.c?q=it'\\''s'");
});

test('responses are read for failures, cursors and what can be shown', () => {
  assert.deepEqual(readXrpcFailure({ error: 'InvalidRequest', message: 'Profile not found' }), {
    error: 'InvalidRequest',
    message: 'Profile not found',
  });
  assert.deepEqual(readXrpcFailure({ error: 'AuthMissing' }), { error: 'AuthMissing', message: null });
  assert.equal(readXrpcFailure({ records: [] }), null);
  assert.equal(readXrpcFailure('nope'), null);
  assert.equal(nextCursor({ cursor: 'abc', records: [] }), 'abc');
  assert.equal(nextCursor({ cursor: '' }), null);
  assert.equal(nextCursor([]), null);
  assert.equal(isTextual('application/json; charset=utf-8'), true);
  assert.equal(isTextual('text/plain'), true);
  assert.equal(isTextual(null), true);
  assert.equal(isTextual('application/vnd.ipld.car'), false);
  assert.equal(isTextual('image/jpeg'), false);
});

test('sizes and times read at a glance', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(3276), '3.2 KB');
  assert.equal(formatBytes(48 * 1024), '48 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatDuration(142.4), '142 ms');
  assert.equal(formatDuration(2345), '2.35 s');
});
