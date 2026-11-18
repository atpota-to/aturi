'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo } from '@/utils/atproto/urls';
import { listSpaceRecords } from '@/utils/atproto/spaceClient';
import { formatCount } from '../collectionListHelpers';
import { useOwnPdsTransport } from './useSpaceAccess';
import { SkeletonRowList } from '../skeletons/primitives';

/**
 * Your own collections in a space, at the top of the space page.
 *
 * The public explorer's shape is repo → collections → records, and a space
 * page used to break it: your records were a single text link below the
 * authority card, the type declaration, the configuration and the member
 * list, and only in one access state. Everything a space page knows about
 * itself is reference material, and reference material was arriving first.
 *
 * So the space page now opens the same way a repo page does — the things you
 * can click into — and the descriptive cards moved below.
 *
 * Reading your own repo is the one space read that needs no credential: the
 * repo host compares the OAuth token's DID against the requested repo, so a
 * `read_self` grant addresses exactly this and nothing else. That is why this
 * section can render for a member whose space credential was refused.
 */

/**
 * One page is enough to summarise. This lists collections, not records, and a
 * repo with more than this many records in a space still shows every
 * collection it has touched in the first page — with the note below saying so
 * when it doesn't.
 */
const SUMMARY_LIMIT = 500;

type CollectionSummary = { collection: string; count: number };

export default function YourSpaceRecordsSection({
  space,
  spacePath,
  myDid,
}: {
  space: string;
  /** `/explore/{authority}/space/{type}/{skey}` — the base every link hangs off. */
  spacePath: string;
  myDid: string;
}) {
  const { pds } = useAtprotoSession();
  // The plain OAuth transport, not `useSpaceRepoAccess`. That hook guards
  // reads of *another* member's repo, where both the DID and the host it
  // resolves to come out of the address bar — and it withholds a transport
  // until a space credential exists. Your own repo needs no credential: the
  // request goes to your own PDS carrying your own token. Routing this
  // through the credential path made the section sit on "checking what you
  // can read" until the visitor clicked unlock, for records that were
  // readable the whole time.
  const transport = useOwnPdsTransport();

  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCollections([]);
    setComplete(true);
    setError(null);
    if (!transport || !pds) return undefined;

    setLoading(true);
    // `excludeValues` because this is a count per collection: the values are
    // the expensive half of the response and nothing here renders them.
    listSpaceRecords(transport, pds, {
      space,
      repo: myDid,
      limit: SUMMARY_LIMIT,
      excludeValues: true,
    })
      .then((page) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const record of page.records) {
          counts.set(record.collection, (counts.get(record.collection) ?? 0) + 1);
        }
        setCollections(
          [...counts.entries()]
            .map(([collection, count]) => ({ collection, count }))
            .sort((a, b) => a.collection.localeCompare(b.collection)),
        );
        setComplete(!page.cursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transport, pds, space, myDid]);

  const myRepoPath = `${spacePath}/${encodeRepo(myDid)}`;

  return (
    <section className="fx-card fx-sp-section">
      <div className="fx-sp-head">
        <h2 className="fx-sp-h2">Your records in this space</h2>
        <span className="fx-sp-head-end">
          <Link href={myRepoPath} prefetch={false} className="fx-sp-head-link">
            Open your repository →
          </Link>
        </span>
      </div>

      {!transport && <p className="fx-sp-msg">Checking what you can read here…</p>}

      {transport && error && <p className="fx-sp-err">{error}</p>}

      {transport && !error && loading && collections.length === 0 && (
        <div className="fx-sp-body">
          <SkeletonRowList rows={3} trailingWidth="4rem" />
        </div>
      )}

      {transport && !error && !loading && collections.length === 0 && (
        <p className="fx-sp-msg">You haven’t written anything to this space yet.</p>
      )}

      {collections.length > 0 && (
        <ul className="fx-sp-list">
          {collections.map(({ collection, count }) => (
            <li key={collection}>
              <Link href={`${myRepoPath}/${collection}`} prefetch={false} className="fx-sp-row">
                <code className="fx-sp-row-main">{collection}</code>
                <span className="fx-sp-row-end">
                  {formatCount(count)}
                  {complete ? '' : '+'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!complete && collections.length > 0 && (
        <p className="fx-sp-note fx-sp-foot">
          Counted from the first {formatCount(SUMMARY_LIMIT)} records, so these
          are lower bounds. Open a collection for its full listing.
        </p>
      )}
    </section>
  );
}
