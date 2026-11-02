import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS,
  COMMAND_GROUPS,
  DEFAULT_KEYBINDINGS_STATE,
  WHEN_LABELS,
  bindingConflicts,
  normalizeBinding,
} from '@/lib/keybindings';
import {
  atUriFor,
  explorePathFor,
  isLinkable,
  pageContextFromPath,
  universalPathFor,
} from '@/lib/pageContext';
import {
  looksLikeTarget,
  matchScore,
  nsidLikelihood,
  parsePaletteQuery,
  wantsLexiconSearch,
  wantsPeopleSearch,
} from '@/lib/paletteSearch';

// --- catalog ---------------------------------------------------------------

test('command ids are unique', () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every command sits in a listed group', () => {
  const groups = new Set(COMMAND_GROUPS.map((g) => g.id));
  for (const c of COMMANDS) assert.ok(groups.has(c.group), `${c.id} has unlisted group ${c.group}`);
});

test('no two commands share a default binding', () => {
  assert.deepEqual([...bindingConflicts(DEFAULT_KEYBINDINGS_STATE).keys()], []);
});

test('default bindings are already in canonical form', () => {
  for (const c of COMMANDS) {
    for (const b of c.defaultBindings) assert.equal(normalizeBinding(b), b, `${c.id}: ${b}`);
  }
});

test('every page condition has a settings label', () => {
  for (const c of COMMANDS) {
    if (c.when) assert.ok(WHEN_LABELS[c.when], `${c.id} has no label for ${c.when}`);
  }
});

test('the header’s destinations are all reachable from the palette', () => {
  // Mirrors NAV_ITEMS in Header.tsx: a page in the nav should never be
  // missing from the palette, which is how MCP went missing before.
  const required = [
    'go-explore',
    'go-lexicons',
    'go-spaces',
    'go-links',
    'go-extension',
    'go-mcp',
    'go-docs',
    'go-feedback',
  ];
  const ids = new Set<string>(COMMANDS.map((c) => c.id));
  for (const id of required) assert.ok(ids.has(id), `missing ${id}`);
});

// --- page context ----------------------------------------------------------

test('explorer record pages address the record and step up to the collection', () => {
  const ctx = pageContextFromPath('/explore/dame.is/app.bsky.feed.post/3kabc');
  assert.equal(ctx.surface, 'explorer');
  assert.deepEqual(ctx.subject, {
    repo: 'dame.is',
    collection: 'app.bsky.feed.post',
    rkey: '3kabc',
  });
  assert.equal(ctx.parentPath, '/explore/dame.is/app.bsky.feed.post');
});

test('explorer levels step up one at a time', () => {
  assert.equal(pageContextFromPath('/explore/did:plc:abc/app.bsky.graph.follow').parentPath, '/explore/did:plc:abc');
  assert.equal(pageContextFromPath('/explore/did:plc:abc').parentPath, '/explore');
  assert.equal(pageContextFromPath('/explore').parentPath, null);
});

test('explorer sections are not repos', () => {
  for (const path of ['/explore/lexicons', '/explore/spaces', '/explore/pds/pds.example.com']) {
    const ctx = pageContextFromPath(path);
    assert.equal(ctx.subject, null, path);
    assert.equal(ctx.parentPath, '/explore', path);
  }
  assert.equal(pageContextFromPath('/explore/lexicons/app.bsky.feed.post').parentPath, '/explore/lexicons');
  assert.equal(pageContextFromPath('/explore/lexicons/group/app.bsky').parentPath, '/explore/lexicons');
});

test('space addresses have no subject, and a space record steps up to its ref', () => {
  const record = pageContextFromPath(
    '/explore/did:plc:abc/space/com.example.space/main/did:plc:xyz/com.example.post/3kabc',
  );
  assert.equal(record.subject, null);
  assert.equal(record.parentPath, '/explore/did:plc:abc/space/com.example.space/main');
  assert.equal(
    pageContextFromPath('/explore/did:plc:abc/space/com.example.space').parentPath,
    '/explore/did:plc:abc/space',
  );
  assert.equal(pageContextFromPath('/explore/did:plc:abc/space').parentPath, '/explore/did:plc:abc');
});

test('universal links address what they link to', () => {
  assert.deepEqual(pageContextFromPath('/dame.is').subject, { repo: 'dame.is' });
  assert.deepEqual(pageContextFromPath('/@dame.is').subject, { repo: 'dame.is' });
  assert.deepEqual(pageContextFromPath('/did:plc:abc/app.bsky.feed.post/3kabc').subject, {
    repo: 'did:plc:abc',
    collection: 'app.bsky.feed.post',
    rkey: '3kabc',
  });
  assert.deepEqual(pageContextFromPath('/profile/dame.is/post/3kabc').subject, {
    repo: 'dame.is',
    collection: 'app.bsky.feed.post',
    rkey: '3kabc',
  });
  assert.deepEqual(pageContextFromPath('/profile/dame.is/lists/3kabc').subject, {
    repo: 'dame.is',
    collection: 'app.bsky.graph.list',
    rkey: '3kabc',
  });
  assert.equal(pageContextFromPath('/dame.is').surface, 'universal');
});

