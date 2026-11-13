'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Link2 } from 'lucide-react';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import {
  backlinkDetailsVersion,
  cachedProfile,
  loadProfiles,
  subscribeBacklinkDetails,
} from '@/utils/atproto/backlinkDetails';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import type { PeekTarget } from '@/lib/explorerView';
import AppearIn from '../AppearIn';
import { RecordPane, type RecordPaneTab } from '../RecordExplorer';
import { RecordBodySkeleton } from '../skeletons/pages';
import BacklinksTab from '../tabs/BacklinksTab';
import { BacklinkPeekContext, type BacklinkPeek } from '../tabs/BacklinkRows';
import { FileGlyph, fileKindOf } from './FileIcons';

/**
 * How the shell hosts a backlinks panel in its main pane: which relationship
 * is open and where each one's tile goes (both kept in the address), whether
 * the linking records are rows or files, and the peek that opens one beside
 * the list.
 */
export type BacklinksHost = {
  relation: string | null;
  relationHref: (relation: string) => string;
  display: 'rows' | 'icons';
  peek: BacklinkPeek;
};

/** A backlinks panel under a host: the account's view and a record's share it. */
export function HostedBacklinks({ target, host }: { target: string; host: BacklinksHost }) {
  return (
    <BacklinkPeekContext.Provider value={host.peek}>
      <BacklinksTab
        target={target}
        relation={host.relation}
        relationHref={host.relationHref}
        display={host.display}
      />
    </BacklinkPeekContext.Provider>
  );
}

/** An ISO 8601 date-time and nothing else, as `createdAt` fields hold. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * What links to the open record, in the main pane: the list a record's
 * backlinks card points at from the inspector. It stands where the
 * collection's records were (the shell keeps those mounted underneath), so
 * it says which record it is about and offers the way back to them.
 *
 * The same sheet as the account's Backlinks view, so links to an account
 * and links to a record read as one feature.
 */
export function RecordLinksView({
  identity,
  collection,
  rkey,
  backHref,
  seed,
  host,
}: {
  identity: IdentityBundle;
  collection: string;
  rkey: string;
  /** The record with the collection's list beside it again. */
  backHref: string;
  /** The record as the list holds it, for a line of what it says. */
  seed: AtRecord | null;
  host: BacklinksHost;
}) {
  const preview = seed ? previewFor(seed.value) : '';
  const caption = TIMESTAMP.test(preview) ? '' : preview;
  return (
    <div className="fx-wb-page">
      <div className="fx-wb-page-inner fx-main" data-tab="backlinks">
        <AppearIn>
          <section className="fx-wb-section">
            <div className="fx-wb-links-head">
              <div className="fx-wb-links-title">
                <h1 className="fx-wb-h">Backlinks to this record</h1>
                <p className="fx-wb-links-target" title={`${collection}/${rkey}`}>
                  <FileGlyph kind={fileKindOf(collection)} />
                  <code>{rkey}</code>
                  {caption && <span>{caption}</span>}
                </p>
              </div>
              <Link href={backHref} prefetch={false} rel="nofollow" className="fx-btn fx-btn-sm">
                <ArrowLeft size={14} aria-hidden />
                Back to records
              </Link>
            </div>
            <div className="fx-tabpanel">
              <HostedBacklinks target={`at://${identity.did}/${collection}/${rkey}`} host={host} />
            </div>
          </section>
        </AppearIn>
      </div>
    </div>
  );
}

/**
 * A linking record, opened beside the list it was picked from. It is a
 * record like any other and shows as one (<RecordPane>), but it usually
 * lives in someone else's repository, so a bar over it says whose and
 * offers the way there. Opening it properly is how to go on from it: its
 * own backlinks card lists what links to *it*.
 *
 * The lexicons workbench opens a lexicon's recent records the same way, with
 * no account of its own and its own words on the bar.
 */
export function PeekPane({
  peek,
  own,
  controls,
  tab,
  onTab,
  onClose,
  label,
}: {
  peek: PeekTarget;
  /** The shell's account: a record that links from this same repository. */
  own: IdentityBundle | null;
  /** Stepping and closing, drawn in the pane's head. */
  controls: ReactNode;
  tab: RecordPaneTab;
  onTab: (tab: RecordPaneTab) => void;
  onClose: () => void;
  /** What the bar says before whose record it is, glyph included. */
  label?: ReactNode;
}) {
  const local = own !== null && peek.did === own.did;
  const [resolved, setResolved] = useState<{ identity: IdentityBundle | null; failed: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    resolveIdentifier(peek.did)
      .then((identity) => {
        if (!cancelled) setResolved({ identity, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResolved({ identity: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [peek.did, local]);
  const identity = local ? own : (resolved?.identity ?? null);

  // The list this record was picked from has usually fetched its author
  // already; a peek opened from a link has not.
  useSyncExternalStore(subscribeBacklinkDetails, backlinkDetailsVersion, () => 0);
  useEffect(() => {
    void loadProfiles([peek.did]);
  }, [peek.did]);
  const profile = cachedProfile(peek.did);
  const handle = profile?.handle || identity?.handle || null;
  const name = profile?.displayName?.trim() || (handle ? `@${handle}` : shortDid(peek.did));
  const repoSeg = encodeRepo(handle || peek.did);
  const recordHref = `/explore/${repoSeg}/${peek.collection}/${encodeURIComponent(peek.rkey)}`;

  return (
    <div className="fx-wb-peek">
      <div className="fx-wb-peek-bar">
        <span className="fx-wb-peek-what">
          {label ?? (
            <>
              <Link2 size={13} aria-hidden />
              Links here, from
            </>
          )}
        </span>
        <Link
          href={`/explore/${repoSeg}`}
          prefetch={false}
          rel="nofollow"
          className="fx-wb-peek-who"
          title={handle ? `@${handle}` : peek.did}
        >
          {profile?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/')}
              alt=""
              width={18}
              height={18}
            />
          ) : null}
          <span>{name}</span>
        </Link>
        <Link
          href={recordHref}
          prefetch={false}
          rel="nofollow"
          className="fx-btn fx-btn-sm fx-wb-peek-open"
          title="Open this record in its own repository"
        >
          Open
          <ArrowUpRight size={13} aria-hidden />
        </Link>
      </div>
      {identity ? (
        <RecordPane
          identity={identity}
          collection={peek.collection}
          rkey={peek.rkey}
          controls={controls}
          wide={false}
          tab={tab}
          onTab={onTab}
          onDeleted={onClose}
          links={{ href: (relation) => `${recordHref}?links=${relation}`, current: null }}
        />
      ) : (
        // The pane's own frame, so the key and the way out are there while
        // the account resolves, and if it never does.
        <div className="fn-rec fx-wb-rec">
          <div className="fx-wb-insp-head">
            <h2 className="fx-wb-insp-rkey" title={peek.rkey}>
              {peek.rkey}
            </h2>
            <div className="fx-wb-insp-ctl">{controls}</div>
          </div>
          <div className="fx-wb-insp-body">
            {resolved?.failed ? (
              <p className="explore-error" style={{ margin: 0 }}>
                Couldn’t resolve the account this record is in ({shortDid(peek.did)}).
              </p>
            ) : (
              <RecordBodySkeleton />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
