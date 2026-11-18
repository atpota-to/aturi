'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Clock, LayoutDashboard, RadioTower, Server, Users, type LucideIcon } from 'lucide-react';
import {
  COMMIT_WINDOW_LABELS,
  COMMIT_WINDOWS,
  compareStatus,
  countFacets,
  PDS_TAB_LABELS,
  PDS_TABS,
  statusLabel,
  statusMeaning,
  statusTone,
  type CommitWindow,
  type PdsLocation,
  type PdsTab,
} from '@/lib/pdsExplorer';
import CopyButton from '../CopyButton';
import { SkeletonBar } from '../skeletons/primitives';
import { FolderGlyph } from '../workbench/FileIcons';
import type { AddressPatch } from './AccountsPane';
import { useAccountRows, usePdsRepos, usePdsServer } from './usePdsData';

const TAB_ICONS: Record<PdsTab, LucideIcon> = {
  overview: LayoutDashboard,
  accounts: Users,
  relays: RadioTower,
};

/**
 * The PDS explorer's rail, as an account's is (ExplorerShell): the host and
 * its address to copy, its three views, then the way around its accounts.
 * Where an account's rail has its collections, a host's has its accounts by
 * how they stand and by when they last committed, each with how many the
 * listing holds. The counts are faceted (pdsExplorer.ts, countFacets): with
 * "Active" picked, the commit windows count active accounts.
 *
 * In the Files view each group is a folder; in the workbench a status wears
 * its mark.
 */
