import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';
import {
  addScope,
  analyzeScopeString,
  formatScope,
  parseScope,
  removeScopeAt,
  splitScopes,
} from '@/lib/tools/oauthScopes';

/** Every valid example in the permission spec's "Scope String Syntax" section. */
const SPEC_EXAMPLES = [
  'identity:*',
  'identity:*?',
  'rpc?lxm=*&aud=did:web:api.example.com%23svc_appview',
  'blob?accept=video/*&accept=text/html',
  'repo:app.example.profile?action=create&action=update&action=delete',
  'include:app.example.authFull?aud=did:web:api.example.com%23svc_chat',
];

test('the spec’s own examples all read as valid', () => {
  for (const example of SPEC_EXAMPLES) {
    const scope = parseScope(example);
    assert.equal(scope.status, 'valid', `${example}: ${scope.problems.join(' ')}`);
  }
});

test('a scope written in its shortest form survives a round trip', () => {
  const canonical = [
    'repo:app.example.profile',
    'repo:*',
    'repo:*?action=delete',
    'repo:app.example.post?action=create&action=update',
    'repo?collection=app.example.profile&collection=app.example.post',
    'rpc:app.example.moderation.createReport?aud=*',
    'rpc:*?aud=did:web:api.bsky.app%23bsky_appview',
    'rpc?lxm=app.example.getFeed&lxm=app.example.getProfile&aud=did:web:api.example.com%23svc',
    'blob:*/*',
    'blob?accept=video/*&accept=text/html',
    'account:email',
    'account:email?action=manage',
    'account:repo?action=manage',
    'identity:handle',
    'identity:*',
    'include:com.example.authBasicFeatures',
    'include:com.example.authBasicFeatures?aud=did:web:api.example.com%23svc_appview',
  ];
  for (const scope of canonical) {
    const parsed = parseScope(scope);
    assert.equal(parsed.status, 'valid', `${scope}: ${parsed.problems.join(' ')}`);
    assert.ok(parsed.draft, `${scope} has no draft`);
    assert.equal(formatScope(parsed.draft), scope);
  }
});

test('the long forms of a scope are written back in the short form', () => {
  // All three actions is the default, so it is left out.
  assert.equal(
    formatScope(parseScope('repo:app.example.profile?action=create&action=update&action=delete').draft!),
    'repo:app.example.profile',
  );
  // The spec: account:repo?action=manage is the same as account?action=manage&attr=repo.
  assert.equal(formatScope(parseScope('account?action=manage&attr=repo').draft!), 'account:repo?action=manage');
  assert.equal(formatScope(parseScope('account:email?action=read').draft!), 'account:email');
  assert.equal(formatScope(parseScope('repo?collection=app.example.post').draft!), 'repo:app.example.post');
});

test('each resource says what it grants', () => {
  assert.equal(parseScope('repo:*?action=delete').meaning, 'Delete records in every collection.');
  assert.equal(
    parseScope('repo:app.bsky.feed.post').meaning,
    'Create, update and delete records in app.bsky.feed.post.',
  );
  assert.equal(
    parseScope('rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview').meaning,
    'Call app.bsky.actor.getProfile on did:web:api.bsky.app#bsky_appview.',
  );
  assert.equal(parseScope('blob:*/*').meaning, 'Upload files of any type.');
  assert.match(parseScope('account:email?action=manage').meaning, /change/);
  assert.match(parseScope('identity:handle').meaning, /handle/);
  assert.match(parseScope('atproto').meaning, /Required/);
  assert.match(parseScope('transition:generic').meaning, /app password/);
});

test('a resource the spec does not define is unknown, not invalid', () => {
  const scope = parseScope('space:*?authority=*&action=read');
  assert.equal(scope.kind, 'unknown');
  assert.equal(scope.status, 'unknown');
  assert.deepEqual(scope.problems, []);
  assert.equal(parseScope('resource').status, 'unknown');
  assert.equal(parseScope('service:did:web:com.example#type?key=val').status, 'unknown');
});

test('text outside the general syntax is invalid', () => {
  assert.equal(parseScope('resource:positional?key=québec').status, 'invalid');
  assert.equal(parseScope('emoji:☺️').status, 'invalid');
  assert.equal(parseScope('repo:%E0%A4%A').status, 'invalid');
});

