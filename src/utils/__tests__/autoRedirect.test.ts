import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_REDIRECT_BREADCRUMB_KEY,
  AUTO_REDIRECT_CACHE_KEY,
  BREADCRUMB_TTL_MS,
  autoRedirectCacheFor,
  effectiveFavorites,
  breadcrumbSuppresses,
  buildAutoRedirectCandidates,
  hasStayParam,
  isBackForwardNavigation,
  isSafeRedirectUrl,
  parseAutoRedirectCache,
  resolveAutoRedirect,
  resolveAutoRedirectTarget,
  waypointHost,
  type AutoRedirectCandidate,
  type AutoRedirectContext,
  type DeclaredClients,
} from '@/utils/autoRedirect';
import { buildAutoRedirectScript } from '@/lib/autoRedirectShim';
import { WAYPOINT_DESTINATIONS_DATA } from '@/utils/waypoints.data';
import {
  DEFAULT_PREFERENCES,
  mergeWithDefaults,
  preferencesAreEqual,
  setFavoriteForFamily,
  setFollowDeclaredClients,
  type Preferences,
} from '@/utils/preferences';
import {
  buildPreferredClientsRecord,
  clientFromWaypoint,
  type ClientPreference,
  type DeclaredClient,
} from '@/utils/preferredClients';

const HANDLE = 'alice.test';
const DID = 'did:plc:example000000000000000';
const RKEY = '3kexamplerkey00';

const POST: AutoRedirectContext = {
  type: 'post',
  handle: HANDLE,
  did: DID,
  collection: 'app.bsky.feed.post',
  rkey: RKEY,
};

const PROFILE: AutoRedirectContext = { type: 'profile', handle: HANDLE, did: DID };

const TANGLED: AutoRedirectContext = {
  type: 'record',
  handle: HANDLE,
  did: DID,
  collection: 'sh.tangled.repo',
  rkey: RKEY,
};

function prefsWith(patch: Partial<Preferences>): Preferences {
  return { ...DEFAULT_PREFERENCES, ...patch };
}

// --- isSafeRedirectUrl -----------------------------------------------------

test('isSafeRedirectUrl allows only http and https', () => {
  assert.equal(isSafeRedirectUrl('https://bsky.app/profile/alice.test'), true);
  assert.equal(isSafeRedirectUrl('http://example.test/x'), true);

  // The reason this function exists: a custom waypoint template comes from a
  // PDS record and auto-redirect follows it with no click.
  assert.equal(isSafeRedirectUrl('javascript:alert(1)'), false);
  assert.equal(isSafeRedirectUrl('  javascript:alert(1)'), false);
  assert.equal(isSafeRedirectUrl('JavaScript:alert(1)'), false);
  assert.equal(isSafeRedirectUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeRedirectUrl('file:///etc/passwd'), false);
  assert.equal(isSafeRedirectUrl('//evil.test/x'), false);
  assert.equal(isSafeRedirectUrl('/relative/path'), false);
  assert.equal(isSafeRedirectUrl('not a url'), false);
  assert.equal(isSafeRedirectUrl(''), false);
});

test('isSafeRedirectUrl refuses our own host, case-insensitively', () => {
  assert.equal(isSafeRedirectUrl('https://aturi.to/explore/x', 'aturi.to'), false);
  assert.equal(isSafeRedirectUrl('https://ATURI.to/explore/x', 'aturi.to'), false);
  assert.equal(isSafeRedirectUrl('https://bsky.app/x', 'aturi.to'), true);
  // Similar-but-different hosts are not ours.
  assert.equal(isSafeRedirectUrl('https://aturi.to.evil.test/x', 'aturi.to'), true);
});

// --- buildAutoRedirectCandidates ------------------------------------------

test('candidates for a bsky post include bluesky clients and generic explorers', () => {
  const ids = buildAutoRedirectCandidates(POST).map((c) => c.id);
  assert.ok(ids.includes('bluesky'), 'bsky.app should be a candidate for a post');
  // PDSls declares no expectedCollections and joins the atproto-explorer
  // family, so it can render any record — including this one.
  assert.ok(ids.includes('pdsls'), 'pdsls should be reachable via its family');
});

