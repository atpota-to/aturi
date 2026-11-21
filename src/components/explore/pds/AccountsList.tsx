'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  compareAccounts,
  matchesCommit,
  matchesStatus,
  type AccountSort,
  type CommitWindow,
  type StatusFilter,
} from '@/lib/pdsExplorer';
import { shortDid } from '@/utils/atproto/urls';
import { SkeletonBar } from '../skeletons/primitives';
import { FolderGlyph } from '../workbench/FileIcons';
import { AccountAvatar, CommitTime, SortHead, StatusMark } from './parts';
import { nameOf, useHostHandle, useLoadProfiles, type AccountRow } from './usePdsData';

/**
 * The accounts a host lists, as rows or as folders, for the workbench's and
 * the Files view's main pane and the classic page alike.
 *
 * Rows are drawn a few hundred at a time and more as the list scrolls: a
 * host's first page is a thousand accounts, and a busy one lists far more.
 */

const FIRST_DRAW = 200;
const DRAW_STEP = 200;

/**
 * The accounts under the status and commit filters, in the order asked for,
 * and those of them the text filter matches. Names are asked for in the
 * first list's order, so a search for a handle can find an account whose
 * handle hadn't come in yet, and the rows on screen are named first.
 */
export function useAccountsView({
  rows,
  status,
  commit,
  sort,
  desc,
  query,
  namesVersion,
}: {
  rows: readonly AccountRow[];
  status: StatusFilter;
  commit: CommitWindow | null;
  sort: AccountSort;
  desc: boolean;
  /** The text filter, trimmed and lower-cased. */
  query: string;
  namesVersion: number;
}) {
  // Sorting by handle re-sorts as handles arrive; the other orders don't
  // need to.
  const handleVersion = sort === 'handle' ? namesVersion : 0;
  const ordered = useMemo(() => {
    void handleVersion;
    const kept = rows.filter((r) => matchesStatus(r.standing, status) && matchesCommit(r.date, commit));
    const keyed = kept.map((row) => ({ row, sortable: { ...row, handle: sort === 'handle' ? (nameOf(row.did)?.handle ?? null) : null } }));
    keyed.sort((a, b) => compareAccounts(a.sortable, b.sortable, sort, desc));
    return keyed.map((k) => k.row);
  }, [rows, status, commit, sort, desc, handleVersion]);

  const orderedDids = useMemo(() => ordered.map((r) => r.did), [ordered]);
  useLoadProfiles(orderedDids);

  const searchVersion = query ? namesVersion : 0;
  const visible = useMemo(() => {
    void searchVersion;
    if (!query) return ordered;
    return ordered.filter((r) => {
      if (r.did.toLowerCase().includes(query)) return true;
      const name = nameOf(r.did);
      return Boolean(
        name?.handle?.toLowerCase().includes(query) || name?.displayName?.toLowerCase().includes(query),
      );
    });
  }, [ordered, query, searchVersion]);

  return { ordered, visible };
}

export type AccountsListProps = {
  base: string;
  /** The accounts to draw, filtered and in order. */
  rows: readonly AccountRow[];
  display: 'rows' | 'icons';
  /** The Files view: each account a folder. */
  files: boolean;
  hrefFor: (row: AccountRow) => string;
  /** The DID of the account open beside the list. */
  current: string | null;
  sort: AccountSort;
  desc: boolean;
  onSort: (by: AccountSort) => void;
};

export default function AccountsList(props: AccountsListProps) {
  const { rows, display, current } = props;
  const [limit, setLimit] = useState(FIRST_DRAW);
  const sentinel = useRef<HTMLLIElement>(null);

  // The open account is always drawn, however far down J and K have taken it.
  const at = current ? rows.findIndex((r) => r.did === current) : -1;
  const drawn = Math.max(limit, at + 1 + 20);
  const shown = rows.length > drawn ? rows.slice(0, drawn) : rows;
  const more = rows.length > shown.length;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + DRAW_STEP);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, shown.length]);

  if (display === 'icons') {
    return (
      <ul className="fx-fd-grid fx-pd-grid">
        {shown.map((row) => (
          <AccountTile key={row.did} row={row} {...props} isCurrent={row.did === current} />
        ))}
        {more && <li ref={sentinel} className="fx-pd-sentinel" aria-hidden />}
      </ul>
    );
  }

  return (
    <ul className="fx-lx-list fx-pd-list" data-cols="accounts" data-files={props.files || undefined}>
      <li className="fx-lx-head">
        <SortHead label="#" by="listed" {...sortProps(props)} />
        <SortHead label="Account" by="handle" {...sortProps(props)} />
        <span className="fx-pd-col-did">DID</span>
        <SortHead label="Status" by="status" {...sortProps(props)} />
        <SortHead label="Last commit" by="commit" {...sortProps(props)} className="fx-pd-col-time" />
      </li>
      {shown.map((row) => (
        <AccountRowItem key={row.did} row={row} {...props} isCurrent={row.did === current} />
      ))}
      {more && <li ref={sentinel} className="fx-pd-sentinel" aria-hidden />}
    </ul>
  );
}

