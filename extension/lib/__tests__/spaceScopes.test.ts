/**
 * OAuth scope construction, including the three permissioned-data ("Spaces")
 * scopes: two reads and one write.
 *
 * `src/lib/oauth/scopes.ts` is a pure module with no React or Next imports,
 * and the extension's Vitest harness (node environment) is the only suite in
 * the repo that can reach `src/lib/**`, so it is tested from here via a
 * relative path even though the extension never imports it. The `@aturi`
 * alias only covers `src/utils`, hence the `../../../src/...` specifier.
 *
 * The load-bearing assertion is DEFAULT_SIGN_IN_SCOPE below: the string this
 * app sent before spaces existed, hard-coded. If adding a space scope ever
 * changes what an ordinary Bluesky sign-in requests, this fails.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_SCOPE_IDS,
  BASE_SCOPE,
  buildScopeString,
  DEFAULT_SCOPE_IDS,
  GRANULAR_SCOPES,
  hasSpaceScope,
  hasSpaceWriteScope,
  METADATA_SCOPE,
  spaceGrantLevel,
  spaceWriteActionsFor,
  type ScopeId,
} from '../../../src/lib/oauth/scopes';
import { describeSignInError } from '../../../src/lib/oauth/signInError';

const SPACE_READ_SELF = 'space:*?authority=*&action=read_self';
const SPACE_READ = 'space:*?authority=*&action=read';
const SPACE_WRITE =
  'space:*?authority=*&collection=*&action=create&action=update&action=delete';

/** The exact scope string aturi requested before permissioned data existed. */
const DEFAULT_SIGN_IN_SCOPE =
  'atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview ' +
  'repo:*?action=create repo:*?action=update repo:*?action=delete blob:*/*';