test('a waypoint that opts out of redirects is never a candidate', () => {
  // An empty `redirectCompat` is the catalog's explicit opt-out.
  assert.equal(WAYPOINT_DESTINATIONS_DATA.taproot.redirectCompat.length, 0);
  const ids = buildAutoRedirectCandidates({
    type: 'record',
    handle: HANDLE,
    did: DID,
    collection: 'com.example.thing',
    rkey: RKEY,
  }).map((c) => c.id);
  assert.ok(!ids.includes('taproot'));
});

test('candidates respect the collection a waypoint claims', () => {
  const postIds = buildAutoRedirectCandidates(POST).map((c) => c.id);
  assert.ok(
    !postIds.includes('tangled'),
    'Tangled declares sh.tangled.* and must not claim a bsky post',
  );

  const tangledIds = buildAutoRedirectCandidates(TANGLED).map((c) => c.id);
  assert.ok(
    !tangledIds.includes('bluesky'),
    'a bsky client must not claim an sh.tangled record',
  );
});

test('candidates respect the record type a waypoint supports', () => {
  for (const candidate of buildAutoRedirectCandidates(PROFILE)) {
    assert.ok(
      candidate.url.length > 0,
      `${candidate.id} produced an empty URL for a profile`,
    );
  }
  // Every candidate must carry at least one family, or it could never win.
  for (const candidate of buildAutoRedirectCandidates(POST)) {
    assert.ok(candidate.families.length > 0, `${candidate.id} has no families`);
  }
});

test('candidates drop waypoints served from our own host', () => {
  const host = waypointHost('aturiExplore');
  assert.ok(host, 'Aturi Explore should resolve to a host');
  const ids = buildAutoRedirectCandidates(POST, host as string).map((c) => c.id);
  assert.ok(
    !ids.includes('aturiExplore'),
    'a waypoint on our own host would redirect the page to itself',
  );
});

// --- resolveAutoRedirectTarget --------------------------------------------

const CANDIDATES: AutoRedirectCandidate[] = [
  { id: 'alpha', url: 'https://alpha.test/x', families: ['bluesky-social'] },
  { id: 'beta', url: 'https://beta.test/x', families: ['pinksky'] },
  { id: 'gamma', url: 'https://gamma.test/x', families: ['tangled'] },
];

test('no favorites means no redirect', () => {
  assert.equal(resolveAutoRedirectTarget({}, CANDIDATES), null);
  assert.equal(resolveAutoRedirectTarget(undefined, CANDIDATES), null);
});

test('COMPAT_FAMILY_ORDER breaks a tie between two claiming families', () => {
  // Both families can render an app.bsky.feed.post; bluesky-social is ordered
  // first, so a user with a favorite in both gets their Bluesky client.
  const target = resolveAutoRedirectTarget(
    { pinksky: 'beta', 'bluesky-social': 'alpha' },
    CANDIDATES,
  );
  assert.equal(target?.waypointId, 'alpha');
  assert.equal(target?.family, 'bluesky-social');
  assert.equal(target?.url, 'https://alpha.test/x');
});

test('a favorite that cannot render this page is skipped for the next family', () => {
  const target = resolveAutoRedirectTarget(
    { 'bluesky-social': 'not-a-candidate', tangled: 'gamma' },
    CANDIDATES,
  );
  assert.equal(target?.waypointId, 'gamma');
});

test('a stale favorite whose waypoint left the family is skipped', () => {
  // `alpha` is saved under `tangled`, but only declares `bluesky-social`.
  // Honouring it would inherit an unrelated redirect from a stale preference.
  assert.equal(resolveAutoRedirectTarget({ tangled: 'alpha' }, CANDIDATES), null);
});

test('an empty or null favorite is treated as absent', () => {
  assert.equal(resolveAutoRedirectTarget({ 'bluesky-social': null }, CANDIDATES), null);
  assert.equal(resolveAutoRedirectTarget({ 'bluesky-social': '' }, CANDIDATES), null);
});

// --- resolveAutoRedirect (full, prefs-driven) ------------------------------

