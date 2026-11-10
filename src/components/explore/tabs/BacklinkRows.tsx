'use client';

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
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
  type RecordContext,
} from '@/utils/atproto/backlinkDetails';
import { appForCollection, type BacklinkApp } from '@/utils/atproto/backlinkRelations';
import { formatTidRelative, tidToDate } from '@/utils/atproto/tid';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import { peekValue } from '@/lib/explorerView';
import { WAYPOINT_ICONS } from '@/utils/waypointIcons';
import { BacklinkRowsSkeleton } from '../skeletons/pages';
import { FileGlyph, fileKindOf } from '../workbench/FileIcons';
import { RecordFileSkeleton } from '../workbench/RecordFile';

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
 * Set by a host that opens a linking record beside the list rather than
 * leaving for it (the workbench and the Files view). A row then carries the
 * record as `data-peek`, which the host's click handler reads, and the one
 * that is open is marked. The link itself still goes to the record's own
 * page, so it opens in a new tab as any other.
 */
export type BacklinkPeek = {
  /** The AT URI of the linking record that is open, if one is. */
  current: string | null;
  /** The rows on screen, in order: what stepping moves through. */
  onItems: (items: readonly MergedBacklink[]) => void;
};

export const BacklinkPeekContext = createContext<BacklinkPeek | null>(null);

/** What a row links to and how a peeking host recognises it. */
function useRowLink(item: MergedBacklink) {
  const peek = useContext(BacklinkPeekContext);
  const current = peek?.current === item.uri;
  return {
    href: explorePathFromAtUri(item.uri) ?? '#',
    'data-peek': peek ? (peekValue(item.uri) ?? undefined) : undefined,
    'data-current': current || undefined,
    'aria-current': current ? ('true' as const) : undefined,
  };
}

/**
 * A handle that wraps after its dots rather than mid-label: a tile is a few
 * characters narrower than most handles are long.
 */
function dotBreaks(text: string) {
  const parts = text.split('.');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </Fragment>
  ));
}

/**
 * The account a row is about when it isn't the record's author: a list item
 * seen from the list it belongs to. Every item of a list is written by the
 * list's owner and names the same list, so author and context would repeat
 * down the whole page; what differs is who each one adds.
 */
function memberOf(context: RecordContext | null | undefined, target: string): string | null {
  return context?.member && context.member.list === target ? context.member.did : null;
}

/**
 * One linking record: who wrote it, when (from its TID), and what it is.
 * `selfDid` marks records the target's own account wrote; `selfLabel` says
 * what that account is here ("this account" on a repo, "author" on a
 * record). `showApp` adds the app's mark when a list mixes apps.
 *
 * `rel="nofollow"` + `prefetch={false}`, for the reason on <AtUriLink>: the
 * destination is a record somewhere in the network, not a page of this site.
 */
export function BacklinkRow({
  item,
  target,
  selfDid,
  selfLabel,
  showApp,
}: {
  item: MergedBacklink;
  target: string;
  selfDid: string;
  selfLabel: string;
  showApp?: boolean;
}) {
  const context = cachedContext(item.uri);
  const member = memberOf(context, target);
  const profile = cachedProfile(member ?? item.did);
  const date = tidToDate(item.rkey);
  const displayName = profile?.displayName?.trim();
  const link = useRowLink(item);
  return (
    <li className="fx-bl-row">
      <Link {...link} className="fx-bl-row-link" prefetch={false} rel="nofollow">
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
                  {shortDid(member ?? item.did)}
                </span>
                {profile === null && <span className="fx-bl-row-handle">no profile</span>}
              </>
            )}
            {!member && item.did === selfDid && (
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
          {context && !member && (
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
      </Link>
    </li>
  );
}

/**
 * The same linking record as a file, for the Files view's icon layout: its
 * kind on the icon with its author's face on the corner, the author as the
 * name, then what it says and when. The icon-layout twin of <BacklinkRow>,
 * on <RecordFile>'s tile.
 */
export function BacklinkFile({
  item,
  target,
  selfDid,
  selfLabel,
}: {
  item: MergedBacklink;
  target: string;
  selfDid: string;
  selfLabel: string;
}) {
  const context = cachedContext(item.uri);
  const member = memberOf(context, target);
  const profile = cachedProfile(member ?? item.did);
  const date = tidToDate(item.rkey);
  const link = useRowLink(item);
  const name = profile?.handle
    ? `@${profile.handle}`
    : profile?.displayName?.trim() || shortDid(member ?? item.did);
  const caption = member ? '' : context?.text;
  const own = !member && item.did === selfDid;
  return (
    <li className="fx-fd-item">
      <Link
        {...link}
        className="fx-fd-tile"
        prefetch={false}
        rel="nofollow"
        title={`${item.collection} by ${name}`}
      >
        <span className="fx-bl-file">
          <FileGlyph kind={fileKindOf(item.collection)} />
          <LinkerAvatar profile={profile} />
        </span>
        <span className="fx-fd-name" data-pending={profile === undefined || undefined}>
          {dotBreaks(name)}
        </span>
        <span className="fx-fd-cap">
          {own ? `${selfLabel}${caption ? ' · ' : ''}` : ''}
          {caption}
        </span>
        {date && (
          <time className="fx-fd-meta" dateTime={date.toISOString()} title={date.toISOString()}>
            {formatTidRelative(date)}
          </time>
        )}
      </Link>
    </li>
  );
}

/**
 * A merged list's rows plus its foot: Show more while sources have more,
 * how many of the total are showing, and what failed. The relationships
 * view and the record page's open sources both use it. `display` draws the
 * records as file tiles instead of rows.
 */
export function BacklinkRowList({
  merged,
  target,
  total,
  selfDid,
  selfLabel,
  showApp,
  display = 'rows',
}: {
  merged: MergedBacklinks;
  /** What the records link to: a DID or an AT URI. */
  target: string;
  /** Links behind the list, from Constellation's counts. */
  total: number;
  selfDid: string;
  selfLabel: string;
  showApp?: boolean;
  display?: 'rows' | 'icons';
}) {
  useBacklinkDetails(merged.items);
  const { items, loading, done, failed, loadMore } = merged;
  const onItems = useContext(BacklinkPeekContext)?.onItems;
  useEffect(() => {
    onItems?.(items);
  }, [onItems, items]);

  if (!items.length && loading) {
    return display === 'icons' ? <RecordFileSkeleton tiles={12} /> : <BacklinkRowsSkeleton />;
  }
  if (!items.length) {
    return (
      <p className="fx-empty">
        {failed.length ? 'Couldn’t load linking records from Constellation.' : 'No linking records to show.'}
      </p>
    );
  }
  return (
    <>
      {display === 'icons' ? (
        <ul className="fx-fd-grid fx-bl-files">
          {items.map((item) => (
            <BacklinkFile key={item.uri} item={item} target={target} selfDid={selfDid} selfLabel={selfLabel} />
          ))}
        </ul>
      ) : (
        <ul className="fx-bl-list">
          {items.map((item) => (
            <BacklinkRow
              key={item.uri}
              item={item}
              target={target}
              selfDid={selfDid}
              selfLabel={selfLabel}
              showApp={showApp}
            />
          ))}
        </ul>
      )}
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
