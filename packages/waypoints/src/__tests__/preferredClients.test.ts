import { describe, it, expect } from 'vitest';
import {
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENT_CATEGORIES,
  buildPreferredClientsRecord,
  clientFromWaypoint,
  clientPlatformFromUserAgent,
  getPreferredClient,
  getPreferredClientUrl,
  getWaypointLinkTemplates,
  parsePreferredClients,
  type DeclaredClient,
} from '../preferredClients';
import { WAYPOINT_DESTINATIONS_DATA, WAYPOINT_ORDER } from '../waypoints.data';

const DID = 'did:plc:abc234def567';
const POST = `at://${DID}/app.bsky.feed.post/3k7`;
const LIST = `at://${DID}/app.bsky.graph.list/l1`;
const TANGLED = `at://${DID}/sh.tangled.repo/r1`;

const BLACKSKY = clientFromWaypoint('blacksky')!;
const BLUESKY = clientFromWaypoint('bluesky')!;
const DEER = clientFromWaypoint('deer')!;
const PDSLS = clientFromWaypoint('pdsls')!;

describe('clientFromWaypoint', () => {
  it('describes a catalog client by origin, name, id and templates', () => {
    expect(BLACKSKY).toEqual({
      url: 'https://blacksky.community',
      name: 'Blacksky',
      waypoint: 'blacksky',
      templates: {
        profile: 'https://blacksky.community/profile/{handle}',
        post: 'https://blacksky.community/profile/{handle}/post/{rkey}',
        list: 'https://blacksky.community/profile/{handle}/lists/{rkey}',
      },
    });
  });

  it('writes a DID-else-handle builder as {actor}', () => {
    expect(PDSLS.templates).toEqual({
      profile: 'https://pdsls.dev/at://{actor}',
      post: 'https://pdsls.dev/at://{actor}/app.bsky.feed.post/{rkey}',
      list: 'https://pdsls.dev/at://{actor}/app.bsky.graph.list/{rkey}',
      record: 'https://pdsls.dev/at://{actor}/{collection}/{rkey}',
    });
  });

  it('leaves out a record template that would really open the profile', () => {
    // Blacksky's getUrl answers an unknown collection with the profile URL.
    expect(BLACKSKY.templates?.record).toBeUndefined();
  });

  it('returns null for an unknown id', () => {
    expect(clientFromWaypoint('nope')).toBeNull();
    expect(getWaypointLinkTemplates('nope')).toBeNull();
  });

  it('can declare every catalog client offered for a known category', () => {
    for (const category of PREFERRED_CLIENT_CATEGORIES) {
      const members = WAYPOINT_ORDER.filter((id) =>
        WAYPOINT_DESTINATIONS_DATA[id].redirectCompat.includes(category),
      );
      expect(members.length).toBeGreaterThan(1);
      for (const id of members) expect(clientFromWaypoint(id), id).not.toBeNull();
    }
  });

  it('derives templates that reproduce getUrl for every waypoint', () => {
    const handle = 'bob.example.org';
    const did = 'did:plc:zzz777yyy888';
    const inputs = {
      profile: [undefined, undefined],
      post: ['app.bsky.feed.post', 'p1'],
      list: ['app.bsky.graph.list', 'l1'],
      record: ['org.example.thing', 'r1'],
    } as const;
    for (const id of WAYPOINT_ORDER) {
      const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
      const client = clientFromWaypoint(id);
      for (const [kind, [collection, rkey]] of Object.entries(inputs)) {
        if (!client?.templates?.[kind as keyof typeof inputs]) continue;
        const target = collection
          ? { handle, did, collection, rkey }
          : { handle, did };
        const onlyKind: DeclaredClient = {
          url: client.url,
          templates: { [kind]: client.templates[kind as keyof typeof inputs] },
        };
        expect(getPreferredClientUrl(onlyKind, target), `${id} ${kind}`).toBe(
          waypoint.getUrl(handle, collection, rkey, did),
        );
      }
    }
  });
});

