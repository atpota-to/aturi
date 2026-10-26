'use client';

import { useEffect, useState } from 'react';
import PostPreview from '@/components/PostPreview';
import ProfileHeader from './ProfileHeader';
import {
  MarginAnnotationPreview,
  MarginBookmarkPreview,
  MarginCollectionItemPreview,
  MarginCollectionPreview,
  MarginHighlightPreview,
  MarginLikePreview,
  MarginReplyPreview,
} from '@/components/margin';
import { getMarginLexiconType } from '@/utils/marginLexicons';
import {
  fetchPostThread,
  type GenericRecord,
  type PostThread,
} from '@/utils/recordFetcher';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import type { IdentityBundle } from '@/utils/atproto/identity';

type Props = {
  handle: string;
  did: string;
  collection: string;
  rkey: string;
  /** PDS-fetched record; the source for the margin previews. */
  record: AtRecord | null;
  /** The repo's resolved identity (DID, handle, PDS) for the profile card. */
  identity: IdentityBundle;
};

/**
 * The account's Bluesky profile record. Its lexicon keys it `literal:self`,
 * and the card drawn for it is the AppView's view of the account rather than
 * this record, so only the `self` record gets one. A record under any other
 * rkey (only possible with validation off) would otherwise be shown as the
 * account's real profile.
 */
function isProfileRecord(collection: string, rkey: string): boolean {
  return collection === 'app.bsky.actor.profile' && rkey === 'self';
}

/**
 * Whether a record has a "rich preview" card — a rendered view distinct from
 * the structured field table (RecordPreview). Posts get the Bluesky post card;
 * the profile record gets the explorer's profile card; the at.margin.*
 * lexicons get their bespoke cards. Generic records have no such card: their
 * rich view *is* the structured field table, so the explorer skips the card
 * section (and its toggle) entirely for them.
 */
export function recordHasRichCard(collection: string, rkey: string): boolean {
  if (collection === 'app.bsky.feed.post') return true;
  if (isProfileRecord(collection, rkey)) return true;
  if (getMarginLexiconType(collection)) return true;
  return false;
}

/**
 * Renders ONLY the rich preview card for a record — the Bluesky post card for
 * posts (via the AppView thread, for author/embeds/counts), the profile card
 * for the profile record, and the bespoke at.margin.* cards for margin
 * lexicons. Returns null for generic records (no card) and while a post's
 * thread or the profile is still loading.
 *
 * The structured field table (RecordPreview) and the raw JSON are separate,
 * independently-toggleable sections that RecordExplorer renders alongside this
 * one — keeping each as its own "section with a toggle underneath".
 */
export default function RichRecordCard({
  handle,
  did,
  collection,
  rkey,
  record,
  identity,
}: Props) {
  const marginType = getMarginLexiconType(collection);
  const isPost = collection === 'app.bsky.feed.post';

  const [postThread, setPostThread] = useState<PostThread | null>(null);

  useEffect(() => {
    if (!isPost) {
      setPostThread(null);
      return undefined;
    }
    let cancelled = false;
    const atUri = `at://${did}/${collection}/${rkey}`;
    fetchPostThread(atUri).then((thread) => {
      if (!cancelled) setPostThread(thread);
    });
    return () => {
      cancelled = true;
    };
  }, [isPost, did, collection, rkey]);

  const recordForLegacy: GenericRecord | null = record
    ? { uri: record.uri, cid: record.cid, value: record.value }
    : null;

  if (isPost) {
    const post = postThread?.thread[0]?.value.post;
    if (!post) return null;
    return <PostPreview post={post} parent={postThread?.parent} hideExplorerCtas />;
  }

  // The profile record's own universal link (`/profile/{handle}/
  // app.bsky.actor.profile/self`) renders as a generic record, so the card's
  // "View the universal link page →" is the one route out to the shareable
  // profile page, the same way a post's card links to its post page.
  if (isProfileRecord(collection, rkey)) {
    return <ProfileHeader identity={identity} />;
  }

  if (!recordForLegacy) return null;

  // Margin lexicons get their own renderers — close visual parity with the
  // universal link page so users get the same affordances.
  if (marginType === 'at.margin.annotation') {
    return <MarginAnnotationPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.bookmark') {
    return <MarginBookmarkPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.highlight') {
    return <MarginHighlightPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.collection') {
    return <MarginCollectionPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.collectionItem') {
    return <MarginCollectionItemPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.reply') {
    return <MarginReplyPreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }
  if (marginType === 'at.margin.like') {
    return <MarginLikePreview record={recordForLegacy} collection={collection} handle={handle} rkey={rkey} />;
  }

  return null;
}