function sortProps({ sort, desc, onSort }: AccountsListProps) {
  return { sort, desc, onSort };
}

type ItemProps = AccountsListProps & { row: AccountRow; isCurrent: boolean };

/** What a row says of its account, asking the host for a handle the AppView doesn't have. */
function useRowName(base: string, did: string) {
  const name = nameOf(did);
  useHostHandle(base, did, name !== undefined && !name.handle);
  const handle = name?.handle ?? null;
  return {
    handle,
    displayName: name?.displayName ?? null,
    avatar: name?.avatar ?? null,
    label: handle ? `@${handle}` : shortDid(did),
  };
}

function AccountRowItem({ base, row, files, hrefFor, isCurrent }: ItemProps) {
  const name = useRowName(base, row.did);
  return (
    <li className="fx-lx-item">
      {/* `prefetch={false}` + `rel="nofollow"`: one link per account a host
          lists, the widest fan-out in the explorer (AGENTS.md, rule 7). */}
      <Link
        href={hrefFor(row)}
        prefetch={false}
        rel="nofollow"
        className="fx-lx-row fx-pd-row"
        data-current={isCurrent || undefined}
        aria-current={isCurrent ? 'true' : undefined}
        data-standing={row.standing}
      >
        <span className="fx-lx-rank fx-pd-rank" title={`#${row.index + 1} in the host’s listing`}>
          {row.index + 1}
        </span>
        <span className="fx-pd-who">
          {files ? <FolderGlyph /> : <AccountAvatar avatar={name.avatar} label={name.label} />}
          <span className="fx-pd-names">
            <span className="fx-pd-handle" data-pending={!name.handle || undefined}>
              {name.label}
            </span>
            {name.displayName && <span className="fx-pd-display">{name.displayName}</span>}
          </span>
        </span>
        <span className="fx-pd-did" title={row.did}>
          {row.did}
        </span>
        <span className="fx-pd-status">
          <StatusMark standing={row.standing} quietActive />
        </span>
        <CommitTime date={row.date} rev={row.rev} />
      </Link>
    </li>
  );
}

function AccountTile({ base, row, hrefFor, isCurrent }: ItemProps) {
  const name = useRowName(base, row.did);
  const inactive = row.standing !== 'active';
  return (
    <li className="fx-fd-item">
      <Link
        href={hrefFor(row)}
        prefetch={false}
        rel="nofollow"
        className="fx-fd-tile fx-pd-tile"
        data-current={isCurrent || undefined}
        aria-current={isCurrent ? 'true' : undefined}
        data-inactive={inactive || undefined}
        title={row.did}
      >
        <span className="fx-pd-folder">
          <FolderGlyph />
          {name.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="fx-pd-folder-face" src={name.avatar} alt="" loading="lazy" />
          )}
        </span>
        <code className="fx-fd-name" data-pending={!name.handle || undefined}>
          {name.label}
        </code>
        <span className="fx-fd-cap">{name.displayName ?? ''}</span>
        <span className="fx-fd-meta">
          {inactive ? <StatusMark standing={row.standing} /> : <CommitTime date={row.date} rev={row.rev} />}
        </span>
      </Link>
    </li>
  );
}

/** The list's rows before the host has answered, in the rows' own shape. */
export function AccountsSkeleton({ display, rows = 12 }: { display: 'rows' | 'icons'; rows?: number }) {
  const widths = ['62%', '48%', '74%', '56%', '42%', '68%', '52%', '60%', '46%', '70%', '58%', '50%'];
  if (display === 'icons') {
    return (
      <ul className="fx-fd-grid fx-pd-grid" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <li key={i} className="fx-fd-item">
            <span className="fx-fd-tile" data-skeleton>
              <SkeletonBar width="64px" height="52px" shape="block" />
              <SkeletonBar width="5.5rem" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="fx-lx-list fx-pd-list" data-cols="accounts" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="fx-lx-item">
          <div className="fx-lx-row fx-pd-row" data-skeleton>
            <span className="fx-lx-rank fx-pd-rank">
              <SkeletonBar width="1.25rem" height="0.6rem" />
            </span>
            <span className="fx-pd-who">
              <SkeletonBar width="22px" height="22px" shape="circle" style={{ flex: 'none' }} />
              <SkeletonBar width={widths[i % widths.length]} height="0.65rem" />
            </span>
            <span className="fx-pd-did">
              <SkeletonBar width="80%" height="0.6rem" />
            </span>
            <span className="fx-pd-status">
              <SkeletonBar width="3.5rem" height="0.6rem" />
            </span>
            <span className="fx-pd-time">
              <SkeletonBar width="3rem" height="0.6rem" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