test('a malformed parameter is reported', () => {
  assert.match(parseScope('repo:app.example.post?action').problems.join(' '), /name=value/);
  assert.match(parseScope('repo:app.example.post?action=').problems.join(' '), /name=value/);
  assert.match(parseScope('repo:app.example.post?verb=create').problems.join(' '), /not a parameter/);
  assert.match(parseScope('repo:app.example.post?action=read').problems.join(' '), /not an action/);
  assert.match(parseScope('repo:app.example.post?action=create&action=create').problems.join(' '), /once/);
});

test('the rules of each resource are enforced', () => {
  // The positional parameter cannot be given twice.
  assert.match(
    parseScope('repo:com.example.record?collection=com.example.other').problems.join(' '),
    /after the colon and again/,
  );
  assert.match(parseScope('repo:com.example.*').problems.join(' '), /partial wildcard/);
  assert.match(parseScope('repo:notansid').problems.join(' '), /not a valid NSID/);
  assert.match(parseScope('repo').problems.join(' '), /needs a collection/);
  assert.match(parseScope('repo:').problems.join(' '), /Nothing follows the colon/);
  // rpc always needs an audience in a scope string, and not two wildcards.
  assert.match(parseScope('rpc:app.example.getFeed').problems.join(' '), /needs aud/);
  assert.match(parseScope('rpc:*?aud=*').problems.join(' '), /cannot both be \*/);
  assert.match(parseScope('rpc:app.example.getFeed?aud=did:web:api.example.com').problems.join(' '), /service reference/);
  assert.match(parseScope('blob:images').problems.join(' '), /MIME/);
  assert.match(parseScope('account:*').problems.join(' '), /wildcard is not supported/);
  assert.match(parseScope('account:email?action=write').problems.join(' '), /read or manage/);
  assert.match(parseScope('identity:did').problems.join(' '), /handle and \*/);
  assert.match(parseScope('include:').problems.join(' '), /Name the permission set/);
  assert.match(parseScope('include:notansid').problems.join(' '), /not a valid NSID/);
  assert.match(parseScope('transition:everything').problems.join(' '), /transition:generic/);
  assert.match(parseScope('atproto:full').problems.join(' '), /no parameters/);
});

test('notes flag what is valid but worth knowing', () => {
  assert.match(parseScope('account:repo').notes.join(' '), /action=manage/);
  assert.match(parseScope('include:com.example.authBasicFeatures').notes.join(' '), /No aud/);
  assert.match(
    parseScope('rpc:app.example.getFeed?aud=did:web:api.example.com#svc').notes.join(' '),
    /%23/,
  );
});

test('a scope string is read as a whole', () => {
  const ok = analyzeScopeString('atproto repo:app.example.post blob:*/*');
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.scopes.length, 3);
  assert.ok(ok.scopes.every((scope) => scope.status === 'valid'));

  assert.match(analyzeScopeString('repo:app.example.post').problems.join(' '), /atproto scope is missing/);
  assert.match(
    analyzeScopeString('atproto transition:chat.bsky').problems.join(' '),
    /without transition:generic/,
  );
  assert.match(analyzeScopeString('atproto blob:*/* blob:*/*').notes.join(' '), /more than once/);
  assert.deepEqual(analyzeScopeString('   ').scopes, []);
  assert.deepEqual(analyzeScopeString('').problems, []);
});

test('this site’s own metadata scope reads cleanly, space permissions aside', () => {
  const analysis = analyzeScopeString(METADATA_SCOPE);
  assert.deepEqual(analysis.problems, []);
  for (const scope of analysis.scopes) {
    assert.notEqual(scope.status, 'invalid', `${scope.raw}: ${scope.problems.join(' ')}`);
    // `space:` is a proposal the permission spec does not list yet.
    assert.equal(scope.status === 'unknown', scope.raw.startsWith('space:'));
  }
});

test('adding and removing keep the string tidy', () => {
  assert.equal(addScope('', 'repo:app.example.post'), 'atproto repo:app.example.post');
  assert.equal(addScope('atproto blob:*/*', 'blob:*/*'), 'atproto blob:*/*');
  assert.equal(addScope('blob:*/*', 'identity:handle'), 'atproto blob:*/* identity:handle');
  assert.equal(removeScopeAt('atproto blob:*/* identity:handle', 1), 'atproto identity:handle');
  assert.deepEqual(splitScopes(' atproto \n blob:*/*  '), ['atproto', 'blob:*/*']);
});