describe('METADATA_SCOPE', () => {
  it('carries all three space literals verbatim', () => {
    const tokens = METADATA_SCOPE.split(' ');
    expect(tokens).toContain(SPACE_READ_SELF);
    expect(tokens).toContain(SPACE_READ);
    expect(tokens).toContain(SPACE_WRITE);
  });

  it('serializes the write token the way the matcher formats it', () => {
    // The matcher re-sorts actions into its own order before formatting and
    // omits defaults, and the declared-vs-requested check is byte-exact — so
    // the literal has to equal what that formatter would emit, not merely
    // parse to the same thing.
    const params = new URLSearchParams();
    params.set('authority', '*');
    params.append('collection', '*');
    for (const action of ['create', 'update', 'delete']) {
      params.append('action', action);
    }
    expect(SPACE_WRITE).toBe(`space:*?${params.toString()}`);
  });

  it('leaves `*` and `:` unescaped', () => {
    // The provider compares declared against requested with plain string
    // membership, so an escaped wildcard would silently stop matching.
    expect(METADATA_SCOPE).not.toContain('%2A');
    expect(METADATA_SCOPE).not.toContain('%2a');
    expect(METADATA_SCOPE).not.toContain('%3A');
    expect(METADATA_SCOPE).not.toContain('%3a');
  });

  it('never names a concrete space type', () => {
    // A concrete NSID triggers a lexicon resolution that fails the consent
    // screen, the code exchange, and — uncaught — every later refresh.
    for (const token of METADATA_SCOPE.split(' ')) {
      if (!token.startsWith('space:')) continue;
      const positional = token.slice('space:'.length).split('?')[0];
      expect(positional).toBe('*');
    }
  });

  it('contains no duplicate tokens', () => {
    // Client-metadata validation rejects a repeated scope token outright.
    const tokens = METADATA_SCOPE.split(' ');
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('starts with `atproto`', () => {
    expect(METADATA_SCOPE.split(' ')[0]).toBe('atproto');
  });
});

describe('buildScopeString', () => {
  it('with nothing selected is exactly BASE_SCOPE', () => {
    expect(buildScopeString(new Set())).toBe(BASE_SCOPE);
  });

  it('with the picker defaults is byte-identical to the pre-spaces string', () => {
    expect(buildScopeString(DEFAULT_SCOPE_IDS)).toBe(DEFAULT_SIGN_IN_SCOPE);
  });

  it('omits every space scope from the defaults', () => {
    expect(DEFAULT_SCOPE_IDS.has('spacesSelf')).toBe(false);
    expect(DEFAULT_SCOPE_IDS.has('spacesAll')).toBe(false);
    expect(DEFAULT_SCOPE_IDS.has('spacesWrite')).toBe(false);
  });

  it('emits the write token only when it is selected', () => {
    expect(buildScopeString(new Set<ScopeId>(['spacesWrite'])).split(' ')).toContain(
      SPACE_WRITE,
    );
    expect(buildScopeString(new Set<ScopeId>(['spacesAll']))).not.toContain(
      'action=create',
    );
  });

  it('collapses read_self into read when both are selected', () => {
    const both = buildScopeString(new Set<ScopeId>(['spacesSelf', 'spacesAll']));
    expect(both.split(' ')).toContain(SPACE_READ);
    expect(both).not.toContain('action=read_self');
  });

  it('keeps read_self on its own', () => {
    const selfOnly = buildScopeString(new Set<ScopeId>(['spacesSelf']));
    expect(selfOnly.split(' ')).toContain(SPACE_READ_SELF);
    expect(selfOnly.split(' ')).not.toContain(SPACE_READ);
  });

  it('only ever emits tokens the metadata declares', () => {
    // The authorization server checks the requested scope against the
    // declared set with a plain Array.includes, so this is the invariant
    // that keeps any picker combination from being rejected outright.
    const declared = new Set(METADATA_SCOPE.split(' '));
    for (const token of buildScopeString(ALL_SCOPE_IDS).split(' ')) {
      expect(declared.has(token)).toBe(true);
    }
  });

  it('with everything selected is the metadata minus the collapsed token', () => {
    // Order is the declaration order in GRANULAR_SCOPES, and the only
    // difference from the advertised superset is the read_self collapse.
    const expected = METADATA_SCOPE.split(' ')
      .filter((t) => t !== SPACE_READ_SELF)
      .join(' ');
    expect(buildScopeString(ALL_SCOPE_IDS)).toBe(expected);
  });
});

describe('GRANULAR_SCOPES', () => {
  it('marks only the space rows default-off', () => {
    const off = GRANULAR_SCOPES.filter((s) => s.defaultOn === false).map(
      (s) => s.id,
    );
    expect(off).toEqual(['spacesSelf', 'spacesAll', 'spacesWrite']);
  });
});

describe('spaceGrantLevel', () => {
  it('reads whole-space access', () => {
    expect(spaceGrantLevel(`atproto ${SPACE_READ}`)).toBe('read');
  });

  it('reads self-only access', () => {
    expect(spaceGrantLevel(`atproto ${SPACE_READ_SELF}`)).toBe('read_self');
  });

  it('prefers read when both tokens survived', () => {
    expect(spaceGrantLevel(`${SPACE_READ_SELF} ${SPACE_READ}`)).toBe('read');
  });

  it('is null when the server stripped the space token', () => {
    expect(spaceGrantLevel('atproto repo:*?action=create')).toBeNull();
    expect(spaceGrantLevel(null)).toBeNull();
    expect(spaceGrantLevel(undefined)).toBeNull();
    expect(spaceGrantLevel('')).toBeNull();
  });

  it('treats a bare space token as a read grant', () => {
    // Omitting `action` defaults it to read plus the three write verbs.
    expect(spaceGrantLevel('atproto space:*')).toBe('read');
  });

  it('ignores a write-only space token', () => {
    expect(
      spaceGrantLevel('space:*?authority=*&collection=*&action=create'),
    ).toBeNull();
  });

  it('does not mistake a repo token for a space token', () => {
    expect(spaceGrantLevel('rpc:*?aud=did:web:x%23y repo:*?action=create')).toBeNull();
  });
});

describe('hasSpaceScope', () => {
  it('is true for any space token', () => {
    expect(hasSpaceScope(`atproto ${SPACE_READ_SELF}`)).toBe(true);
    expect(hasSpaceScope('space:*?authority=*&action=create')).toBe(true);
  });

  it('is false otherwise', () => {
    expect(hasSpaceScope(DEFAULT_SIGN_IN_SCOPE)).toBe(false);
    expect(hasSpaceScope(null)).toBe(false);
  });
});

describe('spaceWriteActionsFor', () => {
  const COLLECTION = 'my.bulletin.post';

  it('reads all three verbs off the granted write token', () => {
    expect([...spaceWriteActionsFor(SPACE_WRITE, COLLECTION)].sort()).toEqual([
      'create',
      'delete',
      'update',
    ]);
  });

  it('grants nothing for a bare space:* token', () => {
    // `collection` defaults to the empty list, not to "all", so a token that
    // names none confers no write target even though its default action list
    // carries all three verbs. This mirrors the matcher, and getting it
    // backwards would show an edit button whose write the PDS refuses.
    expect([...spaceWriteActionsFor('space:*', COLLECTION)]).toEqual([]);
  });

  it('grants nothing for a read-only token', () => {
    expect([...spaceWriteActionsFor(SPACE_READ, COLLECTION)]).toEqual([]);
    expect([...spaceWriteActionsFor(SPACE_READ_SELF, COLLECTION)]).toEqual([]);
  });

  it('honours a collection-scoped grant in both directions', () => {
    const scoped = `space:*?authority=*&collection=${COLLECTION}&action=update`;
    expect([...spaceWriteActionsFor(scoped, COLLECTION)]).toEqual(['update']);
    expect([...spaceWriteActionsFor(scoped, 'my.other.record')]).toEqual([]);
  });

  it('grants nothing when the server dropped the space token', () => {
    // A provider that has never heard of `space:` drops it silently, which is
    // indistinguishable from never having asked. Both hide every affordance.
    expect([...spaceWriteActionsFor(DEFAULT_SIGN_IN_SCOPE, COLLECTION)]).toEqual([]);
    expect([...spaceWriteActionsFor(null, COLLECTION)]).toEqual([]);
  });

  it('is independent of the read level in both directions', () => {
    // A write token alone is not a read grant, and a read grant alone is not
    // a write grant. The UI gates reading and editing on these separately.
    expect(spaceGrantLevel(SPACE_WRITE)).toBe(null);
    expect([...spaceWriteActionsFor(SPACE_READ, COLLECTION)]).toEqual([]);

    const both = `${SPACE_READ} ${SPACE_WRITE}`;
    expect(spaceGrantLevel(both)).toBe('read');
    expect([...spaceWriteActionsFor(both, COLLECTION)].sort()).toEqual([
      'create',
      'delete',
      'update',
    ]);
  });
});

describe('hasSpaceWriteScope', () => {
  it('is true only for a token carrying a write verb and a collection', () => {
    expect(hasSpaceWriteScope(SPACE_WRITE)).toBe(true);
    expect(hasSpaceWriteScope(SPACE_READ)).toBe(false);
    expect(hasSpaceWriteScope('space:*')).toBe(false);
    expect(hasSpaceWriteScope(null)).toBe(false);
  });
});

describe('describeSignInError', () => {
  it('explains an undeclared scope by the row that asked for it', () => {
    const raw =
      `OAuth "invalid_scope" error: Scope "${SPACE_WRITE}" is not declared in ` +
      'the client metadata';
    const out = describeSignInError(raw);
    // Names the row to untick, and says the wait is what fixes it. The bare
    // message reads as a permanent misconfiguration of this app.
    expect(out).toContain('Edit your permissioned records');
    expect(out).toMatch(/ten minutes/);
    expect(out).not.toContain('client metadata');
  });

  it('handles a token with no matching picker row', () => {
    const out = describeSignInError(
      'Scope "repo:*?action=frobnicate" is not declared in the client metadata',
    );
    expect(out).toContain('that permission');
  });

  it('passes through anything it cannot place', () => {
    // A message we can't place is more useful verbatim than paraphrased.
    for (const raw of [
      'Network request failed',
      'OAuth "invalid_request" error: bad redirect_uri',
      '',
    ]) {
      expect(describeSignInError(raw)).toBe(raw);
    }
  });
});
