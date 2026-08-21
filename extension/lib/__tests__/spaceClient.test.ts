/**
 * Pure halves of the space client. Nothing here touches the network: the
 * DID-document extractors, the space type declaration parser, the URL join,
 * the error classifier and the pagination walker are all deterministic.
 *
 * The extension's Vitest harness is the only node-environment suite in the
 * repo that can reach `src/utils/**` (via the `@aturi` alias), so these modules
 * are tested from here even though the extension never imports them at runtime.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DidDocument } from '@aturi/didResolver';
import { extractSpaceHost, extractSpaceKey } from '@aturi/atproto/spaceIdentity';
import {
  lexiconAuthorityDomain,
  parseSpaceTypeDeclaration,
} from '@aturi/atproto/spaceLexicon';
import { joinXrpcUrl } from '@aturi/atproto/spaceCredential';
import {
  classifySpaceError,
  collectSpacePages,
  isCredentialStaleError,
  isScopeMissingError,
  spaceErrorCode,
} from '@aturi/atproto/spaceClient';

const AUTHORITY = 'did:plc:x';

function didDoc(partial: Partial<DidDocument>): DidDocument {
  return { id: AUTHORITY, ...partial };
}

/** Shape an error the way the space client's own error reader does. */
function xrpcError(code: string, status = 400): Error {
  const err = new Error(`HTTP ${status} Bad Request for https://pds.example :: {}`);
  Object.assign(err, { status, xrpcError: code });
  return err;
}

describe('extractSpaceHost', () => {
  it('falls back to the PDS when no dedicated space host is published', () => {
    const result = extractSpaceHost(
      didDoc({
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: 'https://pds.example',
          },
        ],
      }),
    );
    expect(result).toEqual({ endpoint: 'https://pds.example', dedicated: false });
  });

  it('prefers a dedicated #atproto_space_host entry', () => {
    const result = extractSpaceHost(
      didDoc({
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: 'https://pds.example',
          },
          {
            id: '#atproto_space_host',
            type: 'AtprotoSpaceHost',
            serviceEndpoint: 'https://spaces.example/',
          },
        ],
      }),
    );
    expect(result).toEqual({ endpoint: 'https://spaces.example', dedicated: true });
  });

  it('matches fully qualified entry ids as well as bare fragments', () => {
    const result = extractSpaceHost(
      didDoc({
        service: [
          {
            id: `${AUTHORITY}#atproto_space_host`,
            type: 'AtprotoSpaceHost',
            serviceEndpoint: 'https://spaces.example',
          },
        ],
      }),
    );
    expect(result).toEqual({ endpoint: 'https://spaces.example', dedicated: true });
  });

  it('returns null when the document publishes neither', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extractSpaceHost(didDoc({ service: [] }))).toEqual({
      endpoint: null,
      dedicated: false,
    });
    warn.mockRestore();
  });
});

describe('extractSpaceKey', () => {
  const atprotoKey = {
    id: '#atproto',
    type: 'Multikey',
    controller: AUTHORITY,
    publicKeyMultibase: 'zAtproto',
  };
  const spaceKey = {
    id: '#atproto_space',
    type: 'Multikey',
    controller: AUTHORITY,
    publicKeyMultibase: 'zSpace',
  };

  it('falls back to the #atproto signing key', () => {
    expect(extractSpaceKey(didDoc({ verificationMethod: [atprotoKey] }))).toEqual({
      id: '#atproto',
      multibase: 'zAtproto',
    });
  });

  it('prefers a dedicated #atproto_space key when both are published', () => {
    expect(
      extractSpaceKey(didDoc({ verificationMethod: [atprotoKey, spaceKey] })),
    ).toEqual({ id: '#atproto_space', multibase: 'zSpace' });
  });

  it('returns null when the document publishes no signing key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extractSpaceKey(didDoc({ verificationMethod: [] }))).toBeNull();
    warn.mockRestore();
  });
});

