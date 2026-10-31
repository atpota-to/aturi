'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  constellationPageFetcher,
  createBacklinkMerge,
  type MergedBacklink,
} from '@/utils/atproto/backlinkMerge';
import {
  backlinkDetailsVersion,
  cachedContext,
  cachedProfile,
  loadContexts,
  loadProfiles,
  subscribeBacklinkDetails,
  type LinkerProfile,
} from '@/utils/atproto/backlinkDetails';
import { appForCollection, type BacklinkApp } from '@/utils/atproto/backlinkRelations';
import { formatTidRelative, tidToDate } from '@/utils/atproto/tid';
import { shortDid } from '@/utils/atproto/urls';
import { WAYPOINT_ICONS } from '@/utils/waypointIcons';
import AtUriLink from '../AtUriLink';
import { BacklinkRowsSkeleton } from '../skeletons/pages';

type Merge = ReturnType<typeof createBacklinkMerge>;

type MergeSnapshot = {
  items: MergedBacklink[];
  loading: boolean;
  done: boolean;
  /** Sources whose last request failed. */
  failed: string[];
};

export type MergedBacklinks = MergeSnapshot & { loadMore: () => void };

const STARTING: MergeSnapshot = { items: [], loading: true, done: false, failed: [] };

/**
 * The linking records behind `sources`, latest first, `step` at a time.
 * Each source set keeps its merge for the component's lifetime, so moving
 * between relationships, apps and sources and back shows what was already
 * loaded instead of starting over.
 */
export function useMergedBacklinks(
  target: string,
  sources: readonly string[],
  step = 20,
): MergedBacklinks {
  const key = `${target}\n${sources.join('\n')}`;
  const merges = useRef(new Map<string, Merge>());
  const busy = useRef(new Set<string>());
  const [snapshots, setSnapshots] = useState<Record<string, MergeSnapshot>>({});

  const load = useCallback(
    (k: string, list: readonly string[]) => {
      if (busy.current.has(k)) return;
      let merge = merges.current.get(k);
      if (!merge) {
        merge = createBacklinkMerge(list, constellationPageFetcher(target), { pageSize: step });
        merges.current.set(k, merge);
      }
      busy.current.add(k);
      setSnapshots((prev) => ({ ...prev, [k]: { ...(prev[k] ?? STARTING), loading: true } }));
      merge.next(step).then((batch) => {
        busy.current.delete(k);
        setSnapshots((prev) => {
          const before = prev[k] ?? STARTING;
          return {
            ...prev,
            [k]: {
              items: [...before.items, ...batch.items],
              loading: false,
              done: batch.done,
              failed: batch.failed,
            },
          };
        });
      });
    },
    [target, step],
  );

  const snapshot = snapshots[key];
  useEffect(() => {
    if (!snapshot) load(key, sources);
  }, [key, snapshot, load, sources]);

  const current = snapshot ?? STARTING;
  return {
    ...current,
    loadMore: () => {
      if (!current.loading && !current.done) load(key, sources);
    },
  };
}

/**
 * Fetches the names, avatars and context lines for `items` and re-renders
 * as they land. Rows read the shared cache through `cachedProfile` and
 * `cachedContext`.
 */
export function useBacklinkDetails(items: readonly MergedBacklink[]): void {
  useSyncExternalStore(subscribeBacklinkDetails, backlinkDetailsVersion, () => 0);
  useEffect(() => {
    if (!items.length) return;
    void loadProfiles(items.map((i) => i.did));
    void loadContexts(items);
  }, [items]);
}

/** An app's waypoint mark, or a monogram of its name. */
export function AppMark({ app }: { app: BacklinkApp }) {
  const icon = app.waypoint ? WAYPOINT_ICONS[app.waypoint] : null;
  if (icon) {
    return (
      <span className="fx-bl-mark" aria-hidden>
        {icon}
      </span>
    );
  }
  return (
    <span className="fx-bl-mark" data-mono aria-hidden>
      {app.name.charAt(0).toUpperCase()}
    </span>
  );
}

function LinkerAvatar({ profile }: { profile: LinkerProfile | null | undefined }) {
  if (profile?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/')}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        className="fx-bl-avatar"
      />
    );
  }
  const initial = (profile?.displayName || profile?.handle || '').charAt(0).toUpperCase();
  return (
    <span className="fx-bl-avatar" data-empty aria-hidden>
      {initial}
    </span>
  );
}

