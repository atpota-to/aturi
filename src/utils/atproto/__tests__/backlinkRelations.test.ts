import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appForCollection,
  backlinkPathLabels,
  bucketRecordSources,
  bucketSources,
  recordRelationOf,
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

// Sources seen pointing at records on the live index (a post, a feed, a
// list, a starter pack, publications and their documents), by the linking
// collection and path, the target's collection, and the relationship.
const RECORD_CASES: [string, string, string, string][] = [
  ['app.bsky.feed.like', '.subject.uri', 'app.bsky.feed.post', 'like'],
  ['site.standard.graph.recommend', '.document', 'site.standard.document', 'like'],
  ['app.bsky.feed.repost', '.subject.uri', 'app.bsky.feed.post', 'repost'],
  ['app.bsky.feed.post', '.reply.parent.uri', 'app.bsky.feed.post', 'reply'],
  ['pub.leaflet.comment', '.subject', 'pub.leaflet.document', 'reply'],
  ['app.bsky.feed.post', '.reply.root.uri', 'app.bsky.feed.post', 'thread'],
  ['app.bsky.feed.post', '.embed.record.uri', 'app.bsky.feed.post', 'quote'],
  ['app.bsky.feed.post', '.embed.record.record.uri', 'app.bsky.feed.post', 'quote'],
  ['app.bsky.feed.post', '.embed.generator.uri', 'app.bsky.feed.generator', 'quote'],
  [
    'app.bsky.feed.post',
    '.embed.external.associatedRefs[com.atproto.repo.strongRef].uri',
    'site.standard.publication',
    'quote',
  ],
  [
    'pub.leaflet.comment',
    '.facets[].features[pub.leaflet.richtext.facet#atMention].atURI',
    'pub.leaflet.publication',
    'mention',
  ],
  ['app.bsky.graph.listitem', '.list', 'app.bsky.graph.list', 'item'],
  ['pub.leaflet.document', '.publication', 'pub.leaflet.publication', 'item'],
  ['site.standard.document', '.site', 'site.standard.publication', 'item'],
  ['pub.leaflet.graph.subscription', '.publication', 'pub.leaflet.publication', 'subscribe'],
  ['site.standard.graph.subscription', '.publication', 'site.standard.publication', 'subscribe'],
  ['app.bsky.graph.follow', '.via.uri', 'app.bsky.graph.starterpack', 'via'],
  ['app.bsky.actor.profile', '.joinedViaStarterPack.uri', 'app.bsky.graph.starterpack', 'via'],
  ['app.bsky.graph.starterpack', '.feeds[].uri', 'app.bsky.feed.generator', 'other'],
  ['app.bsky.graph.referencelistoptout', '.subject', 'app.bsky.graph.list', 'other'],
  ['app.standard-reader.read', '.subject', 'site.standard.document', 'other'],
];

for (const [collection, path, target, relation] of RECORD_CASES) {
  test(`${collection} ${path.slice(0, 40)} to a ${target.split('.').pop()} is ${relation}`, () => {
    assert.equal(recordRelationOf(collection, path, target), relation);
  });
}

test('a field is only an owner field on a record of the type it names', () => {
  assert.equal(recordRelationOf('pub.leaflet.document', '.publication', 'app.bsky.feed.post'), 'other');
  assert.equal(recordRelationOf('pub.leaflet.document', '.publication'), 'other');
});

test('a record’s buckets put what was written first and keep direct replies apart from the thread', () => {
  const buckets = bucketRecordSources(
    [
      source('app.bsky.feed.like', '.subject.uri', 116, 116),
      source('app.bsky.feed.post', '.reply.root.uri', 9, 7),
      source('app.bsky.feed.post', '.reply.parent.uri', 6, 6),
      source('app.bsky.feed.repost', '.subject.uri', 4, 4),
      source('app.bsky.feed.post', '.embed.record.uri', 1, 1),
    ],
    'app.bsky.feed.post',
  );
  assert.deepEqual(
    buckets.map((b) => [b.relation, b.count]),
    [
      ['reply', 6],
      ['thread', 9],
      ['quote', 1],
      ['repost', 4],
      ['like', 116],
    ],
  );
});