test('site pages are never read as handles', () => {
  for (const path of ['/', '/docs', '/mcp', '/account', '/feedback', '/links', '/terms']) {
    const ctx = pageContextFromPath(path);
    assert.equal(ctx.subject, null, path);
    assert.equal(ctx.surface, 'other', path);
  }
  // Single segments without a dot or DID prefix aren't handles either.
  assert.equal(pageContextFromPath('/nonsense').subject, null);
});

test('pages with a Markdown twin report it', () => {
  assert.equal(pageContextFromPath('/mcp').markdownPath, '/mcp.md');
  assert.equal(pageContextFromPath('/').markdownPath, '/index.md');
  assert.equal(pageContextFromPath('/explore').markdownPath, null);
});

test('subject helpers build URIs and paths', () => {
  const record = { repo: 'dame.is', collection: 'app.bsky.feed.post', rkey: '3kabc' };
  const collection = { repo: 'dame.is', collection: 'app.bsky.feed.post' };
  assert.equal(atUriFor(record), 'at://dame.is/app.bsky.feed.post/3kabc');
  assert.equal(atUriFor(collection), 'at://dame.is/app.bsky.feed.post');
  assert.equal(atUriFor({ repo: 'did:plc:abc' }), 'at://did:plc:abc');
  assert.equal(universalPathFor(record), '/dame.is/app.bsky.feed.post/3kabc');
  assert.equal(universalPathFor({ repo: 'did:plc:abc' }), '/did:plc:abc');
  assert.equal(universalPathFor(collection), null);
  assert.equal(isLinkable(collection), false);
  assert.equal(isLinkable(null), false);
  assert.equal(explorePathFor(record), '/explore/dame.is/app.bsky.feed.post/3kabc');
});

// --- query parsing and ranking ---------------------------------------------

test('prefixes pick a mode and are stripped', () => {
  assert.deepEqual(parsePaletteQuery('>theme'), { mode: 'commands', text: 'theme' });
  assert.deepEqual(parsePaletteQuery('@dame'), { mode: 'people', text: 'dame' });
  assert.deepEqual(parsePaletteQuery('# app.bsky'), { mode: 'lexicons', text: 'app.bsky' });
  assert.deepEqual(parsePaletteQuery('  toggle theme '), { mode: 'all', text: 'toggle theme' });
});

test('every term has to match somewhere', () => {
  assert.ok(matchScore('theme dark', 'Use dark theme') > 0);
  assert.equal(matchScore('theme purple', 'Use dark theme'), -1);
  assert.ok(matchScore('mcp', 'Go to MCP server') > 0);
  assert.ok(matchScore('ai', 'Go to MCP server', ['mcp', 'ai']) > 0);
});

test('exact and prefix matches outrank keyword matches', () => {
  const exact = matchScore('toggle theme', 'Toggle theme');
  const prefix = matchScore('tog', 'Toggle theme');
  const keyword = matchScore('dark', 'Toggle theme', ['dark']);
  assert.ok(exact > prefix && prefix > keyword);
});

test('initials match, scattered letters do not', () => {
  assert.ok(matchScore('gtl', 'Go to lexicons') > 0);
  assert.equal(matchScore('dame', 'Use dark theme'), -1);
});

test('only place-like text earns a "Go to" row', () => {
  assert.ok(looksLikeTarget('dame.is'));
  assert.ok(looksLikeTarget('did:plc:abc'));
  assert.ok(looksLikeTarget('at://did:plc:abc/app.bsky.feed.post/3k'));
  assert.equal(looksLikeTarget('toggle theme'), false);
  assert.equal(looksLikeTarget('settings: keyboard'), false);
  assert.equal(looksLikeTarget('settings:'), false);
});

test('NSIDs that start with a TLD read as lexicons first', () => {
  assert.equal(nsidLikelihood('app.bsky.feed.post'), 'likely');
  assert.equal(nsidLikelihood('alice.bsky.social'), 'possible');
  assert.equal(nsidLikelihood('dame.is'), 'no');
  assert.equal(nsidLikelihood('at://did:plc:abc'), 'no');
  assert.equal(nsidLikelihood('@alice.bsky.social'), 'no');
});

test('people search runs for single words and the @ mode only', () => {
  assert.ok(wantsPeopleSearch('all', 'dame'));
  assert.ok(wantsPeopleSearch('people', 'dame is'));
  assert.equal(wantsPeopleSearch('all', 'toggle theme'), false);
  assert.equal(wantsPeopleSearch('all', 'd'), false);
  assert.equal(wantsPeopleSearch('all', 'did:plc:abc'), false);
  assert.equal(wantsPeopleSearch('commands', 'dame'), false);
  assert.ok(wantsLexiconSearch('lexicons', 'app'));
  assert.equal(wantsLexiconSearch('all', 'app'), false);
});
