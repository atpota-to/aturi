'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ExternalLink, Globe, Search, Server } from 'lucide-react';
import {
  COMMIT_WINDOW_LABELS,
  COMMIT_WINDOWS,
  parsePdsLocation,
  pdsAddress,
  statusLabel,
  type AccountSort,
  type CommitWindow,
  type PdsLocation,
} from '@/lib/pdsExplorer';
import {
  normalizePdsBase,
  pdsHostname,
  type ServerDescription,
  type ServerHealth,
} from '@/utils/atproto/pdsServer';
import { encodeRepo } from '@/utils/atproto/urls';
import AppearIn from './AppearIn';
import CopyButton from './CopyButton';
import ShareLinkChip from './ShareLinkChip';
import RelayStatusList from '@/components/tools/RelayStatusList';
import { CHROME_RESULTS_ID, useChromeBarField } from './ChromeBarContext';
import { Segmented } from './lexicons/primitives';
import AccountsList, { AccountsSkeleton, useAccountsView } from './pds/AccountsList';
import { LoadMore } from './pds/AccountsPane';
import { SORT_CHOICES } from './pds/parts';
import VersionBadge from './pds/VersionBadge';
import {
  nameOf,
  useAccountRows,
  useNamesVersion,
  usePdsRepos,
  usePdsServer,
  type AccountRow,
} from './pds/usePdsData';

type Props = {
  host: string;
};

/**
 * The classic explorer page for a PDS host: server metadata, what the relays
 * know of it, and the accounts it hosts, as one scrolling page. The
 * Workbench and Files views (pds/PdsShell.tsx) draw the same host in the
 * full-window frame; all three share one reading of the host
 * (pds/usePdsData.ts), so switching between them doesn't list it again.
 */
export default function PdsExplorer({ host }: Props) {
  const pdsBase = normalizePdsBase(host);
  // _health and the rest are separate, optional reads: a missing version
  // doesn't mark the PDS as broken when describeServer answered.
  const server = usePdsServer(pdsBase);

  return (
    <div className="fn-lexdetail fn-pds">
      <AppearIn rise>
        <PdsHeader
          host={host}
          info={server.info}
          health={server.health}
          error={server.error}
          pdsBase={pdsBase}
        />
      </AppearIn>

      {/* What the relays know of this host, once it has answered as a PDS:
          a name that is not one would only collect four "not known"s. The
          rows are the relay crawl check's own (RelayStatusList.tsx). */}
      {server.info && (
        <AppearIn delay={0.05}>
          <section>
            <header className="fn-pds-repos-head">
              <h2>Relays</h2>
              <span>
                {/* A static page, so the link keeps its prefetch. */}
                <Link
                  href={`/tools/relay?host=${encodeURIComponent(pdsHostname(pdsBase))}`}
                  rel="nofollow"
                  className="fn-pds-tool-link"
                >
                  Relay crawl check
                </Link>
              </span>
            </header>
            <RelayStatusList hostname={pdsHostname(pdsBase)} compact />
          </section>
        </AppearIn>
      )}

      <AppearIn delay={0.08}>
        <ClassicAccounts host={host} base={pdsBase} />
      </AppearIn>
    </div>
  );
}

/**
 * The accounts the host lists, on the classic page: found by handle, name or
 * DID, narrowed to how they stand and when they last committed, and sorted,
 * with each row a way into the account's repository.
 *
 * The narrowing and the order are the address's, as in the full-window
 * views (src/lib/pdsExplorer.ts), so switching views keeps them; they
 * replace the address rather than add to the history.
 */
