/**
 * The editable shape of a simplespace's two rules.
 *
 * `src/utils/atproto/simpleSpaceConfig.ts` is pure — no React, no network — so
 * it sits with the rest of the space client and is reached here through the
 * `@aturi` alias, like every other `src/utils` module this suite covers.
 *
 * The load-bearing assertions are the `unknown` ones. Both config unions are
 * open, so an authority may run a policy this build has never heard of, and
 * `updateSpace` replaces a supplied rule *wholesale* — so a draft layer that
 * degraded an unrecognised rule into the nearest familiar one would let a form
 * opened to change one rule silently rewrite the other.
 */

import { describe, it, expect } from 'vitest';
import {
  appAccessDraftEquals,
  appAccessDraftFromConfig,
  appAccessDraftToInput,
  describeSpaceManageError,
  formatAllowList,
  isValidManagingApp,
  parseAllowList,
  policyDraftEquals,
  policyDraftFromConfig,
  policyDraftToInput,
} from '@aturi/atproto/simpleSpaceConfig';

const POLICY = {
  public: 'com.atproto.simplespace.defs#publicPolicy',
  memberList: 'com.atproto.simplespace.defs#memberListPolicy',
  managingApp: 'com.atproto.simplespace.defs#managingAppPolicy',
};
const APP_ACCESS = {
  open: 'com.atproto.simplespace.defs#open',
  allowList: 'com.atproto.simplespace.defs#allowList',
};

/** Shape an error the way the space client's own error reader does. */
function xrpcError(code: string, message?: string): Error {
  const err = new Error(`HTTP 400 Bad Request for https://pds.example :: {}`);
  Object.assign(err, { status: 400, xrpcError: code, xrpcMessage: message });
  return err;
}

describe('policyDraftFromConfig', () => {
  it('reads the three variants this build knows', () => {
    expect(policyDraftFromConfig({ $type: POLICY.public })).toEqual({ kind: 'public' });
    expect(policyDraftFromConfig({ $type: POLICY.memberList })).toEqual({ kind: 'memberList' });
    expect(
      policyDraftFromConfig({ $type: POLICY.managingApp, managingApp: 'did:web:x#forum' }),
    ).toEqual({ kind: 'managingApp', managingApp: 'did:web:x#forum' });
  });

  it('keeps an unrecognised policy as itself', () => {
    // Never the nearest familiar option, and never the permissive one.
    expect(policyDraftFromConfig({ $type: 'com.example.defs#weekdaysOnly' })).toEqual({
      kind: 'unknown',
      type: 'com.example.defs#weekdaysOnly',
    });
  });
});

describe('appAccessDraftFromConfig', () => {
  it('reads both variants and keeps the allow list in order', () => {
    expect(appAccessDraftFromConfig({ $type: APP_ACCESS.open })).toEqual({ kind: 'open' });
    expect(
      appAccessDraftFromConfig({ $type: APP_ACCESS.allowList, allowed: ['b', 'a'] }),
    ).toEqual({ kind: 'allowList', allowed: ['b', 'a'] });
  });

  it('treats an allow list with no `allowed` as an empty one', () => {
    expect(appAccessDraftFromConfig({ $type: APP_ACCESS.allowList })).toEqual({
      kind: 'allowList',
      allowed: [],
    });
  });

  it('keeps an unrecognised rule as itself', () => {
    expect(appAccessDraftFromConfig({ $type: 'com.example.defs#attested' })).toEqual({
      kind: 'unknown',
      type: 'com.example.defs#attested',
    });
  });
});

describe('policyDraftToInput', () => {
  it('converts the variants the lexicon declares', () => {
    expect(policyDraftToInput({ kind: 'public' })).toEqual({ $type: POLICY.public });
    expect(policyDraftToInput({ kind: 'memberList' })).toEqual({ $type: POLICY.memberList });
    expect(
      policyDraftToInput({ kind: 'managingApp', managingApp: '  did:web:x#forum  ' }),
    ).toEqual({ $type: POLICY.managingApp, managingApp: 'did:web:x#forum' });
  });

  it('refuses to send an unknown variant back', () => {
    // The union is closed on the write side: a host answers `UnsupportedPolicy`
    // rather than storing a rule it cannot enforce.
    expect(policyDraftToInput({ kind: 'unknown', type: 'com.example.defs#x' })).toBeNull();
  });

  it('refuses a managing app that is not a DID', () => {
    for (const value of ['', '   ', 'example.com', 'did:web:x#', 'not-a-did#frag']) {
      expect(policyDraftToInput({ kind: 'managingApp', managingApp: value })).toBeNull();
    }
  });
});

describe('appAccessDraftToInput', () => {
  it('converts open, and an allow list that has entries', () => {
    expect(appAccessDraftToInput({ kind: 'open' })).toEqual({ $type: APP_ACCESS.open });
    expect(appAccessDraftToInput({ kind: 'allowList', allowed: ['https://a/x.json'] })).toEqual({
      $type: APP_ACCESS.allowList,
      allowed: ['https://a/x.json'],
    });
  });

  it('refuses an empty allow list and an unknown variant', () => {
    // An allow list naming nobody is not "open" — it is a form that has not
    // been filled in, and sending it would lock every app out of the space.
    expect(appAccessDraftToInput({ kind: 'allowList', allowed: [] })).toBeNull();
    expect(appAccessDraftToInput({ kind: 'unknown', type: 'com.example.defs#x' })).toBeNull();
  });
});

