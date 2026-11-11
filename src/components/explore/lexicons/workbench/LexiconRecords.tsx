'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Radio } from 'lucide-react';
import { replay } from '@/lib/motion';
import { createJetstreamConnection } from '@/utils/atproto/jetstream';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { formatTidRelative } from '@/utils/atproto/tid';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import type { ApiRecord } from '@/utils/ufos/config';
import { CHROME_RESULTS_ID } from '../../ChromeBarContext';
import { SkeletonBar } from '../../skeletons/primitives';
import { Credit } from '../primitives';
import { useProfiles } from './useDidLabel';
import { useRecentRecords } from './useLexiconData';

/** How many records the list keeps while Live adds to it. */
const LIVE_CAP = 300;

/** A record's `?peek=` value: an AT URI without its scheme. */
export function peekKeyOf(r: Pick<ApiRecord, 'did' | 'collection' | 'rkey'>): string {
  return `${r.did}/${r.collection}/${r.rkey}`;
}

/** Where a record lives in the account explorer, its author spelled as a handle when known. */
export function recordPathOf(r: Pick<ApiRecord, 'did' | 'collection' | 'rkey'>, handle?: string | null): string {
  return `/explore/${encodeRepo(handle || r.did)}/${r.collection}/${encodeURIComponent(r.rkey)}`;
}

/**
 * A row for one record: who wrote it, a line of what it says and when it
 * arrived. The link is the record's page in its author's repository, and
 * `data-peek` asks the shell to open it beside the list instead
 * (LexiconShell), as a linking record does in the account explorer.
 */
export function RecordRow({
  record,
  current,
  profile,
}: {
  record: ApiRecord;
  current: boolean;
  profile: { handle?: string; displayName?: string; avatar?: string } | null | undefined;
}) {
  const preview = previewFor(record.record);
  const when = new Date(record.time_us / 1000);
  const handle = profile?.handle ?? null;
  return (
    <li className="fx-lx-item">
      <Link
        href={recordPathOf(record, handle)}
        prefetch={false}
        rel="nofollow"
        data-peek={peekKeyOf(record)}
        className="fx-lx-rec"
        data-current={current || undefined}
        aria-current={current ? 'true' : undefined}
      >
        <span className="fx-lx-rec-who">
          {profile?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/')}
              alt=""
              width={20}
              height={20}
              className="fx-lx-rec-avatar"
            />
          ) : (
            <span className="fx-lx-rec-avatar" aria-hidden />
          )}
          <span className="fx-lx-rec-handle" title={record.did}>
            {handle ? `@${handle}` : shortDid(record.did)}
          </span>
        </span>
        <span className="fx-lx-rec-text">{preview || <code>{record.rkey}</code>}</span>
        <time className="fx-lx-rec-time" dateTime={when.toISOString()} title={when.toISOString()}>
          {formatTidRelative(when)}
        </time>
      </Link>
    </li>
  );
}

/**
 * A lexicon's recent records, in the main pane over the list it was opened
 * from: the latest UFOs sampled, then, with Live on, every new one
 * Jetstream sends for the NSID, network-wide. Opening one shows it in the
 * inspector; the list stays.
 */
