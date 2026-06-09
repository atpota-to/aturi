'use client';

import { useEffect, useState } from 'react';
import PostPreview from '@/components/PostPreview';
import RecordPreview from '@/components/RecordPreview';
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

type Props = {
  handle: string;
  did: string;
  collection: string;
  rkey: string;
  /** PDS-fetched record; used as the source for non-post / margin previews. */
  record: AtRecord | null;
  /**
   * Optional action UI (e.g. the explorer's Edit button) rendered inside
   * the generic RecordPreview's footer next to the CID. Ignored by the
   * specialised post / margin previews — those have their own surrounds
   * and the explorer renders the action above them instead.
   */
  footerActions?: import('react').ReactNode;
  /**
   * When true (posts only), collapse the rich Bluesky post card and show
   * just the record's structured data — the user's "minimal post view"
   * preference, mirroring the minimal profile view on repo pages.
   */
  minimalPost?: boolean;
};

/**
 * Returns true when the given collection will render through the generic
 * RecordPreview fallback (i.e. not a post, not a margin lexicon). The
 * explorer uses this to decide whether its edit button gets slotted into
 * the preview's footer or rendered as a standalone chip above the card.
 */
export function previewRendersGeneric(collection: string): boolean {
  if (collection === 'app.bsky.feed.post') return false;
  if (getMarginLexiconType(collection)) return false;
  return true;
}

/**
 * Renders the same rich record preview that universal link pages show —
 * PostPreview for Bluesky posts, the specialised margin previews for the
 * at.margin.* lexicons, and the generic RecordPreview otherwise. Returns
 * null when there's nothing to render yet (e.g. still fetching).
 *
 * Posts need a second fetch (AppView's getPostThread for author info,
 * embeds, engagement counts) because the PDS-only record we already have
 * is just the bare record value.
 */
export default function RichRecordPreview({
  handle,
  did,
  collection,
  rkey,
  record,
  footerActions,
  minimalPost = false,
}: Props) {
  const marginType = getMarginLexiconType(collection);
  const isPost = collection === 'app.bsky.feed.post';

  const [postThread, setPostThread] = useState<PostThread | null>(null);

  useEffect(() => {
    // Minimal view doesn't render the post card, so skip the AppView fetch.
    if (!isPost || minimalPost) {
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
  }, [isPost, minimalPost, did, collection, rkey]);

  const recordForLegacy: GenericRecord | null = record
    ? {
        uri: record.uri,
        cid: record.cid,
        value: record.value,
      }
    : null;

  // Posts: prefer the AppView thread (renders embeds, author, counts) for
  // the rich preview, then surface the underlying record's structured
  // fields beneath it — the same "rich JSON" view every other record type
  // gets through RecordPreview. Without this a post's actual record data
  // (text, facets, langs, reply refs, embed) is only reachable in the
  // collapsed "Raw record JSON" disclosure at the bottom of the page.
  if (isPost) {
    // Minimal view: drop the rich post card, keep just the structured
    // record data (the same RecordPreview shown beneath the full preview).
    if (minimalPost) {
      return recordForLegacy ? (
        <RecordPreview
          record={recordForLegacy}
          collection={collection}
          handle={handle}
          rkey={rkey}
          hideExplorerCtas
        />
      ) : null;
    }
    const post = postThread?.thread[0]?.value.post;
    if (!post) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <PostPreview post={post} parent={postThread?.parent} hideExplorerCtas />
        {recordForLegacy && (
          <RecordPreview
            record={recordForLegacy}
            collection={collection}
            handle={handle}
            rkey={rkey}
            hideExplorerCtas
          />
        )}
      </div>
    );
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

  return (
    <RecordPreview
      record={recordForLegacy}
      collection={collection}
      handle={handle}
      rkey={rkey}
      hideExplorerCtas
      footerActions={footerActions}
    />
  );
}