describe('getPreferredClientUrl', () => {
  it('opens posts, lists and profiles from an AT URI', () => {
    expect(getPreferredClientUrl(BLACKSKY, POST)).toBe(
      `https://blacksky.community/profile/${DID}/post/3k7`,
    );
    expect(getPreferredClientUrl(BLACKSKY, LIST)).toBe(
      `https://blacksky.community/profile/${DID}/lists/l1`,
    );
    expect(getPreferredClientUrl(BLACKSKY, `at://${DID}`)).toBe(
      `https://blacksky.community/profile/${DID}`,
    );
  });

  it('takes a target object, preferring the handle where the template does', () => {
    expect(
      getPreferredClientUrl(BLUESKY, {
        handle: 'alice.example.com',
        did: DID,
        collection: 'app.bsky.feed.post',
        rkey: '3k7',
      }),
    ).toBe('https://bsky.app/profile/alice.example.com/post/3k7');
  });

  it('opens any record in an explorer, and returns null where a client cannot', () => {
    expect(getPreferredClientUrl(PDSLS, TANGLED)).toBe(
      `https://pdsls.dev/at://${DID}/sh.tangled.repo/r1`,
    );
    expect(getPreferredClientUrl(BLACKSKY, TANGLED)).toBeNull();
  });

  it('falls back from post to record template', () => {
    const client: DeclaredClient = {
      url: 'https://explorer.example',
      templates: { record: 'https://explorer.example/{did}/{collection}/{rkey}' },
    };
    expect(getPreferredClientUrl(client, POST)).toBe(
      `https://explorer.example/${DID}/app.bsky.feed.post/3k7`,
    );
  });

  it('fills kinds the record leaves out from the catalog waypoint it names', () => {
    const partial: DeclaredClient = {
      url: 'https://deer.social',
      waypoint: 'deer',
      templates: { profile: 'https://deer.social/profile/{handle}' },
    };
    expect(getPreferredClientUrl(partial, POST)).toBe(
      `https://deer.social/profile/${DID}/post/3k7`,
    );
  });

  it('prefers the record’s own template over the catalog’s', () => {
    const custom: DeclaredClient = {
      ...DEER,
      templates: { post: 'https://deer.social/p/{rkey}' },
    };
    expect(getPreferredClientUrl(custom, POST)).toBe('https://deer.social/p/3k7');
  });

  it('returns null when a placeholder has no value', () => {
    const needsDid: DeclaredClient = {
      url: 'https://x.example',
      templates: { profile: 'https://x.example/{did}' },
    };
    expect(getPreferredClientUrl(needsDid, { handle: 'alice.example.com' })).toBeNull();
    expect(getPreferredClientUrl(needsDid, { handle: 'alice.example.com', did: DID })).toBe(
      `https://x.example/${DID}`,
    );
  });

  it('encodes substituted values but keeps colons', () => {
    const client: DeclaredClient = {
      url: 'https://x.example',
      templates: { record: 'https://x.example/{actor}/{collection}/{rkey}' },
    };
    expect(
      getPreferredClientUrl(client, { did: DID, collection: 'a.b.c', rkey: 'a/b?c' }),
    ).toBe(`https://x.example/${DID}/a.b.c/a%2Fb%3Fc`);
  });

  it('never returns a non-http(s) URL', () => {
    const hostile: DeclaredClient = {
      url: 'https://x.example',
      templates: {
        profile: 'javascript:alert({handle})',
        post: 'data:text/html,{rkey}',
      },
    };
    expect(getPreferredClientUrl(hostile, `at://${DID}`)).toBeNull();
    expect(getPreferredClientUrl(hostile, POST)).toBeNull();
  });

  it('rejects AT URIs it cannot parse, including permissioned spaces', () => {
    expect(getPreferredClientUrl(PDSLS, 'https://bsky.app/profile/x')).toBeNull();
    expect(getPreferredClientUrl(PDSLS, `at://${DID}/space/x.y/z`)).toBeNull();
  });
});

