import { describe, it, expect } from 'vitest';
import {
  applyIdentity,
  applySeen,
  filterSeen,
  pageKey,
  reposFromUris,
  seenLabel,
  type SeenRepo,
} from '../seenLately';

const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

describe('reposFromUris', () => {
  it('takes the repo of each URI once', () => {
    expect(
      reposFromUris([
        `at://${DID_A}/app.bsky.feed.post/1`,
        `at://${DID_A}/app.bsky.feed.post/2`,
        'at://alice.example/app.bsky.feed.post/3',
        'not a uri',
      ]),
    ).toEqual([DID_A, 'alice.example']);
  });
});

describe('pageKey', () => {
  it('ignores the fragment and never returns the address', () => {
    const a = pageKey('https://example.com/post/1#reply');
    expect(a).toBe(pageKey('https://example.com/post/1'));
    expect(a).not.toContain('example');
    expect(pageKey('https://example.com/post/2')).not.toBe(a);
    expect(pageKey(null)).toBeUndefined();
  });
});

describe('applySeen', () => {
  it('adds a repo it has not met with one page', () => {
    const next = applySeen([], [DID_A], 'p1', 100);
    expect(next).toEqual([{ repo: DID_A, count: 1, lastSeen: 100, lastPage: 'p1' }]);
  });

  it('counts a new page but not the same page twice', () => {
    let entries = applySeen([], [DID_A], 'p1', 100);
    entries = applySeen(entries, [DID_A], 'p1', 200);
    expect(entries[0]).toMatchObject({ count: 1, lastSeen: 200 });
    entries = applySeen(entries, [DID_A], 'p2', 300);
    expect(entries[0]).toMatchObject({ count: 2, lastSeen: 300, lastPage: 'p2' });
  });

  it('counts an account found by handle and DID on one page once', () => {
    const known: SeenRepo[] = [
      { repo: DID_A, did: DID_A, handle: 'alice.example', count: 3, lastSeen: 50, lastPage: 'p0' },
    ];
    const next = applySeen(known, ['alice.example', DID_A], 'p1', 100);
    expect(next).toHaveLength(1);
    expect(next[0].count).toBe(4);
  });

  it('keeps the most recent first', () => {
    let entries = applySeen([], [DID_A], 'p1', 100);
    entries = applySeen(entries, [DID_B], 'p2', 200);
    expect(entries.map(e => e.repo)).toEqual([DID_B, DID_A]);
  });
});

describe('applyIdentity', () => {
  it('merges entries for one account onto its DID and adds up their pages', () => {
    const entries: SeenRepo[] = [
      { repo: 'alice.example', count: 2, lastSeen: 300, lastPage: 'p3' },
      { repo: DID_A, count: 5, lastSeen: 100 },
      { repo: DID_B, count: 1, lastSeen: 200 },
    ];
    const next = applyIdentity(entries, {
      did: DID_A,
      handle: 'alice.example',
      pdsHost: 'pds.example',
    });
    expect(next).toEqual([
      {
        repo: DID_A,
        did: DID_A,
        handle: 'alice.example',
        pdsHost: 'pds.example',
        count: 7,
        lastSeen: 300,
        lastPage: 'p3',
      },
      { repo: DID_B, count: 1, lastSeen: 200 },
    ]);
  });

  it('counts a page both names were counted on once', () => {
    // First sighting: the address gave the handle, the page's tags the DID.
    const entries = applySeen([], ['alice.example', DID_A], 'p1', 100);
    expect(entries).toHaveLength(2);
    const next = applyIdentity(entries, { did: DID_A, handle: 'alice.example' });
    expect(next).toHaveLength(1);
    expect(next![0].count).toBe(1);
  });

  it('does not add an account the log has not seen', () => {
    expect(applyIdentity([], { did: DID_A, handle: 'alice.example' })).toBeNull();
  });

  it('reports no change when the entry already says it', () => {
    const entries: SeenRepo[] = [
      { repo: DID_A, did: DID_A, handle: 'alice.example', pdsHost: 'pds.example', count: 1, lastSeen: 1 },
    ];
    expect(
      applyIdentity(entries, { did: DID_A, handle: 'alice.example', pdsHost: 'pds.example' }),
    ).toBeNull();
  });
});

describe('filterSeen and seenLabel', () => {
  const entries: SeenRepo[] = [
    { repo: DID_A, did: DID_A, handle: 'mitsuhiko.at', pdsHost: 'puffball.host', count: 4, lastSeen: 2 },
    { repo: DID_B, count: 1, lastSeen: 1 },
  ];

  it('matches handle, DID or host, ignoring case and a leading @', () => {
    expect(filterSeen(entries, '@MITSU').map(seenLabel)).toEqual(['mitsuhiko.at']);
    expect(filterSeen(entries, 'puffball')).toHaveLength(1);
    expect(filterSeen(entries, 'bbbb').map(seenLabel)).toEqual([DID_B]);
    expect(filterSeen(entries, '  ')).toHaveLength(2);
  });
});