/**
 * One linking record: who wrote it, when (from its TID), and what it is.
 * `selfDid` marks records the target's own account wrote; `selfLabel` says
 * what that account is here ("this account" on a repo, "author" on a
 * record). `showApp` adds the app's mark when a list mixes apps.
 */
export function BacklinkRow({
  item,
  selfDid,
  selfLabel,
  showApp,
}: {
  item: MergedBacklink;
  selfDid: string;
  selfLabel: string;
  showApp?: boolean;
}) {
  const profile = cachedProfile(item.did);
  const context = cachedContext(item.uri);
  const date = tidToDate(item.rkey);
  const displayName = profile?.displayName?.trim();
  return (
    <li className="fx-bl-row">
      <AtUriLink uri={item.uri} className="fx-bl-row-link">
        <LinkerAvatar profile={profile} />
        <span className="fx-bl-row-body">
          <span className="fx-bl-row-line">
            {displayName ? (
              <>
                <span className="fx-bl-row-name">{displayName}</span>
                {profile?.handle && <span className="fx-bl-row-handle">@{profile.handle}</span>}
              </>
            ) : profile?.handle ? (
              <span className="fx-bl-row-name">{profile.handle}</span>
            ) : (
              <>
                <span className="fx-bl-row-name" data-mono data-pending={profile === undefined || undefined}>
                  {shortDid(item.did)}
                </span>
                {profile === null && <span className="fx-bl-row-handle">no profile</span>}
              </>
            )}
            {item.did === selfDid && (
              <span className="fx-bl-pill" data-tone="accent">
                {selfLabel}
              </span>
            )}
            {item.links > 1 && (
              <span className="fx-bl-pill" title="This record links here more than once">
                ×{item.links} links
              </span>
            )}
          </span>
          {context && (
            <span className="fx-bl-row-ctx">
              {context.kind && <span className="fx-bl-row-kind">{context.kind}</span>}
              {context.text}
            </span>
          )}
        </span>
        <span className="fx-bl-row-meta">
          {showApp && <AppMark app={appForCollection(item.collection)} />}
          {date && (
            <time dateTime={date.toISOString()} title={date.toISOString()}>
              {formatTidRelative(date)}
            </time>
          )}
        </span>
      </AtUriLink>
    </li>
  );
}

/**
 * A merged list's rows plus its foot: Show more while sources have more,
 * how many of the total are showing, and what failed. The relationships
 * view and the record page's open sources both use it.
 */
export function BacklinkRowList({
  merged,
  total,
  selfDid,
  selfLabel,
  showApp,
}: {
  merged: MergedBacklinks;
  /** Links behind the list, from Constellation's counts. */
  total: number;
  selfDid: string;
  selfLabel: string;
  showApp?: boolean;
}) {
  useBacklinkDetails(merged.items);
  const { items, loading, done, failed, loadMore } = merged;

  if (!items.length && loading) return <BacklinkRowsSkeleton />;
  if (!items.length) {
    return (
      <p className="fx-empty">
        {failed.length ? 'Couldn’t load linking records from Constellation.' : 'No linking records to show.'}
      </p>
    );
  }
  return (
    <>
      <ul className="fx-bl-list">
        {items.map((item) => (
          <BacklinkRow key={item.uri} item={item} selfDid={selfDid} selfLabel={selfLabel} showApp={showApp} />
        ))}
      </ul>
      <div className="fx-bl-more">
        {!done && (
          <button type="button" className="fx-btn fx-btn-sm" onClick={loadMore} disabled={loading} data-wait={loading || undefined}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        )}
        {/* Records shown against links in all: a record that links twice
            is one row, so the two numbers are not the same unit. No claim
            about order: Constellation lists links as it indexed them, which
            an edited record breaks (see backlinkMerge). */}
        <span>
          {items.length.toLocaleString()} shown · {total.toLocaleString()}{' '}
          {total === 1 ? 'link' : 'links'} in all
        </span>
        {failed.length > 0 && (
          <span>
            · {failed.length} {failed.length === 1 ? 'source' : 'sources'} didn’t answer
          </span>
        )}
      </div>
    </>
  );
}