describe('isValidManagingApp', () => {
  it('accepts a DID with or without a service fragment', () => {
    expect(isValidManagingApp('did:web:example.com')).toBe(true);
    expect(isValidManagingApp('did:web:example.com#forum')).toBe(true);
    expect(isValidManagingApp('  did:plc:abc123#svc  ')).toBe(true);
  });

  it('rejects a handle, a bare fragment, and a trailing hash', () => {
    expect(isValidManagingApp('example.com')).toBe(false);
    expect(isValidManagingApp('#forum')).toBe(false);
    expect(isValidManagingApp('did:web:example.com#')).toBe(false);
    expect(isValidManagingApp('')).toBe(false);
  });
});

describe('parseAllowList', () => {
  it('splits on newlines, not commas', () => {
    // An OAuth client id is a URL, and a URL may legitimately contain a comma.
    expect(parseAllowList('https://a/x.json?q=1,2\nhttps://b/y.json')).toEqual([
      'https://a/x.json?q=1,2',
      'https://b/y.json',
    ]);
  });

  it('drops blank lines and surrounding whitespace', () => {
    expect(parseAllowList('  https://a/x.json  \n\n\n  ')).toEqual(['https://a/x.json']);
  });

  it('round-trips through the formatter', () => {
    const ids = ['https://a/x.json', 'https://b/y.json'];
    expect(parseAllowList(formatAllowList(ids))).toEqual(ids);
  });
});

describe('draft equality', () => {
  it('ignores whitespace around a managing app', () => {
    expect(
      policyDraftEquals(
        { kind: 'managingApp', managingApp: 'did:web:x ' },
        { kind: 'managingApp', managingApp: 'did:web:x' },
      ),
    ).toBe(true);
  });

  it('separates variants that differ only in kind', () => {
    expect(policyDraftEquals({ kind: 'public' }, { kind: 'memberList' })).toBe(false);
    expect(
      policyDraftEquals(
        { kind: 'unknown', type: 'a' },
        { kind: 'unknown', type: 'b' },
      ),
    ).toBe(false);
  });

  it('compares an allow list by contents and order', () => {
    const of = (allowed: string[]) => ({ kind: 'allowList' as const, allowed });
    expect(appAccessDraftEquals(of(['a', 'b']), of(['a', 'b']))).toBe(true);
    expect(appAccessDraftEquals(of(['a', 'b']), of(['b', 'a']))).toBe(false);
    expect(appAccessDraftEquals(of(['a']), of(['a', 'b']))).toBe(false);
    expect(appAccessDraftEquals(of([]), { kind: 'open' })).toBe(false);
  });

  it('is what keeps an unchanged rule out of the request', () => {
    // The property the manage form relies on: an untouched unknown rule
    // compares equal to itself, so it is never included in `updateSpace` — and
    // therefore never replaced by a guess.
    const unknown = { kind: 'unknown' as const, type: 'com.example.defs#x' };
    expect(policyDraftEquals(unknown, unknown)).toBe(true);
  });
});

describe('describeSpaceManageError', () => {
  it('explains a taken space key without naming the error code', () => {
    const out = describeSpaceManageError(xrpcError('SpaceAlreadyExists'));
    expect(out).toMatch(/already have a space/i);
    expect(out).not.toContain('SpaceAlreadyExists');
  });

  it('separates the refusals a different remedy applies to', () => {
    expect(describeSpaceManageError(xrpcError('UnsupportedPolicy'))).toMatch(
      /does not implement that access rule/i,
    );
    expect(describeSpaceManageError(xrpcError('UnsupportedAppAccess'))).toMatch(
      /application-access rule/i,
    );
    expect(describeSpaceManageError(xrpcError('NotSpaceOwner'))).toMatch(/signed in as/i);
    expect(describeSpaceManageError(xrpcError('SpaceNotFound'))).toMatch(
      /no simplespace configuration/i,
    );
  });

  it('prefers the host’s own sentence over the diagnostic line', () => {
    // `Error.message` is built for a console — status, URL, first 200 bytes of
    // the body — so a host that wrote a sentence for a person wins.
    expect(
      describeSpaceManageError(xrpcError('InvalidRequest', 'Not a valid record key')),
    ).toBe('Not a valid record key');
    expect(
      describeSpaceManageError(xrpcError('SomethingNew', 'The space is on fire')),
    ).toBe('The space is on fire');
  });

  it('passes a message through when it cannot place the failure', () => {
    // A resolver failure reaches here too, and its own message is the useful
    // half when a handle was the thing that was wrong.
    expect(describeSpaceManageError(new Error('Could not resolve alice.example'))).toBe(
      'Could not resolve alice.example',
    );
    // No sentence from the host: the diagnostic line is better than nothing.
    expect(describeSpaceManageError(xrpcError('InvalidRequest'))).toMatch(/HTTP 400/);
  });
});
