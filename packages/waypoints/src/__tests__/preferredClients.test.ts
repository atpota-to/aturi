import { describe, it, expect } from 'vitest';
import {
  buildPreferredClientsRecord,
  clientFromWaypointId,
  describeScope,
  expandLinkTemplate,
  isValidPreferredScope,
  matchPreferredRule,
  orderIdsByPreference,
  parsePreferredClientsRecord,
  preferredClientUrl,
  preferredWaypointFor,
  preferredWaypointIdsFor,
  scopeSpecificity,
  type PreferredClientsRecord,
} from '../preferredClients';
import { applyPreferredClients, resolveAtUri } from '../resolve';

const RECORD: PreferredClientsRecord = {
  preferences: [
    { scope: '*', clients: [{ id: 'pdsls', name: 'PDSls' }] },
    { scope: 'post', clients: [{ id: 'deer', name: 'Deer' }] },
    { scope: 'app.bsky.*', clients: [{ id: 'anisota', name: 'Anisota' }] },
    { scope: 'app.bsky.feed.post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
    { scope: 'sh.tangled.*', clients: [{ id: 'tangled', name: 'Tangled' }] },
  ],
};

describe('isValidPreferredScope', () => {
  it('accepts NSIDs, wildcards, kinds and the catch-all', () => {
    for (const scope of ['*', 'post', 'profile', 'app.bsky.feed.post', 'app.bsky.*', 'sh.tangled.*']) {
      expect(isValidPreferredScope(scope)).toBe(true);
    }
  });

  it('rejects junk', () => {
    for (const scope of ['', 'bsky', 'app.bsky', '*.post', 'app..bsky.*', 42, null]) {
      expect(isValidPreferredScope(scope)).toBe(false);
    }
  });

  it('needs three segments for a bare NSID but only two for a wildcard prefix', () => {
    expect(isValidPreferredScope('app.bsky')).toBe(false);
    expect(isValidPreferredScope('app.bsky.*')).toBe(true);
  });
});

describe('scopeSpecificity', () => {
  const query = { collection: 'app.bsky.feed.post', type: 'post' as const };

  it('ranks exact NSID over wildcard over kind over catch-all', () => {
    const exact = scopeSpecificity('app.bsky.feed.post', query);
    const wideWildcard = scopeSpecificity('app.bsky.*', query);
    const narrowWildcard = scopeSpecificity('app.bsky.feed.*', query);
    const kind = scopeSpecificity('post', query);
    const all = scopeSpecificity('*', query);
    expect(exact).toBeGreaterThan(narrowWildcard);
    expect(narrowWildcard).toBeGreaterThan(wideWildcard);
    expect(wideWildcard).toBeGreaterThan(kind);
    expect(kind).toBeGreaterThan(all);
  });

  it('returns -1 when the scope does not apply', () => {
    expect(scopeSpecificity('sh.tangled.*', query)).toBe(-1);
    expect(scopeSpecificity('profile', query)).toBe(-1);
    expect(scopeSpecificity('app.bsky.graph.list', query)).toBe(-1);
  });

  it('does not let a wildcard match a prefix that is only a string prefix', () => {
    // `app.bskyfoo.post` starts with the letters of `app.bsky` but is a
    // different namespace.
    expect(scopeSpecificity('app.bsky.*', { collection: 'app.bskyfoo.post' })).toBe(-1);
  });

  it('matches the namespace root itself', () => {
    expect(scopeSpecificity('sh.tangled.*', { collection: 'sh.tangled' })).toBeGreaterThan(0);
  });
});

describe('matchPreferredRule', () => {
  it('picks the most specific rule regardless of array order', () => {
    expect(
      matchPreferredRule(RECORD, { collection: 'app.bsky.feed.post', type: 'post' })?.scope,
    ).toBe('app.bsky.feed.post');
    expect(
      matchPreferredRule(RECORD, { collection: 'app.bsky.graph.list', type: 'list' })?.scope,
    ).toBe('app.bsky.*');
    expect(
      matchPreferredRule(RECORD, { collection: 'sh.tangled.repo', type: 'record' })?.scope,
    ).toBe('sh.tangled.*');
    expect(
      matchPreferredRule(RECORD, { collection: 'social.grain.photo', type: 'record' })?.scope,
    ).toBe('*');
  });

  it('falls back to the record kind when no collection is known', () => {
    expect(matchPreferredRule(RECORD, { type: 'post' })?.scope).toBe('post');
    expect(matchPreferredRule(RECORD, { type: 'profile' })?.scope).toBe('*');
  });

  it('returns null for an empty record', () => {
    expect(matchPreferredRule(null, { type: 'post' })).toBeNull();
    expect(matchPreferredRule({ preferences: [] }, { type: 'post' })).toBeNull();
  });
});

describe('parsePreferredClientsRecord', () => {
  it('parses a well-formed record', () => {
    const parsed = parsePreferredClientsRecord({
      $type: 'to.aturi.actor.preferredClients',
      preferences: [
        { scope: 'app.bsky.feed.post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed?.preferences).toHaveLength(1);
    expect(parsed?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drops bad rules but keeps the good ones', () => {
    const parsed = parsePreferredClientsRecord({
      preferences: [
        { scope: 'nonsense', clients: [{ id: 'bluesky', name: 'Bluesky' }] },
        { scope: 'post', clients: [] },
        { scope: 'post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
      ],
    });
    expect(parsed?.preferences.map((p) => p.scope)).toEqual(['post']);
  });

  it('rejects a client with neither an id nor templates', () => {
    expect(
      parsePreferredClientsRecord({
        preferences: [{ scope: 'post', clients: [{ name: 'Mystery App' }] }],
      }),
    ).toBeNull();
  });

  it('fills a missing name from the catalog', () => {
    const parsed = parsePreferredClientsRecord({
      preferences: [{ scope: 'post', clients: [{ id: 'blacksky' }] }],
    });
    expect(parsed?.preferences[0].clients[0].name).toBe('Blacksky');
  });

  it('survives hostile values in a stranger-authored record', () => {
    const parsed = parsePreferredClientsRecord({
      preferences: [
        {
          scope: 'post',
          clients: [
            // A non-string template would crash expansion if it got through.
            { name: 'Bad', templates: { post: { evil: true } } },
            { id: 'blacksky', name: 'Blacksky' },
          ],
        },
      ],
    });
    expect(parsed?.preferences[0].clients).toEqual([{ id: 'blacksky', name: 'Blacksky' }]);
  });

  it('rejects non-record input', () => {
    expect(parsePreferredClientsRecord(null)).toBeNull();
    expect(parsePreferredClientsRecord('nope')).toBeNull();
    expect(parsePreferredClientsRecord({ preferences: 'nope' })).toBeNull();
  });

  it('caps runaway rule and client counts', () => {
    const parsed = parsePreferredClientsRecord({
      preferences: Array.from({ length: 500 }, (_, i) => ({
        scope: `app.test${i}.*`,
        clients: Array.from({ length: 50 }, () => ({ id: 'bluesky', name: 'Bluesky' })),
      })),
    });
    expect(parsed!.preferences.length).toBeLessThanOrEqual(100);
    expect(parsed!.preferences[0].clients.length).toBeLessThanOrEqual(10);
  });
});

describe('expandLinkTemplate', () => {
  const ctx = {
    handle: 'alice.bsky.social',
    did: 'did:plc:abc',
    collection: 'app.bsky.feed.post',
    rkey: '3k7',
  };

  it('substitutes every placeholder', () => {
    expect(expandLinkTemplate('https://x.example/{handle}/{collection}/{rkey}', ctx)).toBe(
      'https://x.example/alice.bsky.social/app.bsky.feed.post/3k7',
    );
  });

  it('leaves DID colons intact', () => {
    expect(expandLinkTemplate('https://x.example/{did}', ctx)).toBe(
      'https://x.example/did:plc:abc',
    );
  });

  it('prefers the DID for {actor}', () => {
    expect(expandLinkTemplate('https://x.example/{actor}', ctx)).toBe(
      'https://x.example/did:plc:abc',
    );
    expect(expandLinkTemplate('https://x.example/{actor}', { handle: 'a.example' })).toBe(
      'https://x.example/a.example',
    );
  });

  it('returns null when a placeholder has no value', () => {
    expect(expandLinkTemplate('https://x.example/{rkey}', { handle: 'a.example' })).toBeNull();
  });
});

describe('preferredClientUrl', () => {
  const target = {
    type: 'post' as const,
    handle: 'alice.bsky.social',
    did: 'did:plc:abc',
    collection: 'app.bsky.feed.post',
    rkey: '3k7',
  };

  it('builds from a catalog id', () => {
    const url = preferredClientUrl({ id: 'blacksky', name: 'Blacksky' }, target);
    expect(url).toContain('3k7');
  });

  it('prefers a template over the catalog default', () => {
    const url = preferredClientUrl(
      {
        id: 'bluesky',
        name: 'My Bluesky',
        templates: { post: 'https://self.hosted/{handle}/post/{rkey}' },
      },
      target,
    );
    expect(url).toBe('https://self.hosted/alice.bsky.social/post/3k7');
  });

  it('falls back to the catalog id when the template cannot be filled', () => {
    const url = preferredClientUrl(
      { id: 'bluesky', name: 'Bluesky', templates: { post: 'https://x.example/{did}' } },
      { ...target, did: undefined },
    );
    expect(url).toBe('https://bsky.app/profile/alice.bsky.social/post/3k7');
  });

  it('refuses a DID-only destination when no DID is known', () => {
    expect(
      preferredClientUrl({ id: 'pdsls', name: 'PDSls' }, { ...target, did: undefined }),
    ).toBeNull();
  });

  it('returns null for an unknown catalog id', () => {
    expect(preferredClientUrl({ id: 'not-a-client', name: 'Nope' }, target)).toBeNull();
  });
});

describe('preferredWaypointFor', () => {
  const target = {
    type: 'post' as const,
    handle: 'alice.bsky.social',
    did: 'did:plc:abc',
    collection: 'app.bsky.feed.post',
    rkey: '3k7',
  };

  it('resolves the most specific rule to a usable destination', () => {
    const match = preferredWaypointFor(RECORD, target);
    expect(match?.scope).toBe('app.bsky.feed.post');
    expect(match?.waypointId).toBe('blacksky');
    expect(match?.url).toContain('3k7');
  });

  it('falls through to the next client when the first cannot render the target', () => {
    const record: PreferredClientsRecord = {
      preferences: [
        {
          scope: 'post',
          clients: [
            { id: 'pdsls', name: 'PDSls' },
            { id: 'bluesky', name: 'Bluesky' },
          ],
        },
      ],
    };
    // No DID, so PDSls is unusable and Bluesky wins.
    const match = preferredWaypointFor(record, { ...target, did: undefined });
    expect(match?.waypointId).toBe('bluesky');
  });

  it('returns null when nothing in the winning rule can render the target', () => {
    const record: PreferredClientsRecord = {
      preferences: [{ scope: 'post', clients: [{ id: 'pdsls', name: 'PDSls' }] }],
    };
    expect(preferredWaypointFor(record, { ...target, did: undefined })).toBeNull();
  });

  it('reports a template-only client with a null waypointId', () => {
    const record: PreferredClientsRecord = {
      preferences: [
        {
          scope: 'post',
          clients: [{ name: 'Mine', templates: { post: 'https://mine.example/{rkey}' } }],
        },
      ],
    };
    const match = preferredWaypointFor(record, target);
    expect(match?.waypointId).toBeNull();
    expect(match?.url).toBe('https://mine.example/3k7');
  });
});

describe('orderIdsByPreference', () => {
  it('lifts declared clients to the front in declared order', () => {
    const record: PreferredClientsRecord = {
      preferences: [
        {
          scope: 'post',
          clients: [
            { id: 'deer', name: 'Deer' },
            { id: 'blacksky', name: 'Blacksky' },
          ],
        },
      ],
    };
    expect(
      orderIdsByPreference(['bluesky', 'anisota', 'blacksky', 'deer'], record, { type: 'post' }),
    ).toEqual(['deer', 'blacksky', 'bluesky', 'anisota']);
  });

  it('leaves the list alone when nothing matches', () => {
    const ids = ['bluesky', 'anisota'];
    expect(orderIdsByPreference(ids, RECORD, { type: 'post' })).toEqual(ids);
    expect(orderIdsByPreference(ids, null, { type: 'post' })).toEqual(ids);
  });

  it('ignores preferred ids that are not in the list', () => {
    expect(
      orderIdsByPreference(['bluesky', 'blacksky'], RECORD, {
        collection: 'sh.tangled.repo',
        type: 'record',
      }),
    ).toEqual(['bluesky', 'blacksky']);
  });
});

describe('preferredWaypointIdsFor', () => {
  it('skips template-only and unknown clients', () => {
    const record: PreferredClientsRecord = {
      preferences: [
        {
          scope: 'post',
          clients: [
            { name: 'Mine', templates: { post: 'https://mine.example/{rkey}' } },
            { id: 'ghost', name: 'Ghost' },
            { id: 'blacksky', name: 'Blacksky' },
          ],
        },
      ],
    };
    expect(preferredWaypointIdsFor(record, { type: 'post' })).toEqual(['blacksky']);
  });
});

describe('applyPreferredClients', () => {
  it('reorders recommendations and attaches the preferred destination', () => {
    const base = resolveAtUri('at://did:plc:x/app.bsky.feed.post/abc')!;
    expect(base.recommended.ids[0]).toBe('bluesky');

    const applied = applyPreferredClients(base, RECORD);
    expect(applied.recommended.ids[0]).toBe('blacksky');
    expect(applied.preferred?.waypointId).toBe('blacksky');
    // Nothing is dropped, just reordered.
    expect([...applied.recommended.ids].sort()).toEqual([...base.recommended.ids].sort());
  });

  it('is a no-op without a record', () => {
    const base = resolveAtUri('at://did:plc:x/app.bsky.feed.post/abc')!;
    const applied = applyPreferredClients(base, null);
    expect(applied.recommended.ids).toEqual(base.recommended.ids);
    expect(applied.preferred).toBeNull();
  });
});

describe('buildPreferredClientsRecord', () => {
  it('stamps the type and timestamps', () => {
    const record = buildPreferredClientsRecord([
      { scope: 'post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
    ]);
    expect(record.$type).toBe('to.aturi.actor.preferredClients');
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });

  it('drops rules that would not survive a read and dedupes scopes', () => {
    const record = buildPreferredClientsRecord([
      { scope: 'post', clients: [{ id: 'bluesky', name: 'Bluesky' }] },
      { scope: 'post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
      { scope: 'garbage', clients: [{ id: 'bluesky', name: 'Bluesky' }] },
      { scope: 'list', clients: [] },
    ]);
    expect(record.preferences).toHaveLength(1);
    expect(record.preferences[0].clients[0].id).toBe('blacksky');
  });

  it('round-trips through the parser', () => {
    const built = buildPreferredClientsRecord([
      { scope: 'app.bsky.feed.post', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
      { scope: '*', clients: [{ id: 'pdsls', name: 'PDSls' }] },
    ]);
    const parsed = parsePreferredClientsRecord(built);
    expect(parsed?.preferences).toEqual(built.preferences);
  });
});

describe('helpers', () => {
  it('builds a client from a catalog id', () => {
    expect(clientFromWaypointId('blacksky')).toEqual({ id: 'blacksky', name: 'Blacksky' });
    expect(clientFromWaypointId('nope')).toBeNull();
  });

  it('labels scopes for display', () => {
    expect(describeScope('*')).toBe('Everything else');
    expect(describeScope('post')).toBe('Posts');
    expect(describeScope('sh.tangled.*')).toBe('sh.tangled records');
    expect(describeScope('app.bsky.feed.post')).toBe('Bluesky posts');
    // A lexicon we have no name for is labelled by its NSID, not guessed at.
    expect(describeScope('social.grain.photo.gallery')).toBe('social.grain.photo.gallery');
  });
});