test('the master switch gates everything', () => {
  const off = prefsWith({
    autoRedirect: false,
    favoriteByFamily: { 'bluesky-social': 'bluesky' },
  });
  assert.equal(resolveAutoRedirect(off, POST), null);

  const on = prefsWith({
    autoRedirect: true,
    favoriteByFamily: { 'bluesky-social': 'bluesky' },
  });
  const target = resolveAutoRedirect(on, POST);
  assert.equal(target?.waypointId, 'bluesky');
  assert.ok(target?.url.startsWith('https://bsky.app/'));
});

test('a custom waypoint that declares a family can win', () => {
  const prefs = prefsWith({
    autoRedirect: true,
    customWaypoints: [
      {
        id: 'custom:mine',
        name: 'Mine',
        supportedTypes: ['post'],
        templates: { post: 'https://mine.test/{handle}/{rkey}' },
        redirectCompat: ['bluesky-social'],
      },
    ],
    favoriteByFamily: { 'bluesky-social': 'custom:mine' },
  });
  const target = resolveAutoRedirect(prefs, POST);
  assert.equal(target?.waypointId, 'custom:mine');
  assert.equal(target?.url, `https://mine.test/${HANDLE}/${RKEY}`);
});

test('a custom waypoint declaring no family is never a destination', () => {
  const prefs = prefsWith({
    autoRedirect: true,
    customWaypoints: [
      {
        id: 'custom:mine',
        name: 'Mine',
        supportedTypes: ['post'],
        templates: { post: 'https://mine.test/{handle}/{rkey}' },
      },
    ],
    favoriteByFamily: { 'bluesky-social': 'custom:mine' },
  });
  assert.equal(resolveAutoRedirect(prefs, POST), null);
});

test('an unsafe custom template never becomes a target', () => {
  const prefs = prefsWith({
    autoRedirect: true,
    customWaypoints: [
      {
        id: 'custom:evil',
        name: 'Evil',
        supportedTypes: ['post'],
        templates: { post: 'javascript:alert({rkey})' },
        redirectCompat: ['bluesky-social'],
      },
    ],
    favoriteByFamily: { 'bluesky-social': 'custom:evil' },
  });
  assert.equal(resolveAutoRedirect(prefs, POST), null);
});

// --- suppression -----------------------------------------------------------

test('hasStayParam recognises the escape hatch only when set to 1', () => {
  assert.equal(hasStayParam('?stay=1'), true);
  assert.equal(hasStayParam('?a=b&stay=1'), true);
  assert.equal(hasStayParam('?stay=0'), false);
  assert.equal(hasStayParam('?stay'), false);
  assert.equal(hasStayParam(''), false);
});

test('isBackForwardNavigation reads the first navigation entry', () => {
  assert.equal(isBackForwardNavigation([{ type: 'back_forward' }]), true);
  assert.equal(isBackForwardNavigation([{ type: 'navigate' }]), false);
  assert.equal(isBackForwardNavigation([]), false);
  assert.equal(isBackForwardNavigation(undefined), false);
});

test('a breadcrumb suppresses the same path until it expires', () => {
  const now = 1_700_000_000_000;
  const fresh = JSON.stringify({ p: '/profile/alice.test', t: now - 1000 });
  assert.equal(breadcrumbSuppresses(fresh, '/profile/alice.test', now), true);
  assert.equal(breadcrumbSuppresses(fresh, '/profile/bob.test', now), false);

  const stale = JSON.stringify({ p: '/profile/alice.test', t: now - BREADCRUMB_TTL_MS - 1 });
  assert.equal(breadcrumbSuppresses(stale, '/profile/alice.test', now), false);

  assert.equal(breadcrumbSuppresses(null, '/profile/alice.test', now), false);
  assert.equal(breadcrumbSuppresses('not json', '/profile/alice.test', now), false);
  assert.equal(
    breadcrumbSuppresses(JSON.stringify({ p: '/profile/alice.test' }), '/profile/alice.test', now),
    false,
  );
});

// --- cache -----------------------------------------------------------------

