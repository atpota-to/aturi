'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, Search, Users, X } from 'lucide-react';
import {
  COMMIT_WINDOW_LABELS,
  COMMIT_WINDOWS,
  statusLabel,
  type AccountSort,
  type CommitWindow,
  type PdsLocation,
} from '@/lib/pdsExplorer';
import { encodeRepo } from '@/utils/atproto/urls';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { Segmented } from '../lexicons/primitives';
import AccountsList, { AccountsSkeleton, useAccountsView } from './AccountsList';
import { SORT_CHOICES } from './parts';
import { nameOf, REPO_PAGE, useAccountRows, useNamesVersion, usePdsRepos, type AccountRow } from './usePdsData';

export type AddressPatch = Partial<PdsLocation>;

/**
 * The accounts a host lists, as the workbench's and the Files view's main
 * pane: the frame of an account's collection (CollectionPane), with a head
 * that says what's shown and how it's ordered, a filter, the list, which is
 * all that scrolls, and a foot that loads more.
 *
 * What's shown and how it's ordered is in the address (pdsExplorer.ts), so
 * a filtered, sorted list is a link like any other; the text filter is the
 * pane's own.
 */
export default function AccountsPane({
  base,
  loc,
  addressFor,
  go,
  display,
  files,
  onVisible,
  relayCount,
}: {
  base: string;
  loc: PdsLocation;
  addressFor: (patch: AddressPatch) => string;
  go: (to: string, replace?: boolean) => void;
  display: 'rows' | 'icons';
  files: boolean;
  /** The accounts the list shows, in order: for J and K. */
  onVisible: (dids: string[]) => void;
  /** How many accounts the relays count on the host, once one has said. */
  relayCount: number | null;
}) {
  const listing = usePdsRepos(base);
  const rows = useAccountRows(listing.repos);
  const namesVersion = useNamesVersion();
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const { ordered, visible } = useAccountsView({
    rows,
    status: loc.status,
    commit: loc.commit,
    sort: loc.sort,
    desc: loc.desc,
    query,
    namesVersion,
  });

  const joined = useMemo(() => visible.map((r) => r.did).join(' '), [visible]);
  useEffect(() => {
    onVisible(joined ? joined.split(' ') : []);
  }, [joined, onVisible]);

  // No field over a host that won't list (bsky.social): the bar falls back
  // to the jump search rather than offering to filter nothing.
  const refused = Boolean(listing.error) && rows.length === 0;
  useChromeBarField(
    refused
      ? null
      : {
          placeholder: 'Find an account…',
          label: 'Find an account on this PDS',
          value: filter,
          onChange: setFilter,
          resultsId: CHROME_RESULTS_ID,
          inPage: true,
          status: rows.length === 0 ? null : query ? `${visible.length}/${ordered.length}` : `${ordered.length}`,
        },
  );

  // The open account stays in sight as J and K step through the list.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const reveal = () => {
      const row = scroller.querySelector<HTMLElement>('[data-current]');
      if (!row) return;
      const box = scroller.getBoundingClientRect();
      const at = row.getBoundingClientRect();
      if (at.top < box.top + 32 || at.bottom > box.bottom) row.scrollIntoView({ block: 'nearest' });
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(scroller, { subtree: true, attributes: true, attributeFilter: ['data-current'] });
    return () => observer.disconnect();
  }, []);

  // Filters and orders replace the address: Back leaves the list rather
  // than stepping through every way it was sorted.
  const onSort = (by: AccountSort) =>
    go(addressFor({ sort: by, desc: by === loc.sort ? !loc.desc : by === 'commit' }), true);
  const hrefFor = (row: AccountRow) => {
    if (!files) return addressFor({ account: row.did });
    // In the Files view an account is a folder: opening it goes into its
    // repository, where the path bar leads back here.
    return `/explore/${encodeRepo(nameOf(row.did)?.handle || row.did)}`;
  };

  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    // A single inactive status, picked in the rail, takes a segment of its own.
    ...(['all', 'active', 'inactive'].includes(loc.status) ? [] : [{ value: loc.status, label: statusLabel(loc.status) }]),
  ];
  const sortValue = `${loc.sort}:${loc.desc ? 'desc' : 'asc'}`;
  const narrowed = loc.status !== 'all' || loc.commit !== null;
  const loadingFirst = rows.length === 0 && !listing.done && !listing.error;

  return (
    <div className="fx-wb-pane fx-lx-pane fx-pd-pane" data-display={display}>
      <div className="fx-wb-pane-head" data-crumbed>
        <div className="fx-titlebar">
          <div className="fx-title-row">
            <span className="fx-lx-title-icon" aria-hidden>
              <Users size={16} />
            </span>
            <h1 className="fx-h1">{paneTitle(loc)}</h1>
          </div>
          {!refused && (
            <div className="fx-actions fx-pd-actions">
              <Segmented
                ariaLabel="Show accounts"
                options={statusOptions}
                value={loc.status}
                onChange={(status: string) => go(addressFor({ status, account: null }), true)}
              />
              <label className="fx-pd-select">
                <span className="fx-sr">Order</span>
                <select
                  value={sortValue}
                  onChange={(e) => {
                    const [sort, dir] = e.target.value.split(':') as [AccountSort, string];
                    go(addressFor({ sort, desc: dir === 'desc' }), true);
                  }}
                >
                  {SORT_CHOICES.map((c) => (
                    <option key={`${c.sort}:${c.desc}`} value={`${c.sort}:${c.desc ? 'desc' : 'asc'}`}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <div className="fx-lx-sub">
          <Summary loaded={rows.length} done={listing.done} relayCount={relayCount} failed={refused} />
        </div>
      </div>

      <section aria-label="Accounts" className="fx-records fx-wb-records" id={CHROME_RESULTS_ID}>
        {!refused && (
          <div className="fx-records-tools">
            <label className="fx-field">
              <Search size={14} aria-hidden />
              <span className="fx-sr">Find an account</span>
              <input
                type="text"
                placeholder="Find a handle, name or DID"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && filter) {
                    e.preventDefault();
                    setFilter('');
                  }
                }}
              />
            </label>
            <label className="fx-pd-select">
              <span className="fx-pd-select-label">Last commit</span>
              <select
                value={loc.commit ?? ''}
                onChange={(e) =>
                  go(addressFor({ commit: (e.target.value || null) as CommitWindow | null, account: null }), true)
                }
              >
                <option value="">Any time</option>
                {COMMIT_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {COMMIT_WINDOW_LABELS[w]}
                  </option>
                ))}
              </select>
            </label>
            {narrowed && (
              <Link
                href={addressFor({ status: 'all', commit: null })}
                prefetch={false}
                className="fx-pd-clear"
                title="Show every account"
              >
                <X size={13} aria-hidden />
                Clear filters
              </Link>
            )}
            <span className="fx-records-tools-meta" aria-live="polite">
              {rows.length === 0
                ? null
                : query || narrowed
                  ? `${visible.length.toLocaleString()} of ${rows.length.toLocaleString()}`
                  : `${rows.length.toLocaleString()}${listing.done ? '' : '+'} accounts`}
            </span>
          </div>
        )}

        <div ref={scrollRef} className="fx-wb-scroll">
          {refused ? (
            <Message title={listing.error ?? undefined}>
              This PDS didn’t list its accounts. It may be offline or not allow listing, like the bsky.social
              entryway.
            </Message>
          ) : loadingFirst ? (
            <AccountsSkeleton display={display} />
          ) : rows.length === 0 ? (
            <Message>This PDS lists no accounts.</Message>
          ) : visible.length === 0 ? (
            <Message>
              {query ? (
                <>
                  No loaded account matches <code>{filter.trim()}</code>
                  {narrowed ? ' with these filters' : ''}.
                </>
              ) : (
                'No loaded account matches these filters.'
              )}
              {!listing.done && ' Load more to look further.'}
            </Message>
          ) : (
            <AccountsList
              base={base}
              rows={visible}
              display={display}
              files={files}
              hrefFor={hrefFor}
              current={loc.account}
              sort={loc.sort}
              desc={loc.desc}
              onSort={onSort}
            />
          )}
        </div>

        <div className="fx-records-foot fx-lx-foot">
          <span className="fx-lx-foot-more">
            {rows.length > 0 &&
              (listing.done
                ? `All ${rows.length.toLocaleString()} listed`
                : `${rows.length.toLocaleString()} listed, more on the host`)}
            {listing.error && rows.length > 0 && (
              <span className="fx-pd-foot-error" title={listing.error}>
                The last page didn’t load.
              </span>
            )}
            {!listing.done && rows.length > 0 && (
              <LoadMore onClick={listing.loadMore} loading={listing.loading} />
            )}
          </span>
          {rows.length > 0 && !listing.done && (narrowed || query || loc.sort !== 'listed') && (
            <span className="fx-pd-foot-note">Filters and order cover what’s listed so far.</span>
          )}
        </div>
      </section>
    </div>
  );
}

