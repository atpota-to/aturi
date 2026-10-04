/**
 * Pure halves of the space client. Nothing here touches the network: the
 * DID-document extractors, the space type declaration parser, the URL join,
 * the error classifier and the pagination walker are all deterministic, and
 * the write and administrative methods are driven through a stub transport
 * that records what they would have sent.
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
  addSimpleSpaceMember,
  classifySpaceError,
  collectSpacePages,
  createSimpleSpace,
  createSpaceRecord,
  deleteSimpleSpace,
  deleteSpaceRecord,
  isCredentialStaleError,
  isScopeMissingError,
  putSpaceRecord,
  removeSimpleSpaceMember,
  spaceErrorCode,
  updateSimpleSpace,
  type SpaceTransport,
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

describe('space writes', () => {
  /** Records what a write method sends, and answers the way a PDS would. */
  function stubTransport(kind: SpaceTransport['kind'] = 'oauth') {
    const sent: { host: string; path: string; init?: RequestInit }[] = [];
    const transport: SpaceTransport = {
      kind,
      call: async (host, path, init) => {
        sent.push({ host, path, init });
        return new Response(
          JSON.stringify({ uri: 'at://did:plc:me/c/r', cid: 'bafy' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    };
    return { transport, sent };
  }

  const RECORD = { space: 'at://did:plc:auth/space/my.type/self', repo: 'did:plc:me' };

  it('posts putRecord as JSON with every required field', () => {
    const { transport, sent } = stubTransport();
    return putSpaceRecord(transport, {
      ...RECORD,
      collection: 'my.bulletin.post',
      rkey: '3abc',
      record: { $type: 'my.bulletin.post', text: 'hi' },
    }).then(() => {
      expect(sent).toHaveLength(1);
      expect(sent[0].path).toBe('/xrpc/com.atproto.space.putRecord');
      expect(sent[0].init?.method).toBe('POST');
      expect(JSON.parse(String(sent[0].init?.body))).toEqual({
        space: RECORD.space,
        repo: RECORD.repo,
        collection: 'my.bulletin.post',
        rkey: '3abc',
        record: { $type: 'my.bulletin.post', text: 'hi' },
      });
    });
  });

  it('omits rkey from createRecord when the host should assign one', () => {
    const { transport, sent } = stubTransport();
    return createSpaceRecord(transport, {
      ...RECORD,
      collection: 'my.bulletin.post',
      record: { $type: 'my.bulletin.post' },
    }).then(() => {
      const body = JSON.parse(String(sent[0].init?.body));
      expect('rkey' in body).toBe(false);
    });
  });

  it('sends deleteRecord with the key and nothing else', () => {
    const { transport, sent } = stubTransport();
    return deleteSpaceRecord(transport, {
      ...RECORD,
      collection: 'my.bulletin.post',
      rkey: '3abc',
    }).then(() => {
      expect(sent[0].path).toBe('/xrpc/com.atproto.space.deleteRecord');
      expect(JSON.parse(String(sent[0].init?.body))).toEqual({
        space: RECORD.space,
        repo: RECORD.repo,
        collection: 'my.bulletin.post',
        rkey: '3abc',
      });
    });
  });

  it('refuses a credential transport for every write', () => {
    // A space credential authorizes reading a space; a write is attributed to
    // its author and takes an OAuth token only. Presenting the credential
    // would leak an authority-signed capability to a host for no gain.
    //
    // The refusal is a synchronous throw, not a rejected promise, matching
    // how the read methods assert their transport: it is a caller bug rather
    // than a host verdict, and nothing should have left the browser.
    const { transport, sent } = stubTransport('credential');
    const args = { ...RECORD, collection: 'my.bulletin.post', rkey: '3abc' };
    expect(() => putSpaceRecord(transport, { ...args, record: {} })).toThrow(
      /requires a oauth transport/,
    );
    expect(() => createSpaceRecord(transport, { ...args, record: {} })).toThrow(
      /requires a oauth transport/,
    );
    expect(() => deleteSpaceRecord(transport, args)).toThrow(
      /requires a oauth transport/,
    );
    expect(sent).toHaveLength(0);
  });

  it('throws the XRPC error rather than resolving on a refusal', async () => {
    const transport: SpaceTransport = {
      kind: 'oauth',
      call: async () =>
        new Response(JSON.stringify({ error: 'SpaceNotFound', message: 'nope' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    };
    await expect(
      deleteSpaceRecord(transport, {
        ...RECORD,
        collection: 'my.bulletin.post',
        rkey: '3abc',
      }),
    ).rejects.toMatchObject({ xrpcError: 'SpaceNotFound' });
  });
});

describe('space administration', () => {
  const SPACE = 'at://did:plc:auth/space/my.type/self';
  const MEMBER_LIST = { $type: 'com.atproto.simplespace.defs#memberListPolicy' } as const;
  const OPEN = { $type: 'com.atproto.simplespace.defs#open' } as const;

  /**
   * Four of the five methods declare no output, and a PDS answers those with a
   * bare 200 — no body and no content type. That is not a detail: reading it as
   * JSON throws on the *success* path, so the stub reproduces it exactly rather
   * than returning an empty object the way the record writes do.
   */
  function stubTransport(
    kind: SpaceTransport['kind'] = 'oauth',
    body: string | null = null,
  ) {
    const sent: { host: string; path: string; init?: RequestInit }[] = [];
    const transport: SpaceTransport = {
      kind,
      call: async (host, path, init) => {
        sent.push({ host, path, init });
        return new Response(body, {
          status: 200,
          headers: body ? { 'content-type': 'application/json' } : {},
        });
      },
    };
    return { transport, sent };
  }

  it('creates a space with the key the caller chose', async () => {
    const { transport, sent } = stubTransport('oauth', JSON.stringify({ uri: SPACE }));
    const result = await createSimpleSpace(transport, {
      type: 'my.type',
      skey: 'self',
      policy: MEMBER_LIST,
      appAccess: OPEN,
    });
    expect(result).toEqual({ uri: SPACE });
    expect(sent[0].host).toBe('');
    expect(sent[0].path).toBe('/xrpc/com.atproto.simplespace.createSpace');
    expect(sent[0].init?.method).toBe('POST');
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({
      type: 'my.type',
      skey: 'self',
      policy: MEMBER_LIST,
      appAccess: OPEN,
    });
  });

  it('omits skey so the host generates a TID', async () => {
    // Sending `skey: undefined` would serialize to no key either, but sending
    // an empty string would ask for a space literally keyed "".
    const { transport, sent } = stubTransport('oauth', JSON.stringify({ uri: SPACE }));
    await createSimpleSpace(transport, { type: 'my.type', policy: MEMBER_LIST, appAccess: OPEN });
    expect('skey' in JSON.parse(String(sent[0].init?.body))).toBe(false);
  });

  it('sends only the rules updateSpace was given', async () => {
    // An omitted rule is left alone and a supplied one is replaced wholesale,
    // so sending a rule the caller didn't touch would rewrite it.
    const { transport, sent } = stubTransport();
    await updateSimpleSpace(transport, { space: SPACE, appAccess: OPEN });
    expect(sent[0].path).toBe('/xrpc/com.atproto.simplespace.updateSpace');
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({
      space: SPACE,
      appAccess: OPEN,
    });
  });

  it('resolves the no-output procedures on an empty 200', async () => {
    // The regression this exists for: parsing the empty body as JSON rejects a
    // call that in fact succeeded.
    const { transport } = stubTransport();
    await expect(updateSimpleSpace(transport, { space: SPACE, policy: MEMBER_LIST })).resolves
      .toBeUndefined();
    await expect(deleteSimpleSpace(transport, { space: SPACE })).resolves.toBeUndefined();
    await expect(
      addSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' }),
    ).resolves.toBeUndefined();
    await expect(
      removeSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' }),
    ).resolves.toBeUndefined();
  });

  it('sends deleteSpace with the space and nothing else', async () => {
    const { transport, sent } = stubTransport();
    await deleteSimpleSpace(transport, { space: SPACE });
    expect(sent[0].path).toBe('/xrpc/com.atproto.simplespace.deleteSpace');
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({ space: SPACE });
  });

  it('sends the member methods with the space and the DID', async () => {
    const { transport, sent } = stubTransport();
    await addSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' });
    await removeSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' });
    expect(sent.map((s) => s.path)).toEqual([
      '/xrpc/com.atproto.simplespace.addMember',
      '/xrpc/com.atproto.simplespace.removeMember',
    ]);
    for (const call of sent) {
      expect(JSON.parse(String(call.init?.body))).toEqual({
        space: SPACE,
        did: 'did:plc:bob',
      });
    }
  });

  it('refuses a credential transport for every administrative method', () => {
    // A space credential is a capability to READ a space, issued by the very
    // authority these methods reconfigure. Presenting it here would offer an
    // authority-signed token to a host that will refuse it anyway.
    const { transport, sent } = stubTransport('credential');
    expect(() =>
      createSimpleSpace(transport, { type: 'my.type', policy: MEMBER_LIST, appAccess: OPEN }),
    ).toThrow(/requires a oauth transport/);
    expect(() => updateSimpleSpace(transport, { space: SPACE, policy: MEMBER_LIST })).toThrow(
      /requires a oauth transport/,
    );
    expect(() => deleteSimpleSpace(transport, { space: SPACE })).toThrow(
      /requires a oauth transport/,
    );
    expect(() => addSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' })).toThrow(
      /requires a oauth transport/,
    );
    expect(() => removeSimpleSpaceMember(transport, { space: SPACE, did: 'did:plc:bob' })).toThrow(
      /requires a oauth transport/,
    );
    expect(sent).toHaveLength(0);
  });

  it('throws the XRPC error rather than resolving on a refusal', async () => {
    const transport: SpaceTransport = {
      kind: 'oauth',
      call: async () =>
        new Response(JSON.stringify({ error: 'SpaceAlreadyExists', message: 'taken' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    };
    await expect(
      createSimpleSpace(transport, { type: 'my.type', skey: 'self', policy: MEMBER_LIST, appAccess: OPEN }),
    ).rejects.toMatchObject({ xrpcError: 'SpaceAlreadyExists' });
  });
});