test('the pre-paint cache carries the switch and the favorites', () => {
  const prefs = prefsWith({
    autoRedirect: true,
    favoriteByFamily: { 'bluesky-social': 'deer', tangled: null },
  });
  assert.deepEqual(autoRedirectCacheFor(prefs), {
    enabled: true,
    byFamily: { 'bluesky-social': 'deer' },
  });
});

test('parseAutoRedirectCache rejects junk and defaults to disabled', () => {
  assert.equal(parseAutoRedirectCache('not json'), null);
  assert.deepEqual(parseAutoRedirectCache('{}'), { enabled: false, byFamily: {} });
  assert.deepEqual(
    parseAutoRedirectCache(
      JSON.stringify({ enabled: true, byFamily: { 'bluesky-social': 'deer', bogus: 'x' } }),
    ),
    { enabled: true, byFamily: { 'bluesky-social': 'deer' } },
  );
});

// --- preference plumbing ---------------------------------------------------

test('stored preferences without the new fields migrate to the safe default', () => {
  const merged = mergeWithDefaults({ colorScheme: 'moss' });
  assert.equal(merged.autoRedirect, false);
  assert.deepEqual(merged.favoriteByFamily, {});
});

test('mergeWithDefaults drops unknown families and non-string ids', () => {
  const merged = mergeWithDefaults({
    autoRedirect: true,
    favoriteByFamily: {
      'bluesky-social': 'deer',
      'not-a-family': 'deer',
      tangled: 42,
      margin: null,
    },
  } as unknown as Partial<Preferences>);
  assert.equal(merged.autoRedirect, true);
  assert.deepEqual(merged.favoriteByFamily, { 'bluesky-social': 'deer' });
});

test('a non-boolean autoRedirect is not truthy-coerced', () => {
  const merged = mergeWithDefaults({ autoRedirect: 'yes' } as unknown as Partial<Preferences>);
  assert.equal(merged.autoRedirect, false);
});

test('a custom waypoint with a malformed redirectCompat is rejected wholesale', () => {
  const merged = mergeWithDefaults({
    customWaypoints: [
      {
        id: 'custom:bad',
        name: 'Bad',
        supportedTypes: ['post'],
        templates: { post: 'https://x.test/{rkey}' },
        redirectCompat: 'bluesky-social',
      },
    ],
  } as unknown as Partial<Preferences>);
  assert.equal(merged.customWaypoints.length, 0);
});

test('preferencesAreEqual notices a changed favorite', () => {
  const a = prefsWith({ autoRedirect: true });
  const b = setFavoriteForFamily(a, 'bluesky-social', 'deer');
  assert.equal(preferencesAreEqual(a, b), false);
  assert.equal(preferencesAreEqual(b, { ...b }), true);

  // Clearing returns to the original shape rather than storing a null.
  const cleared = setFavoriteForFamily(b, 'bluesky-social', null);
  assert.deepEqual(cleared.favoriteByFamily, {});
  assert.equal(preferencesAreEqual(a, cleared), true);
});

test('favoriteByFamily serializes in a stable key order', () => {
  const one = setFavoriteForFamily(
    setFavoriteForFamily(prefsWith({}), 'tangled', 'tangled'),
    'bluesky-social',
    'deer',
  );
  const two = setFavoriteForFamily(
    setFavoriteForFamily(prefsWith({}), 'bluesky-social', 'deer'),
    'tangled',
    'tangled',
  );
  assert.equal(
    JSON.stringify(one.favoriteByFamily),
    JSON.stringify(two.favoriteByFamily),
    'insertion order must not read as a change and trigger a PDS write',
  );
});

// --- the inline script agrees with the resolver ----------------------------

type ScriptResult = {
  replaced: string | null;
  attribute: string | null;
  breadcrumb: string | null;
};

/**
 * Run `buildAutoRedirectScript`'s output against stub globals. The inline
 * script is a hand-written copy of `resolveAutoRedirectTarget`'s rules, so the
 * only thing keeping the two honest is executing them side by side.
 */