export default function PdsRail({
  base,
  host,
  loc,
  tab,
  addressFor,
  files,
  onDone,
}: {
  base: string;
  host: string;
  loc: PdsLocation;
  /** The view showing, the layout's default filled in. */
  tab: PdsTab;
  addressFor: (patch: AddressPatch) => string;
  files: boolean;
  onDone: () => void;
}) {
  const server = usePdsServer(base);
  const listing = usePdsRepos(base);
  const rows = useAccountRows(listing.repos);
  const facets = useMemo(() => countFacets(rows, loc.status, loc.commit), [rows, loc.status, loc.commit]);
  const inactive = useMemo(
    () =>
      Array.from(facets.byStatus.entries())
        .filter(([s]) => s !== 'active')
        .sort(([a], [b]) => compareStatus(a, b)),
    [facets],
  );
  const active = facets.byStatus.get('active') ?? 0;
  const inactiveTotal = facets.statusAll - active;
  const onAccounts = tab === 'accounts';
  const failed = Boolean(listing.error) && rows.length === 0;
  const waiting = rows.length === 0 && !listing.done && !listing.error;
  // Bluesky's own PDSs report a commit hash as their version: its first
  // seven characters say as much in the rail.
  const reported = server.health?.version;
  const version = reported && /^[0-9a-f]{20,}$/i.test(reported) ? reported.slice(0, 7) : reported;

  const status = (value: string) => addressFor({ tab: 'accounts', status: value, account: null });
  const commit = (value: CommitWindow | null) => addressFor({ tab: 'accounts', commit: value, account: null });

  return (
    <>
      <div className="fx-lx-railhead">
        <span className="fx-lx-railmark" aria-hidden>
          <Server size={16} />
        </span>
        <div className="fx-wb-acct-names">
          <Link href={addressFor({ tab: 'overview' })} prefetch={false} className="fx-wb-acct-name fx-pd-railhost" title={host}>
            {host}
          </Link>
          <span className="fx-lx-railsub">{version ? `PDS · ${version}` : 'Personal Data Server'}</span>
        </div>
        <CopyButton value={base} label="Copy the PDS’s URL" compact variant="subtle" iconOnly />
        <button type="button" className="fx-btn fx-btn-sm fx-wb-done" onClick={onDone}>
          Done
        </button>
      </div>

      <nav aria-label="PDS" className="fx-wb-views">
        {PDS_TABS.map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <Link
              key={t}
              // A view's own address carries no filters; picking Accounts
              // here shows them all.
              href={addressFor({ tab: t, status: 'all', commit: null, account: null })}
              prefetch={false}
              className="fx-wb-view"
              aria-current={tab === t ? 'page' : undefined}
            >
              <Icon size={14} aria-hidden />
              {PDS_TAB_LABELS[t]}
              {t === 'accounts' && rows.length > 0 && (
                <span className="fx-pd-view-count">
                  {rows.length.toLocaleString()}
                  {listing.done ? '' : '+'}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="fx-pd-groups">
        {failed ? (
          <p className="fx-wb-note fx-pd-rail-note">This host doesn’t list its accounts.</p>
        ) : waiting ? (
          <GroupsSkeleton />
        ) : rows.length === 0 ? (
          <p className="fx-wb-note fx-pd-rail-note">No accounts listed.</p>
        ) : (
          <>
            <section aria-label="Accounts by status">
              <h2 className="fx-wb-label">Status</h2>
              <ul className="fx-fd-places">
                <Group
                  href={status('all')}
                  label="All accounts"
                  count={facets.statusAll}
                  current={onAccounts && loc.status === 'all'}
                  glyph={files ? <FolderGlyph /> : <Users size={13} aria-hidden className="fx-pd-group-icon" />}
                />
                <Group
                  href={status('active')}
                  label="Active"
                  count={active}
                  current={onAccounts && loc.status === 'active'}
                  title={statusMeaning('active')}
                  glyph={files ? <FolderGlyph /> : <Dot tone="good" />}
                />
                {inactive.length > 0 && (
                  <Group
                    href={status('inactive')}
                    label="Inactive"
                    count={inactiveTotal}
                    current={onAccounts && loc.status === 'inactive'}
                    title="Listed, but not served"
                    glyph={files ? <FolderGlyph /> : <Dot tone="quiet" />}
                  />
                )}
                {inactive.map(([s, n]) => (
                  <Group
                    key={s}
                    href={status(s)}
                    label={statusLabel(s)}
                    count={n}
                    current={onAccounts && loc.status === s}
                    title={statusMeaning(s)}
                    depth={1}
                    glyph={files ? <FolderGlyph /> : <Dot tone={statusTone(s)} />}
                  />
                ))}
              </ul>
            </section>

            <section aria-label="Accounts by last commit">
              <h2 className="fx-wb-label">Last commit</h2>
              <ul className="fx-fd-places">
                <Group
                  href={commit(null)}
                  label="Any time"
                  count={facets.commitAll}
                  current={onAccounts && loc.commit === null}
                  glyph={files ? <FolderGlyph /> : <Clock size={13} aria-hidden className="fx-pd-group-icon" />}
                />
                {COMMIT_WINDOWS.map((w) => (
                  <Group
                    key={w}
                    href={commit(w)}
                    label={COMMIT_WINDOW_LABELS[w]}
                    count={facets.byCommit[w]}
                    current={onAccounts && loc.commit === w}
                    glyph={files ? <FolderGlyph /> : <Clock size={13} aria-hidden className="fx-pd-group-icon" data-quiet />}
                  />
                ))}
              </ul>
            </section>

            <p className="fx-wb-note fx-pd-rail-note">
              {listing.done
                ? `Counted over all ${rows.length.toLocaleString()} accounts the host lists.`
                : `Counted over the first ${rows.length.toLocaleString()} the host lists.`}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Dot({ tone }: { tone: string }) {
  return (
    <span className="fx-pd-standing fx-pd-group-dot" data-tone={tone} aria-hidden>
      <span className="fx-pd-dot" />
    </span>
  );
}

function Group({
  href,
  label,
  count,
  current,
  glyph,
  title,
  depth = 0,
}: {
  href: string;
  label: string;
  count: number;
  current: boolean;
  glyph: ReactNode;
  title?: string;
  depth?: number;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className="fx-fd-place fx-pd-group"
        aria-current={current ? 'page' : undefined}
        data-depth={depth || undefined}
        data-empty={count === 0 || undefined}
        title={title}
      >
        {glyph}
        <span className="fx-fd-place-name">{label}</span>
        <span className="fx-fd-place-count">{count.toLocaleString()}</span>
      </Link>
    </li>
  );
}

function GroupsSkeleton() {
  return (
    <div aria-hidden>
      <h2 className="fx-wb-label">Status</h2>
      <div className="fx-fd-places">
        {['6rem', '4rem', '5rem'].map((w, i) => (
          <span key={i} className="fx-fd-place" data-skeleton>
            <SkeletonBar width="14px" height="14px" shape="circle" style={{ flex: 'none' }} />
            <SkeletonBar width={w} height="0.6rem" />
          </span>
        ))}
      </div>
      <h2 className="fx-wb-label">Last commit</h2>
      <div className="fx-fd-places">
        {['4.5rem', '6rem', '5.5rem', '6.5rem', '5rem', '6.75rem'].map((w, i) => (
          <span key={i} className="fx-fd-place" data-skeleton>
            <SkeletonBar width="14px" height="14px" shape="circle" style={{ flex: 'none' }} />
            <SkeletonBar width={w} height="0.6rem" />
          </span>
        ))}
      </div>
    </div>
  );
}