describe('lexiconAuthorityDomain', () => {
  it('reverses everything but the final NSID segment', () => {
    expect(lexiconAuthorityDomain('com.atmoboards.forum')).toBe('atmoboards.com');
    expect(lexiconAuthorityDomain('app.bsky.feed.post')).toBe('feed.bsky.app');
  });

  it('returns null for a non-NSID', () => {
    expect(lexiconAuthorityDomain('notannsid')).toBeNull();
    expect(lexiconAuthorityDomain('com.example')).toBeNull();
  });
});

describe('parseSpaceTypeDeclaration', () => {
  const doc = {
    lexicon: 1,
    id: 'com.atmoboards.forum',
    defs: {
      main: {
        type: 'space',
        description: 'A discussion forum',
        key: 'any',
        name: 'AtmoBoards Forum',
        'name:lang': { es: 'Foro AtmoBoards' },
        collections: ['com.atmoboards.thread', 'com.atmoboards.reply'],
      },
    },
  };

  it('accepts the worked example from the proposal', () => {
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', doc)).toEqual({
      nsid: 'com.atmoboards.forum',
      name: 'AtmoBoards Forum',
      key: 'any',
      description: 'A discussion forum',
      nameByLang: { es: 'Foro AtmoBoards' },
      collections: ['com.atmoboards.thread', 'com.atmoboards.reply'],
    });
  });

  it('rejects an ordinary record lexicon sitting at the same NSID', () => {
    const record = { defs: { main: { type: 'record', key: 'tid', record: {} } } };
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', record)).toBeNull();
  });

  it('requires both name and key', () => {
    const noName = { defs: { main: { type: 'space', key: 'any' } } };
    const noKey = { defs: { main: { type: 'space', name: 'Forum' } } };
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', noName)).toBeNull();
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', noKey)).toBeNull();
  });

  it('tolerates a missing collections list', () => {
    const minimal = { defs: { main: { type: 'space', name: 'Forum', key: 'any' } } };
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', minimal)).toEqual({
      nsid: 'com.atmoboards.forum',
      name: 'Forum',
      key: 'any',
      collections: [],
    });
  });

  it('returns null for junk', () => {
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', null)).toBeNull();
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', 'nope')).toBeNull();
    expect(parseSpaceTypeDeclaration('com.atmoboards.forum', [])).toBeNull();
  });
});

describe('joinXrpcUrl', () => {
  it('preserves a path prefix on the host', () => {
    expect(joinXrpcUrl('https://host.example/pds', 'xrpc/com.atproto.space.listRepos')).toBe(
      'https://host.example/pds/xrpc/com.atproto.space.listRepos',
    );
  });

  it('accepts a leading slash on the path and a trailing slash on the host', () => {
    expect(joinXrpcUrl('https://host.example/', '/xrpc/com.atproto.space.listRepos')).toBe(
      'https://host.example/xrpc/com.atproto.space.listRepos',
    );
  });
});

describe('spaceErrorCode', () => {
  it('pulls the XRPC error name off a thrown space error', () => {
    expect(spaceErrorCode(xrpcError('SpaceDeleted'))).toBe('SpaceDeleted');
    expect(spaceErrorCode(xrpcError('AppNotAuthorized'))).toBe('AppNotAuthorized');
  });

  it('returns null for anything else', () => {
    expect(spaceErrorCode(new Error('boom'))).toBeNull();
    expect(spaceErrorCode(null)).toBeNull();
    expect(spaceErrorCode('SpaceDeleted')).toBeNull();
  });
});

describe('isScopeMissingError', () => {
  it('matches the 403 scope refusal', () => {
    const err = new Error(
      'HTTP 403 Forbidden for https://pds.example :: {"error":"Forbidden","message":"Missing required scope \\"space:*?authority=*&action=read\\""}',
    );
    Object.assign(err, { status: 403 });
    expect(isScopeMissingError(err)).toBe(true);
  });

  it('does not match a 400 lexicon error', () => {
    expect(isScopeMissingError(xrpcError('RepoNotFound'))).toBe(false);
    expect(isScopeMissingError(new Error('Missing required scope'))).toBe(false);
  });
});