export default function LexiconRecordsView({
  nsid,
  backHref,
  backLabel,
  peekKey,
  onItems,
}: {
  nsid: string;
  /** The lexicon beside its list again. */
  backHref: string;
  backLabel: string;
  /** The record open in the inspector, as `?peek=` spells it. */
  peekKey: string | null;
  /** Every record in the list, in order, for J and K. */
  onItems: (keys: string[]) => void;
}) {
  const sampled = useRecentRecords(nsid);
  const [live, setLive] = useState(false);
  const [arrived, setArrived] = useState<ApiRecord[]>([]);
  const dotRef = useRef<HTMLSpanElement>(null);
  const lastBlip = useRef(0);

  useEffect(() => {
    if (!live) return undefined;
    return createJetstreamConnection({ wantedCollections: [nsid], wantedOps: ['create'] }, (evt) => {
      if (evt.commit.collection !== nsid) return;
      if (Date.now() - lastBlip.current > 1200) {
        lastBlip.current = Date.now();
        replay(dotRef.current, 'data-blip');
      }
      const next: ApiRecord = {
        did: evt.did,
        collection: evt.commit.collection,
        rkey: evt.commit.rkey,
        record: evt.commit.record ?? {},
        time_us: evt.time_us,
      };
      setArrived((prev) => (prev.some((r) => r.did === next.did && r.rkey === next.rkey) ? prev : [next, ...prev].slice(0, LIVE_CAP)));
    });
  }, [live, nsid]);

  const records = useMemo(() => {
    const base = sampled.data ?? [];
    const seen = new Set(arrived.map(peekKeyOf));
    return [...arrived, ...base.filter((r) => !seen.has(peekKeyOf(r)))];
  }, [arrived, sampled.data]);

  const joined = records.map(peekKeyOf).join(' ');
  useEffect(() => {
    onItems(joined ? joined.split(' ') : []);
  }, [joined, onItems]);

  const profiles = useProfiles(useMemo(() => records.slice(0, 100).map((r) => r.did), [records]));

  return (
    <div className="fx-wb-pane fx-lx-pane">
      <div className="fx-wb-pane-head">
        <div className="fx-titlebar">
          <div className="fx-title-row fx-lx-records-title">
            <Link href={backHref} prefetch={false} className="fx-lx-back" title={`Back to ${backLabel}`}>
              <ArrowLeft size={14} aria-hidden />
              <span>{backLabel}</span>
            </Link>
            <h1 className="fx-h1">Recent records</h1>
          </div>
          <div className="fx-actions">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              className="fx-btn"
              title={live ? 'Stop streaming new records' : 'Stream new records from Jetstream as they are written'}
            >
              <span ref={dotRef} aria-hidden className="fx-dot" data-live={live || undefined} />
              Live
            </button>
            <Link
              href={`/tools/stream?collection=${encodeURIComponent(nsid)}`}
              prefetch={false}
              className="fx-btn"
              title="Every create, update and delete for this lexicon in the stream monitor"
            >
              <Radio size={14} aria-hidden />
              Stream monitor
            </Link>
          </div>
        </div>
        <p className="fx-lx-sub">
          <code className="fx-lx-sub-nsid">{nsid}</code>{' '}
          {live
            ? 'New records from Jetstream as they’re written, over the latest UFOs sampled.'
            : 'The latest records UFOs sampled from the firehose, from every account that writes them.'}
        </p>
      </div>
      <section aria-label="Records" className="fx-records fx-wb-records" id={CHROME_RESULTS_ID}>
        <div className="fx-wb-scroll">
          {sampled.error && records.length === 0 ? (
            <p className="explore-error fx-lx-msg">Couldn’t reach the UFOs API: {sampled.error}</p>
          ) : !sampled.data && records.length === 0 ? (
            <RecordRowsSkeleton />
          ) : records.length === 0 ? (
            <p className="fx-records-msg">
              {live ? 'Waiting for the next one. ' : 'UFOs hasn’t sampled any recently. '}
              {!live && 'Live will show new ones as they’re written.'}
            </p>
          ) : (
            <ul className="fx-lx-recs">
              {records.map((r) => (
                <RecordRow key={peekKeyOf(r)} record={r} current={peekKey === peekKeyOf(r)} profile={profiles(r.did)} />
              ))}
            </ul>
          )}
        </div>
        <div className="fx-records-foot fx-lx-foot">
          <span>
            {records.length > 0 && `${records.length} record${records.length === 1 ? '' : 's'}`}
            {arrived.length > 0 && `, ${arrived.length} live`}
          </span>
          <Credit />
        </div>
      </section>
    </div>
  );
}

export function RecordRowsSkeleton({ rows = 10 }: { rows?: number }) {
  const widths = ['70%', '52%', '84%', '44%', '64%', '58%', '76%', '48%', '66%', '54%'];
  return (
    <ul className="fx-lx-recs" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fx-lx-item">
          <div className="fx-lx-rec" data-skeleton>
            <span className="fx-lx-rec-who">
              <SkeletonBar width="20px" height="20px" shape="circle" style={{ flex: 'none' }} />
              <SkeletonBar width="6rem" height="0.6rem" />
            </span>
            <span className="fx-lx-rec-text">
              <SkeletonBar width={widths[i % widths.length]} height="0.6rem" />
            </span>
            <SkeletonBar width="2.5rem" height="0.6rem" />
          </div>
        </li>
      ))}
    </ul>
  );
}