function ClassicAccounts({ host, base }: { host: string; base: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const loc = useMemo(
    () =>
      parsePdsLocation(pathname, searchParams) ??
      (parsePdsLocation(`/explore/pds/${encodeURIComponent(host)}`, new URLSearchParams()) as PdsLocation),
    [pathname, searchParams, host],
  );
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

  const set = (patch: Partial<PdsLocation>) =>
    window.history.replaceState(null, '', pdsAddress({ ...loc, ...patch, tab: 'accounts', account: null }, 'accounts'));
  const onSort = (by: AccountSort) => set({ sort: by, desc: by === loc.sort ? !loc.desc : by === 'commit' });
  const hrefFor = (row: AccountRow) => `/explore/${encodeRepo(nameOf(row.did)?.handle || row.did)}`;

  // The page's find action: search the accounts this server hosts. Only
  // while there is, or may yet be, something to search: a host that refuses
  // to list (bsky.social does) otherwise left a field over the notice saying
  // so; without one the bar falls back to the jump search.
  const firstFailed = Boolean(listing.error) && rows.length === 0;
  const searchable = rows.length > 0 || (!listing.error && !listing.done);
  useChromeBarField(
    searchable
      ? {
          placeholder: 'Find an account…',
          label: 'Find an account on this PDS',
          value: filter,
          onChange: setFilter,
          resultsId: CHROME_RESULTS_ID,
          inPage: true,
          status: rows.length === 0 ? null : query ? `${visible.length}/${ordered.length}` : `${ordered.length}`,
        }
      : null,
  );

  const narrowed = loc.status !== 'all' || loc.commit !== null;
  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    ...(['all', 'active', 'inactive'].includes(loc.status) ? [] : [{ value: loc.status, label: statusLabel(loc.status) }]),
  ];

  return (
    <section id={CHROME_RESULTS_ID} className="fx-pd-classic">
      <header className="fn-pds-repos-head">
        <h2>Accounts on this PDS</h2>
        {/* No count when the very first page failed: "0+ loaded" beside the
            notice read as a server with no accounts. */}
        {!firstFailed && rows.length > 0 && (
          <span>
            {query || narrowed ? (
              <>
                {visible.length.toLocaleString()} of {rows.length.toLocaleString()} shown
              </>
            ) : (
              <>
                {rows.length.toLocaleString()}
                {!listing.done && '+'} listed
              </>
            )}
          </span>
        )}
      </header>

      {/* In words, with the raw error kept for anyone who hovers: a bare
          "Failed to fetch" said nothing about what had been tried. */}
      {firstFailed ? (
        <p className="explore-placeholder" title={listing.error ?? undefined}>
          Couldn’t list the accounts on this PDS. It may be offline, or it may not allow listing.
        </p>
      ) : listing.done && rows.length === 0 ? (
        <p className="explore-placeholder">No accounts reported by this PDS.</p>
      ) : (
        <div className="fx-pd-classic-card">
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
            <Segmented
              ariaLabel="Show accounts"
              options={statusOptions}
              value={loc.status}
              onChange={(status: string) => set({ status })}
            />
            <label className="fx-pd-select">
              <span className="fx-pd-select-label">Last commit</span>
              <select
                value={loc.commit ?? ''}
                onChange={(e) => set({ commit: (e.target.value || null) as CommitWindow | null })}
              >
                <option value="">Any time</option>
                {COMMIT_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {COMMIT_WINDOW_LABELS[w]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fx-pd-select">
              <span className="fx-sr">Order</span>
              <select
                value={`${loc.sort}:${loc.desc ? 'desc' : 'asc'}`}
                onChange={(e) => {
                  const [sort, dir] = e.target.value.split(':') as [AccountSort, string];
                  set({ sort, desc: dir === 'desc' });
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

          {rows.length === 0 ? (
            <AccountsSkeleton display="rows" rows={8} />
          ) : visible.length === 0 ? (
            // A search only sees the pages fetched so far, so say that
            // rather than implying the PDS doesn't host a match.
            <p className="fx-records-msg">
              {query ? (
                <>
                  No listed account matches <code>{filter.trim()}</code>
                  {narrowed ? ' with these filters' : ''}.
                </>
              ) : (
                'No listed account matches these filters.'
              )}
              {!listing.done && ' Load more to look further.'}
            </p>
          ) : (
            <AccountsList
              base={base}
              rows={visible}
              display="rows"
              files={false}
              hrefFor={hrefFor}
              current={null}
              sort={loc.sort}
              desc={loc.desc}
              onSort={onSort}
            />
          )}

          {rows.length > 0 && (
            <div className="fx-records-foot">
              <span>
                {listing.done
                  ? `All ${rows.length.toLocaleString()} listed`
                  : `${rows.length.toLocaleString()} listed, more on the host`}
                {listing.error && (
                  <span className="fx-pd-foot-error" title={listing.error}>
                    {' '}
                    The last page didn’t load.
                  </span>
                )}
              </span>
              {!listing.done && <LoadMore onClick={listing.loadMore} loading={listing.loading} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PdsHeader({
  host,
  info,
  health,
  error,
  pdsBase,
}: {
  host: string;
  info: ServerDescription | null;
  health: ServerHealth | null;
  error: string | null;
  pdsBase: string;
}) {
  return (
    <section className="fn-lexhead" style={{ gap: '14px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div className="fn-kicker fn-lexhead-kicker">
          <Server size={13} aria-hidden />
          Personal Data Server
        </div>
        <ShareLinkChip url={`/explore/pds/${encodeURIComponent(host)}`} />
      </div>
      <h1 className="fn-lexhead-title fn-lexhead-mono" style={{ overflowWrap: 'anywhere' }}>
        {host}
      </h1>

      {error && (
        <p
          className="explore-muted"
          style={{ fontSize: '0.8125rem', margin: 0, fontStyle: 'italic' }}
        >
          Couldn&rsquo;t reach <code>{pdsBase}/xrpc/com.atproto.server.describeServer</code>. The
          PDS may not implement that endpoint, or it&rsquo;s temporarily unavailable.
        </p>
      )}

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: '0.75rem',
          margin: 0,
        }}
      >
        <Cell label="endpoint">
          <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
            {pdsBase}
          </code>
          <CopyButton value={pdsBase} label="Copy URL" compact variant="subtle" />
        </Cell>

        {info?.did && (
          <Cell label="server DID">
            <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
              {info.did}
            </code>
            <CopyButton value={info.did} label="Copy DID" compact variant="subtle" />
          </Cell>
        )}

        {health?.version && (
          <Cell label="version">
            <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
              {health.version}
            </code>
            <VersionBadge host={pdsHostname(pdsBase)} version={health.version} />
          </Cell>
        )}

        {info?.availableUserDomains && info.availableUserDomains.length > 0 && (
          <Cell label="available domains">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.25rem 0.5rem',
              }}
            >
              {info.availableUserDomains.map((d) => (
                <code
                  key={d}
                  style={{
                    background: 'var(--accent-soft)',
                    color: 'var(--accent-soft-fg)',
                    padding: '0.1rem 0.5rem',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '0.75rem',
                  }}
                >
                  {d}
                </code>
              ))}
            </div>
          </Cell>
        )}

        {info?.inviteCodeRequired !== undefined && (
          <Cell label="invite required">
            <span style={{ color: 'var(--text-primary)' }}>
              {info.inviteCodeRequired ? 'Yes' : 'No'}
            </span>
          </Cell>
        )}
      </dl>

      {(info?.links?.privacyPolicy || info?.links?.termsOfService || info?.contact?.email) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.8125rem',
          }}
        >
          {info?.links?.privacyPolicy && (
            <ExternalLinkRow icon={<Globe size={13} />} href={info.links.privacyPolicy} label="Privacy policy" />
          )}
          {info?.links?.termsOfService && (
            <ExternalLinkRow icon={<Globe size={13} />} href={info.links.termsOfService} label="Terms of service" />
          )}
          {info?.contact?.email && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              <span style={{ marginRight: '0.4rem', fontWeight: 600 }}>Contact</span>
              <a href={`mailto:${info.contact.email}`} style={{ color: 'var(--text-accent)' }}>
                {info.contact.email}
              </a>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="fn-dt">
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          overflowWrap: 'anywhere',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {children}
      </dd>
    </div>
  );
}

function ExternalLinkRow({
  icon,
  href,
  label,
}: {
  icon: React.ReactNode;
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: 'var(--text-accent)',
        textDecoration: 'none',
      }}
    >
      {icon}
      <span>{label}</span>
      <ExternalLink size={11} aria-hidden style={{ opacity: 0.6 }} />
    </a>
  );
}