function runScript(
  candidates: AutoRedirectCandidate[],
  opts: {
    cache?: unknown;
    search?: string;
    pathname?: string;
    navigationType?: string;
    breadcrumb?: string | null;
  } = {},
): ScriptResult {
  const source = buildAutoRedirectScript(candidates);
  const result: ScriptResult = { replaced: null, attribute: null, breadcrumb: null };

  const local = new Map<string, string>();
  if (opts.cache !== undefined) {
    local.set(AUTO_REDIRECT_CACHE_KEY, JSON.stringify(opts.cache));
  }
  const session = new Map<string, string>();
  if (opts.breadcrumb) session.set(AUTO_REDIRECT_BREADCRUMB_KEY, opts.breadcrumb);

  const documentElement = {
    setAttribute(name: string, value: string) {
      if (name === 'data-autoredirect') result.attribute = value;
    },
    getAttribute(name: string) {
      return name === 'data-autoredirect' ? result.attribute : null;
    },
    removeAttribute(name: string) {
      if (name === 'data-autoredirect') result.attribute = null;
    },
  };

  const scope = {
    document: { documentElement },
    window: {
      location: {
        search: opts.search ?? '',
        pathname: opts.pathname ?? '/profile/alice.test',
        replace(url: string) {
          result.replaced = url;
        },
      },
    },
    performance: {
      getEntriesByType: (kind: string) =>
        kind === 'navigation' ? [{ type: opts.navigationType ?? 'navigate' }] : [],
    },
    localStorage: {
      getItem: (k: string) => local.get(k) ?? null,
      setItem: (k: string, v: string) => void local.set(k, v),
    },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => {
        session.set(k, v);
        if (k === AUTO_REDIRECT_BREADCRUMB_KEY) result.breadcrumb = v;
      },
    },
    // The failsafe timer must not fire during the test; the assertions look at
    // the attribute as the script left it.
    setTimeout: () => 0,
    URLSearchParams,
    Date,
    JSON,
  };

  const keys = Object.keys(scope);
  const fn = new Function(...keys, source);
  fn(...keys.map((k) => scope[k as keyof typeof scope]));
  return result;
}

test('the inline script picks the same built-in target as the resolver', () => {
  const candidates = buildAutoRedirectCandidates(POST);
  const cases: Array<Record<string, string>> = [
    { 'bluesky-social': 'bluesky' },
    { 'bluesky-social': 'deer' },
    { pinksky: 'pinksky', 'bluesky-social': 'bluesky' },
    { 'bluesky-social': 'tangled' },
    { tangled: 'bluesky' },
    {},
  ];

  for (const favorites of cases) {
    const expected = resolveAutoRedirectTarget(favorites, candidates);
    const actual = runScript(candidates, { cache: { enabled: true, byFamily: favorites } });
    assert.equal(
      actual.replaced,
      expected?.url ?? null,
      `disagreement for ${JSON.stringify(favorites)}`,
    );
  }
});

test('the inline script does nothing when the switch is off or the cache is absent', () => {
  const candidates = buildAutoRedirectCandidates(POST);
  const favorites = { 'bluesky-social': 'bluesky' };

  const off = runScript(candidates, { cache: { enabled: false, byFamily: favorites } });
  assert.equal(off.replaced, null);
  assert.equal(off.attribute, null);

  const missing = runScript(candidates);
  assert.equal(missing.replaced, null);
  assert.equal(missing.attribute, null);
});

test('the inline script honours ?stay=1 and back/forward navigation', () => {
  const candidates = buildAutoRedirectCandidates(POST);
  const cache = { enabled: true, byFamily: { 'bluesky-social': 'bluesky' } };

  const stay = runScript(candidates, { cache, search: '?stay=1' });
  assert.equal(stay.replaced, null);
  assert.equal(stay.attribute, null, 'the page must not be left hidden');

  const back = runScript(candidates, { cache, navigationType: 'back_forward' });
  assert.equal(back.replaced, null);
  assert.equal(back.attribute, null);
});

