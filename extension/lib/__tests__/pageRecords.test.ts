import { describe, it, expect } from 'vitest';
import {
  RUN_CAP,
  bareUrl,
  hiddenReferenceCount,
  initialOf,
  joints,
  kindLabel,
  recordTitle,
  referencesFromHits,
  runReferences,
  whereLabel,
} from '../pageRecords';
import type { DetectedAtUri } from '../inspectScanner';

const PAGE_DID = 'did:plc:pagepagepagepagepagepage';
const OTHER_DID = 'did:plc:otherotherotherotherothe';
const POST = 'app.bsky.feed.post';

describe('referencesFromHits', () => {
  const page = { handle: 'page.example', did: PAGE_DID, collection: POST, rkey: 'self1' };

  it("drops the page's own record however it was found", () => {
    const hits: DetectedAtUri[] = [
      { uri: `at://${PAGE_DID}/${POST}/self1`, where: 'at-tags', relation: 'canonical' },
      { uri: `at://page.example/${POST}/self1`, where: 'url' },
      { uri: `at://${OTHER_DID}/${POST}/abc`, where: 'jsonld' },
    ];
    const refs = referencesFromHits(hits, page);
    expect(refs.map(r => r.key)).toEqual([`at://${OTHER_DID}/${POST}/abc`]);
    expect(refs[0].where).toBe('jsonld');
    expect(refs[0].match.parsed.type).toBe('post');
  });

  it("keeps another record by the page's author", () => {
    const hits: DetectedAtUri[] = [{ uri: `at://${PAGE_DID}/${POST}/other`, where: 'jsonld' }];
    expect(referencesFromHits(hits, page)).toHaveLength(1);
  });

  it("treats a profile page's profile record as the page", () => {
    const profilePage = { handle: 'page.example', did: PAGE_DID };
    const hits: DetectedAtUri[] = [
      { uri: `at://${PAGE_DID}`, where: 'at-tags', relation: 'canonical' },
      { uri: `at://${PAGE_DID}/app.bsky.actor.profile/self`, where: 'link' },
      { uri: `at://${PAGE_DID}/${POST}/abc`, where: 'link' },
    ];
    expect(referencesFromHits(hits, profilePage).map(r => r.key)).toEqual([
      `at://${PAGE_DID}/${POST}/abc`,
    ]);
  });

  it('keeps every hit when the page has no record of its own, and skips space URIs', () => {
    const hits: DetectedAtUri[] = [
      { uri: `at://${PAGE_DID}/${POST}/self1`, where: 'text' },
      { uri: `at://${OTHER_DID}/space/com.example.space/abc`, where: 'text' },
    ];
    expect(referencesFromHits(hits, null).map(r => r.key)).toEqual([
      `at://${PAGE_DID}/${POST}/self1`,
    ]);
  });
});

describe('runReferences', () => {
  const refs = Array.from({ length: 20 }, (_, i) =>
    referencesFromHits([{ uri: `at://${OTHER_DID}/${POST}/r${i}`, where: 'jsonld' }], null)[0],
  );

  it('caps the run and adds the open record when it lies beyond the cap', () => {
    expect(runReferences(refs, null)).toHaveLength(RUN_CAP);
    const beyond = refs[15].key;
    const run = runReferences(refs, beyond);
    expect(run).toHaveLength(RUN_CAP + 1);
    expect(run[RUN_CAP].key).toBe(beyond);
    expect(runReferences(refs, refs[3].key)).toHaveLength(RUN_CAP);
  });
});

describe('labels', () => {
  it('says where a reference was found in lowercase', () => {
    expect(whereLabel('jsonld')).toBe('in structured data');
    expect(whereLabel('at-tags', 'author')).toBe('declared as at:author');
    expect(whereLabel('at-tags')).toBe('declared by the page');
  });

  it('names the kind and the title', () => {
    expect(kindLabel('post', POST)).toBe('Post');
    expect(kindLabel('record', 'app.bsky.feed.generator')).toBe('Feed');
    expect(recordTitle('post', POST, 'dame.is')).toBe('Post by dame.is');
    expect(recordTitle('profile', undefined, 'dame.is')).toBe('dame.is');
    expect(recordTitle('unknown', undefined, 'dame.is')).toBe('dame.is');
    expect(initialOf('did:plc:xyz')).toBe('X');
    expect(initialOf('dame.is')).toBe('D');
  });
});

describe('joints', () => {
  it('splits after slashes and before dots', () => {
    expect(joints('pds.atpota.to')).toEqual(['pds', '.atpota', '.to']);
    expect(joints(`at://${OTHER_DID}/app.bsky/x`)).toEqual([
      'at:/',
      '/',
      `${OTHER_DID}/`,
      'app',
      '.bsky/',
      'x',
    ]);
    expect(joints('bafyrei')).toEqual(['bafyrei']);
    expect(joints('a/b').join('')).toBe('a/b');
  });

  it('drops the scheme for display', () => {
    expect(bareUrl('https://aturi.to/profile/x')).toBe('aturi.to/profile/x');
  });
});

describe('hiddenReferenceCount', () => {
  const tabs = [0, 100, 200, 300].map(left => ({ left, width: 90 }));

  it('counts everything but the tabs fully clear of the fades', () => {
    // At rest: only the end fades, so the tab ending at 290 is clear of a
    // 250px view's end fade only if it ends by 218.
    expect(
      hiddenReferenceCount(tabs, { scrollLeft: 0, width: 250, scrolled: false, atEnd: false }, 4),
    ).toBe(2);
    // At the end: only the start fades.
    expect(
      hiddenReferenceCount(tabs, { scrollLeft: 140, width: 250, scrolled: true, atEnd: true }, 4),
    ).toBe(2);
    // Everything in view.
    expect(
      hiddenReferenceCount(tabs, { scrollLeft: 0, width: 400, scrolled: false, atEnd: true }, 4),
    ).toBe(0);
    // References beyond the run always count.
    expect(
      hiddenReferenceCount(tabs, { scrollLeft: 0, width: 400, scrolled: false, atEnd: true }, 30),
    ).toBe(26);
  });
});
