import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appForCollection,
  backlinkPathLabels,
  bucketSources,
  relationOf,
  shortBacklinkPath,
} from '@/utils/atproto/backlinkRelations';
import type { BacklinkSource } from '@/utils/atproto/constellation';

// Sources seen pointing at large accounts on the live index, by collection
// and path, with the relationship each should land in.
const CASES: [string, string, string][] = [
  ['app.bsky.graph.follow', '.subject', 'follow'],
  ['so.sprk.graph.follow', '.subject', 'follow'],
  ['sh.tangled.graph.follow', '.subject', 'follow'],
  ['network.cosmik.follow', '.subject', 'follow'],
  ['app.bsky.feed.post', '.facets[app.bsky.richtext.facet].features[app.bsky.richtext.facet#mention].did', 'mention'],
  ['app.bsky.feed.post', '.facets[].features[com.atproto.richtext.facet#mention].did', 'mention'],
  ['app.bsky.feed.post', '.facets[].features[].did', 'mention'],
  [
    'site.standard.document',
    '.content.pages[pub.leaflet.pages.linearDocument].blocks[pub.leaflet.pages.linearDocument#block].block.facets[].features[pub.leaflet.richtext.facet#didMention].did',
    'mention',
  ],
  ['app.bsky.graph.list', '.descriptionFacets[].features[app.bsky.richtext.facet#mention].did', 'mention'],
  ['app.bsky.graph.listitem', '.subject', 'list'],
  ['com.portal.channel', '.members[]', 'list'],
  ['place.stream.live.recommendations', '.streamers[]', 'list'],
  ['app.bsky.graph.block', '.subject', 'block'],
  ['app.bsky.feed.block', '.subject', 'block'],
  ['app.bsky.graph.verification', '.subject', 'verify'],
  ['app.bsky.graph.verification', '.issuer', 'verify'],
  ['app.witchsky.preferences', '.deerVerification.trusted[]', 'verify'],
  ['fund.at.graph.endorse', '.subject', 'endorse'],
  ['sh.tangled.graph.vouch', '.', 'endorse'],
  ['space.myspace.topFriends', '.friends[]', 'endorse'],
  ['computer.aetheros.people.contact', '.did', 'endorse'],
  ['app.bsky.graph.starterpack', '.feeds[].creator.did', 'embed'],
  ['app.bsky.graph.starterpack', '.feeds[].creator.verification.verifications[].issuer', 'embed'],
  ['app.bsky.feed.post', '.reply.parent.author.verification.verifications[].issuer', 'embed'],
  ['app.bsky.feed.post', '.embed.generator.uri', 'embed'],
  ['app.bsky.graph.cancellation', '.subject', 'other'],
  ['place.stream.chat.message', '.streamer', 'other'],
  ['org.hypercerts.claim.measurement', '.measurers[].did', 'other'],
];

for (const [collection, path, relation] of CASES) {
  test(`${collection} ${path.slice(0, 48)} is ${relation}`, () => {
    assert.equal(relationOf(collection, path), relation);
  });
}

test('a follow lexicon linking from some other field is not a follower', () => {
  assert.equal(relationOf('app.example.graph.follow', '.via.did'), 'other');
});

test('apps with a waypoint mark keep their name', () => {
  assert.deepEqual(appForCollection('app.bsky.graph.follow'), {
    key: 'bsky.app',
    name: 'Bluesky',
    waypoint: 'bluesky',
  });
  assert.equal(appForCollection('sh.tangled.graph.follow').waypoint, 'tangled');
});

test('other apps are named by their domain', () => {
  assert.deepEqual(appForCollection('so.sprk.graph.follow'), {
    key: 'sprk.so',
    name: 'sprk.so',
    waypoint: null,
  });
  // Project hosts give each project its own subdomain.
  assert.equal(appForCollection('io.github.someone.blog.post').key, 'someone.github.io');
});

test('short paths drop the NSIDs inside type qualifiers', () => {
  assert.equal(
    shortBacklinkPath('.facets[app.bsky.richtext.facet].features[app.bsky.richtext.facet#mention].did'),
    '.facets[facet].features[#mention].did',
  );
  assert.equal(shortBacklinkPath('.subject'), '.subject');
  assert.equal(shortBacklinkPath('.'), '(record root)');
});

test('path labels keep the namespace where two would read the same', () => {
  const a = '.facets[].features[app.bsky.richtext.facet#mention].did';
  const b = '.facets[].features[com.atproto.richtext.facet#mention].did';
  const c = '.embed.generator.uri';
  const labels = backlinkPathLabels([a, b, c]);
  assert.equal(labels.get(a), '.facets[].features[app.bsky…#mention].did');
  assert.equal(labels.get(b), '.facets[].features[com.atproto…#mention].did');
  assert.equal(labels.get(c), '.embed.generator.uri');
});

function source(collection: string, path: string, count: number, distinctDids: number | null): BacklinkSource {
  return { collection, path, source: `${collection}:${path.replace(/^\./, '')}`, count, distinctDids };
}

test('buckets follow the tile order, sum counts and rank apps', () => {
  const buckets = bucketSources([
    source('app.bsky.graph.follow', '.subject', 1000, 990),
    source('app.bsky.graph.block', '.subject', 40, 40),
    source('so.sprk.graph.follow', '.subject', 12, null),
    source('app.bsky.feed.post', '.facets[].features[app.bsky.richtext.facet#mention].did', 30, 9),
    source('sh.tangled.graph.follow', '.subject', 20, 20),
  ]);
  assert.deepEqual(
    buckets.map((b) => b.relation),
    ['follow', 'mention', 'block'],
  );
  const follow = buckets[0];
  assert.equal(follow.count, 1032);
  assert.equal(follow.accounts, 1010);
  assert.equal(follow.sources.length, 3);
  assert.deepEqual(
    follow.apps.map((a) => [a.app.name, a.count]),
    [
      ['Bluesky', 1000],
      ['Tangled', 20],
      ['sprk.so', 12],
    ],
  );
});

test('no sources, no buckets', () => {
  assert.deepEqual(bucketSources([]), []);
});