test('the inline script honours a fresh breadcrumb for the same path', () => {
  const candidates = buildAutoRedirectCandidates(POST);
  const cache = { enabled: true, byFamily: { 'bluesky-social': 'bluesky' } };
  const pathname = '/profile/alice.test/post/3k';

  const blocked = runScript(candidates, {
    cache,
    pathname,
    breadcrumb: JSON.stringify({ p: pathname, t: Date.now() }),
  });
  assert.equal(blocked.replaced, null);
  assert.equal(blocked.attribute, null);

  const otherPath = runScript(candidates, {
    cache,
    pathname,
    breadcrumb: JSON.stringify({ p: '/somewhere/else', t: Date.now() }),
  });
  assert.ok(otherPath.replaced, 'a breadcrumb for another path must not block this one');
  assert.ok(otherPath.breadcrumb, 'a redirect should leave its own breadcrumb');
});

test('the inline script waits for the gate when a custom waypoint is configured', () => {
  const candidates = buildAutoRedirectCandidates(POST);
  const result = runScript(candidates, {
    cache: { enabled: true, byFamily: { 'bluesky-social': 'custom:mine', tangled: 'bluesky' } },
  });
  // It must not skip past the custom favorite and redirect somewhere the gate
  // would not have chosen — it arms and leaves the decision to React.
  assert.equal(result.replaced, null);
  assert.equal(result.attribute, 'arming');
});

test('no waypoint URL can break out of the inline script element', () => {
  const hostile: AutoRedirectCandidate[] = [
    {
      id: 'evil',
      url: 'https://evil.test/</script><script>alert(1)</script>',
      families: ['bluesky-social'],
    },
  ];
  const source = buildAutoRedirectScript(hostile);
  assert.ok(!source.includes('</script>'), 'the payload must never emit a closing script tag');
  assert.ok(!source.includes('<script'), 'nor an opening one');

  // …and it still round-trips to the original string at runtime.
  const result = runScript(hostile, {
    cache: { enabled: true, byFamily: { 'bluesky-social': 'evil' } },
  });
  assert.equal(result.replaced, hostile[0].url);
});

// --- Declared clients ------------------------------------------------------

const ON = prefsWith({ autoRedirect: true });

function declared(preferences: ClientPreference[], platform: 'mobile' | 'desktop' = 'desktop'): DeclaredClients {
  return { record: buildPreferredClientsRecord(preferences), platform };
}

/** A Bluesky client the catalog has never heard of, known only by its templates. */
const SKYLARK: DeclaredClient = {
  url: 'https://skylark.example',
  name: 'Skylark',
  templates: {
    profile: 'https://skylark.example/u/{handle}',
    post: 'https://skylark.example/u/{handle}/p/{rkey}',
  },
};

/** An explorer outside the catalog. */
const LENS: DeclaredClient = {
  url: 'https://lens.example',
  name: 'Lens',
  templates: {
    profile: 'https://lens.example/{did}',
    record: 'https://lens.example/{did}/{collection}/{rkey}',
  },
};

test('a declared catalog client fills a family with no favorite, under its catalog id', () => {
  const blacksky = declared([{ category: 'bluesky-social', client: clientFromWaypoint('blacksky')! }]);
  assert.deepEqual(effectiveFavorites(ON, blacksky), { 'bluesky-social': 'blacksky' });
  assert.equal(
    resolveAutoRedirect(ON, POST, 'aturi.to', blacksky)?.url,
    `https://blacksky.community/profile/${HANDLE}/post/${RKEY}`,
  );
});

test('a favorite always beats the declaration, even one that cannot open the page', () => {
  const blacksky = declared([{ category: 'bluesky-social', client: clientFromWaypoint('blacksky')! }]);
  const prefs = setFavoriteForFamily(ON, 'bluesky-social', 'deer');
  assert.deepEqual(effectiveFavorites(prefs, blacksky), { 'bluesky-social': 'deer' });
  assert.equal(resolveAutoRedirect(prefs, POST, 'aturi.to', blacksky)?.waypointId, 'deer');

  // A favorite the catalog no longer has opens nothing, and the declaration
  // does not step in behind it.
  const stale = setFavoriteForFamily(ON, 'bluesky-social', 'retired-client');
  assert.equal(resolveAutoRedirect(stale, POST, 'aturi.to', blacksky), null);
});