function paneTitle(loc: PdsLocation): string {
  return loc.status === 'all' ? 'Accounts' : `${statusLabel(loc.status)} accounts`;
}

/** What the list covers: everything the host lists, or the part of it loaded so far. */
export function Summary({
  loaded,
  done,
  relayCount,
  failed,
}: {
  loaded: number;
  done: boolean;
  relayCount: number | null;
  failed: boolean;
}) {
  if (failed) {
    return relayCount !== null ? (
      <>
        The relays count <strong>{relayCount.toLocaleString()}</strong> accounts here, but the host won’t list them.
      </>
    ) : (
      <>The host won’t list its accounts.</>
    );
  }
  if (loaded === 0) return <>Loading accounts…</>;
  if (done) {
    return (
      <>
        All <strong>{loaded.toLocaleString()}</strong> {loaded === 1 ? 'account' : 'accounts'}, oldest first.
      </>
    );
  }
  return (
    <>
      First <strong>{loaded.toLocaleString()}</strong>
      {relayCount !== null && (
        <>
          {' '}
          of about <strong>{relayCount.toLocaleString()}</strong> the relays count
        </>
      )}
      .
    </>
  );
}

function Message({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <p className="fx-records-msg" title={title}>
      {children}
    </p>
  );
}

export function LoadMore({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      data-wait={loading || undefined}
      className="fx-btn fx-btn-sm"
      style={{ fontWeight: 600 }}
    >
      {loading && <Loader2 size={13} className="explore-spin" aria-hidden />}
      Load {REPO_PAGE.toLocaleString()} more
    </button>
  );
}