describe('classifySpaceError', () => {
  it('maps every declared repo-scoped lexicon error', () => {
    expect(classifySpaceError(xrpcError('SpaceNotFound'))).toEqual({
      kind: 'space-not-found',
    });
    expect(classifySpaceError(xrpcError('RepoNotFound'))).toEqual({
      kind: 'repo-not-found',
    });
    expect(classifySpaceError(xrpcError('RepoTakendown'))).toEqual({
      kind: 'repo-unavailable',
      state: 'takendown',
    });
    expect(classifySpaceError(xrpcError('RepoSuspended'))).toEqual({
      kind: 'repo-unavailable',
      state: 'suspended',
    });
    expect(classifySpaceError(xrpcError('RepoDeactivated'))).toEqual({
      kind: 'repo-unavailable',
      state: 'deactivated',
    });
  });

  it('keeps the three refusals distinguishable without conflating them', () => {
    expect(classifySpaceError(xrpcError('UserNotAuthorized'))).toEqual({
      kind: 'not-authorized',
      reason: 'user',
    });
    expect(classifySpaceError(xrpcError('AppNotAuthorized'))).toEqual({
      kind: 'not-authorized',
      reason: 'app',
    });
    expect(classifySpaceError(xrpcError('NotAuthorized'))).toEqual({
      kind: 'not-authorized',
      reason: 'unknown',
    });
  });

  it('separates a stale credential from a policy verdict', () => {
    expect(isCredentialStaleError(xrpcError('JwtExpired', 401))).toBe(true);
    expect(isCredentialStaleError(xrpcError('DpopKeyMismatch', 401))).toBe(true);
    expect(isCredentialStaleError(xrpcError('NotAuthorized'))).toBe(false);
    expect(classifySpaceError(xrpcError('JwtExpired', 401))).toEqual({
      kind: 'credential-stale',
    });
  });

  it('falls through to `other` with the raw code', () => {
    expect(classifySpaceError(xrpcError('SomethingNew'))).toEqual({
      kind: 'other',
      code: 'SomethingNew',
    });
    expect(classifySpaceError(new Error('network down'))).toEqual({
      kind: 'other',
      code: null,
    });
  });
});

describe('collectSpacePages', () => {
  it('stops on a short page', async () => {
    const pages = [
      { cursor: 'a', items: [1, 2] },
      { cursor: 'b', items: [3] },
    ];
    let calls = 0;
    const result = await collectSpacePages(
      async () => pages[calls++],
      { limit: 2 },
    );
    expect(result).toEqual({ items: [1, 2, 3], complete: true });
    expect(calls).toBe(2);
  });

  it('stops on a short page even when a cursor is still returned', async () => {
    // listMembers hands back the last member's DID as a cursor on every page,
    // short final page included, so a cursor-only loop would never terminate.
    let calls = 0;
    const result = await collectSpacePages(
      async () => {
        calls++;
        return { cursor: 'did:plc:y', items: calls === 1 ? ['a', 'b'] : ['c'] };
      },
      { limit: 2 },
    );
    expect(result).toEqual({ items: ['a', 'b', 'c'], complete: true });
    expect(calls).toBe(2);
  });

  it('reports an incomplete walk once max is reached', async () => {
    const result = await collectSpacePages(
      async () => ({ cursor: 'more', items: [1, 2] }),
      { limit: 2, max: 4 },
    );
    expect(result).toEqual({ items: [1, 2, 1, 2], complete: false });
  });

  it('threads the cursor through to the next page', async () => {
    const seen: (string | undefined)[] = [];
    await collectSpacePages(
      async (cursor) => {
        seen.push(cursor);
        return seen.length < 2 ? { cursor: 'next', items: [1] } : { items: [] };
      },
      { limit: 1 },
    );
    expect(seen).toEqual([undefined, 'next']);
  });
});
