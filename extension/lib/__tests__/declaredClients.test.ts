import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPreferredClientsRecord,
  clientFromWaypoint,
  type DeclaredClient,
} from '@aturi/preferredClients';
import { DEFAULT_PREFS, type Prefs } from '../prefs';
import { visibleWaypointIds } from '../catalog';
import {
  applyDeclaredFavorites,
  fetchDeclaration,
  planDeclaredFavorites,
} from '../declaredClients';

function prefsWith(overrides: Partial<Prefs> = {}): Prefs {
  return { ...DEFAULT_PREFS, ...overrides };
}

const SKYLARK: DeclaredClient = {
  url: 'https://skylark.example',
  name: 'Skylark',
  templates: { post: 'https://skylark.example/p/{rkey}' },
};

const record = buildPreferredClientsRecord([
  {
    category: 'bluesky-social',
    client: clientFromWaypoint('bluesky')!,
    mobile: clientFromWaypoint('blacksky')!,
  },
  { category: 'atproto-explorer', client: clientFromWaypoint('pdsls')! },
  { category: 'standard-site', client: SKYLARK },
]);

describe('planDeclaredFavorites', () => {
  it('maps each declared family to a favorite, for the device in hand', () => {
    const desktop = planDeclaredFavorites(record, 'desktop');
    expect(desktop.find(p => p.family === 'bluesky-social')).toEqual({
      family: 'bluesky-social',
      clientName: 'Bluesky',
      waypointId: 'bluesky',
    });
    const mobile = planDeclaredFavorites(record, 'mobile');
    expect(mobile.find(p => p.family === 'bluesky-social')?.waypointId).toBe('blacksky');
  });

  it('keeps clients the extension cannot redirect to, with the reason', () => {
    const plan = planDeclaredFavorites(record, 'desktop');
    expect(plan.find(p => p.family === 'atproto-explorer')).toEqual({
      family: 'atproto-explorer',
      clientName: 'PDSls',
      waypointId: null,
      reason: 'needs-did',
    });
    expect(plan.find(p => p.family === 'standard-site')).toEqual({
      family: 'standard-site',
      clientName: 'Skylark',
      waypointId: null,
      reason: 'not-in-catalog',
    });
  });

  it('does not trust a catalog id filed under the wrong family', () => {
    const misfiled = buildPreferredClientsRecord([
      { category: 'tangled', client: clientFromWaypoint('bluesky')! },
    ]);
    expect(planDeclaredFavorites(misfiled, 'desktop')).toEqual([
      { family: 'tangled', clientName: 'Bluesky', waypointId: null, reason: 'not-in-catalog' },
    ]);
  });

  it('leaves out families the declaration does not name', () => {
    const plan = planDeclaredFavorites(record, 'desktop');
    expect(plan.map(p => p.family)).toEqual(['bluesky-social', 'standard-site', 'atproto-explorer']);
  });
});

describe('applyDeclaredFavorites', () => {
  it('sets the usable favorites and nothing else', () => {
    const plan = planDeclaredFavorites(record, 'mobile');
    const next = applyDeclaredFavorites(prefsWith(), plan);
    expect(next.favoriteByFamily).toEqual({ 'bluesky-social': 'blacksky' });
  });

  it('adopts a favorite the user had hidden, so the picker can show it', () => {
    const hidden = prefsWith({
      waypointGroups: DEFAULT_PREFS.waypointGroups.map(g => ({
        ...g,
        waypointIds: g.waypointIds.filter(id => id !== 'blacksky'),
      })),
    });
    expect(visibleWaypointIds(hidden).has('blacksky')).toBe(false);
    const next = applyDeclaredFavorites(hidden, planDeclaredFavorites(record, 'mobile'));
    expect(visibleWaypointIds(next).has('blacksky')).toBe(true);
  });
});

describe('fetchDeclaration', () => {
  const DID = 'did:plc:declaredtest000000000000';
  const PDS = 'https://pds.example';

  function stubNetwork(getRecord: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url === `https://plc.directory/${DID}`) {
          return Response.json({
            id: DID,
            alsoKnownAs: ['at://alice.example.com'],
            service: [
              { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
            ],
          });
        }
        if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.describeRepo`)) {
          return Response.json({ handle: 'alice.example.com', did: DID, collections: [] });
        }
        if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) {
          expect(url).toContain('collection=to.aturi.client.declaration');
          expect(url).toContain('rkey=self');
          return getRecord();
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the record off the account’s own PDS', async () => {
    stubNetwork(() =>
      Response.json({ uri: `at://${DID}/to.aturi.client.declaration/self`, cid: 'bafy', value: record }),
    );
    const found = await fetchDeclaration(DID);
    expect(found.did).toBe(DID);
    expect(found.handle).toBe('alice.example.com');
    expect(found.record?.preferences).toEqual(record.preferences);
  });

  it('treats a missing record as no declaration, not an error', async () => {
    stubNetwork(() =>
      Response.json(
        { error: 'RecordNotFound', message: 'Could not locate record' },
        { status: 400 },
      ),
    );
    const found = await fetchDeclaration(DID);
    expect(found.record).toBeNull();
  });

  it('surfaces any other failure', async () => {
    stubNetwork(() => new Response('upstream down', { status: 502 }));
    await expect(fetchDeclaration(DID)).rejects.toThrow(/502/);
  });
});