test('followDeclaredClients off ignores the declaration; the master switch still rules', () => {
  const blacksky = declared([{ category: 'bluesky-social', client: clientFromWaypoint('blacksky')! }]);
  assert.equal(resolveAutoRedirect(setFollowDeclaredClients(ON, false), POST, 'aturi.to', blacksky), null);
  assert.equal(resolveAutoRedirect(prefsWith({ autoRedirect: false }), POST, 'aturi.to', blacksky), null);
});

test('the device decides between the mobile, desktop and general clients', () => {
  const split: ClientPreference[] = [
    {
      category: 'bluesky-social',
      client: clientFromWaypoint('bluesky')!,
      mobile: clientFromWaypoint('blacksky')!,
    },
  ];
  assert.equal(resolveAutoRedirect(ON, POST, 'aturi.to', declared(split, 'mobile'))?.waypointId, 'blacksky');
  assert.equal(resolveAutoRedirect(ON, POST, 'aturi.to', declared(split, 'desktop'))?.waypointId, 'bluesky');
});

test('a declared client outside the catalog opens what its templates and family cover', () => {
  const mine = declared([
    { category: 'bluesky-social', client: SKYLARK },
    { category: 'atproto-explorer', client: LENS },
  ]);
  assert.deepEqual(effectiveFavorites(ON, mine), {
    'bluesky-social': 'declared:bluesky-social',
    'atproto-explorer': 'declared:atproto-explorer',
  });

  const post = resolveAutoRedirect(ON, POST, 'aturi.to', mine);
  assert.equal(post?.waypointId, 'declared:bluesky-social');
  assert.equal(post?.url, `https://skylark.example/u/${HANDLE}/p/${RKEY}`);

  // A Tangled repo is outside what a Bluesky client covers, so the explorer
  // takes it, by its record template.
  const repo = resolveAutoRedirect(ON, TANGLED, 'aturi.to', mine);
  assert.equal(repo?.waypointId, 'declared:atproto-explorer');
  assert.equal(repo?.url, `https://lens.example/${DID}/sh.tangled.repo/${RKEY}`);
});

test('a template-only client counts only for the families that can scope it', () => {
  const reader = declared([{ category: 'standard-site', client: SKYLARK }]);
  assert.deepEqual(effectiveFavorites(ON, reader), {});
});

test('declared clients pass the same safety checks as everything else', () => {
  const selfLoop = declared([
    {
      category: 'atproto-explorer',
      client: { url: 'https://aturi.to', templates: { record: 'https://aturi.to/x/{collection}/{rkey}' } },
    },
  ]);
  assert.equal(resolveAutoRedirect(ON, TANGLED, 'aturi.to', selfLoop), null);

  // Aturi Explore is a catalog explorer on aturi.to: refused the same way.
  const explore = declared([{ category: 'atproto-explorer', client: clientFromWaypoint('aturiExplore')! }]);
  assert.equal(resolveAutoRedirect(ON, TANGLED, 'aturi.to', explore), null);
});

test('the pre-paint cache carries declared clients, and the script waits on template-only ones', () => {
  const mine = declared([
    { category: 'bluesky-social', client: SKYLARK },
    { category: 'atproto-explorer', client: clientFromWaypoint('pdsls')! },
  ]);
  const cache = autoRedirectCacheFor(ON, mine);
  assert.deepEqual(cache.byFamily, {
    'bluesky-social': 'declared:bluesky-social',
    'atproto-explorer': 'pdsls',
  });
  const result = runScript(buildAutoRedirectCandidates(POST), { cache });
  assert.equal(result.replaced, null);
  assert.equal(result.attribute, 'arming');
});

test('followDeclaredClients defaults on, round-trips, and counts as a change', () => {
  assert.equal(DEFAULT_PREFERENCES.followDeclaredClients, true);
  assert.equal(mergeWithDefaults({}).followDeclaredClients, true);
  assert.equal(mergeWithDefaults({ followDeclaredClients: false }).followDeclaredClients, false);
  assert.equal(
    preferencesAreEqual(DEFAULT_PREFERENCES, setFollowDeclaredClients(DEFAULT_PREFERENCES, false)),
    false,
  );
});