describe('parsePreferredClients', () => {
  it('round-trips what buildPreferredClientsRecord writes', () => {
    const record = buildPreferredClientsRecord(
      [{ category: 'bluesky-social', client: BLACKSKY, mobile: DEER }],
      new Date('2026-01-02T03:04:05.000Z'),
    );
    expect(record).toEqual({
      $type: PREFERRED_CLIENTS_NSID,
      preferences: [{ category: 'bluesky-social', client: BLACKSKY, mobile: DEER }],
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(parsePreferredClients(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it('refuses values that are not a declaration', () => {
    expect(parsePreferredClients(null)).toBeNull();
    expect(parsePreferredClients('x')).toBeNull();
    expect(parsePreferredClients({ $type: 'app.bsky.feed.post', preferences: [] })).toBeNull();
    expect(parsePreferredClients({ $type: PREFERRED_CLIENTS_NSID })).toBeNull();
  });

  it('drops malformed entries and unsafe clients one by one', () => {
    const parsed = parsePreferredClients({
      $type: PREFERRED_CLIENTS_NSID,
      preferences: [
        'nope',
        { client: BLACKSKY },
        { category: 'bluesky-social', client: { url: 'javascript:alert(1)' } },
        {
          category: 'atproto-explorer',
          client: { url: 'https://pdsls.dev', name: 42, templates: { record: 7, profile: 'https://pdsls.dev/at://{did}' } },
          desktop: { url: 'not a url' },
        },
        { category: 'org.example.thing', mobile: { url: 'https://thing.example' } },
      ],
    });
    expect(parsed?.preferences).toEqual([
      {
        category: 'atproto-explorer',
        client: { url: 'https://pdsls.dev', templates: { profile: 'https://pdsls.dev/at://{did}' } },
      },
      { category: 'org.example.thing', mobile: { url: 'https://thing.example' } },
    ]);
  });

  it('build keeps the first entry per category and drops empty ones', () => {
    const record = buildPreferredClientsRecord([
      { category: 'bluesky-social' },
      { category: 'bluesky-social', client: DEER },
      { category: 'bluesky-social', client: BLACKSKY },
    ]);
    expect(record.preferences).toEqual([{ category: 'bluesky-social', client: DEER }]);
  });
});

describe('clientPlatformFromUserAgent', () => {
  it('reads phones and tablets as mobile, the rest as desktop', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const androidTablet =
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const windows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    expect(clientPlatformFromUserAgent(iphone)).toBe('mobile');
    expect(clientPlatformFromUserAgent(androidTablet)).toBe('mobile');
    expect(clientPlatformFromUserAgent(windows)).toBe('desktop');
    expect(clientPlatformFromUserAgent(mac)).toBe('desktop');
    // iPadOS sends the Mac string; only the touchscreen gives it away.
    expect(clientPlatformFromUserAgent(mac, 5)).toBe('mobile');
  });
});

describe('getPreferredClient', () => {
  const record = buildPreferredClientsRecord([
    { category: 'bluesky-social', client: BLUESKY, mobile: BLACKSKY },
    { category: 'atproto-explorer', desktop: PDSLS },
  ]);

  it('uses the platform’s client when declared, else the general one', () => {
    expect(getPreferredClient(record, 'bluesky-social', { platform: 'mobile' })).toBe(BLACKSKY);
    expect(getPreferredClient(record, 'bluesky-social', { platform: 'desktop' })).toBe(BLUESKY);
    expect(getPreferredClient(record, 'bluesky-social')).toBe(BLUESKY);
  });

  it('does not guess a platform client when the platform is unknown', () => {
    expect(getPreferredClient(record, 'atproto-explorer', { platform: 'desktop' })).toBe(PDSLS);
    expect(getPreferredClient(record, 'atproto-explorer', { platform: 'mobile' })).toBeNull();
    expect(getPreferredClient(record, 'atproto-explorer')).toBeNull();
  });

  it('returns null for a missing record or category', () => {
    expect(getPreferredClient(null, 'bluesky-social')).toBeNull();
    expect(getPreferredClient(record, 'standard-site')).toBeNull();
  });
});
