'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Server } from 'lucide-react';
import {
  describeServer,
  getServerHealth,
  listRepos,
  normalizePdsBase,
  type RepoEntry,
  type ServerDescription,
  type ServerHealth,
} from '@/utils/atproto/pdsServer';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';
import AppearIn from './AppearIn';
import CopyButton from './CopyButton';
import ShareLinkChip from './ShareLinkChip';
import { PdsReposSkeleton } from './skeletons/pages';
import { CHROME_RESULTS_ID, useChromeBarField } from './ChromeBarContext';

type Props = {
  host: string;
};

/**
 * Explorer view for a PDS host. Renders server metadata + a paginated list
 * of the repos hosted there. Each repo row resolves its handle lazily so
 * the initial paint isn't blocked on N describeRepo calls.
 */
export default function PdsExplorer({ host }: Props) {
  const pdsBase = normalizePdsBase(host);
  const [serverInfo, setServerInfo] = useState<ServerDescription | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  // _health is a separate, optional endpoint — keep its state distinct
  // from describeServer so a missing version doesn't visually mark the
  // PDS as broken when the rest of the metadata loaded fine.
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);

  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [reposLoading, setReposLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  // Search over the repos fetched so far, driven from the bottom chrome bar.
  // listRepos has no query parameter, so this narrows what's loaded.
  const [filter, setFilter] = useState('');
  // Rows resolve their own handle lazily (see <RepoRow>); the results are
  // kept here so the search can match a handle and not just a DID, and so a
  // row that scrolls out of the filter and back doesn't refetch it.
  const [handles, setHandles] = useState<Record<string, string>>({});

  const rememberHandle = useCallback((did: string, handle: string) => {
    setHandles((prev) => (prev[did] === handle ? prev : { ...prev, [did]: handle }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);
    setServerError(null);
    setServerHealth(null);
    describeServer(pdsBase)
      .then((d) => {
        if (!cancelled) setServerInfo(d);
      })
      .catch((err) => {
        if (!cancelled) setServerError(err instanceof Error ? err.message : String(err));
      });
    getServerHealth(pdsBase)
      .then((h) => {
        if (!cancelled) setServerHealth(h);
      })
      .catch(() => {
        // _health is best-effort — older / non-reference PDSs may 404.
        // We just leave the version cell off in that case.
      });
    return () => {
      cancelled = true;
    };
  }, [pdsBase]);

  const loadPage = useCallback(
    async (after?: string) => {
      setReposLoading(true);
      setReposError(null);
      try {
        const res = await listRepos(pdsBase, { limit: 50, cursor: after });
        const batch = res.repos || [];
        setRepos((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(res.cursor);
        if (!res.cursor || batch.length === 0) setDone(true);
      } catch (err) {
        setReposError(err instanceof Error ? err.message : String(err));
      } finally {
        setReposLoading(false);
      }
    },
    [pdsBase],
  );

  useEffect(() => {
    setRepos([]);
    setCursor(undefined);
    setDone(false);
    setFilter('');
    setHandles({});
    loadPage(undefined);
  }, [loadPage]);

  const query = filter.trim().toLowerCase();
  const visibleRepos = useMemo(
    () =>
      query
        ? repos.filter(
            (r) =>
              r.did.toLowerCase().includes(query) ||
              (handles[r.did]?.toLowerCase().includes(query) ?? false),
          )
        : repos,
    [repos, handles, query],
  );

  // The PDS page's find action: search the repos this server hosts.
  useChromeBarField({
    placeholder: 'Search repos…',
    label: 'Search repos on this PDS',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status:
      repos.length === 0
        ? null
        : query
          ? `${visibleRepos.length}/${repos.length}`
          : `${repos.length}${done ? '' : '+'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <PdsHeader
          host={host}
          info={serverInfo}
          health={serverHealth}
          error={serverError}
          pdsBase={pdsBase}
        />
      </AppearIn>

      <AppearIn delay={0.08}>
        <section id={CHROME_RESULTS_ID}>
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              paddingBottom: '0.5rem',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: '0.75rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 400 }}>
              Repos on this PDS
            </h2>
            <span
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {query ? (
                <>
                  {visibleRepos.length} of {repos.length} shown
                </>
              ) : (
                <>
                  {repos.length}
                  {!done && '+'} loaded
                </>
              )}
            </span>
          </header>

          {reposError && <p className="explore-error">{reposError}</p>}
          {repos.length === 0 && reposLoading && <PdsReposSkeleton />}
          {repos.length === 0 && !reposLoading && !reposError && (
            <p className="explore-placeholder">No repos reported by this PDS.</p>
          )}
          {/* A search only sees the pages fetched so far — and only the rows
              whose handle has resolved — so say that rather than implying the
              PDS doesn't host a match. */}
          {repos.length > 0 && visibleRepos.length === 0 && (
            <p className="explore-placeholder">
              No loaded repos match <code>{filter.trim()}</code>.
              {!done && ' Load more to search further.'}
            </p>
          )}

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: visibleRepos.length ? '1px solid var(--border-medium)' : 0,
              background: 'var(--bg-secondary)',
              display: visibleRepos.length ? 'flex' : undefined,
              flexDirection: 'column',
            }}
          >
            {visibleRepos.map((r) => (
              <RepoRow
                key={r.did}
                repo={r}
                pdsBase={pdsBase}
                handle={handles[r.did] ?? null}
                onHandle={rememberHandle}
              />
            ))}
          </ul>

          {!done && repos.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => loadPage(cursor)}
                disabled={reposLoading}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.875rem',
                  cursor: reposLoading ? 'wait' : 'pointer',
                }}
              >
                {reposLoading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      </AppearIn>
    </div>
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
    <section
      style={{
        padding: '1.25rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: 'var(--text-tertiary)',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-serif)',
          }}
        >
          <Server size={12} />
          Personal Data Server
        </div>
        <ShareLinkChip url={`/explore/pds/${encodeURIComponent(host)}`} />
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: '1.875rem',
          fontWeight: 300,
          color: 'var(--text-primary)',
          lineHeight: 1.15,
          fontFamily: 'var(--font-mono)',
          wordBreak: 'break-all',
        }}
      >
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
          <Cell label="server did">
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
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-accent)',
                    padding: '0.1rem 0.4rem',
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
            <span
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '0.875rem',
                color: 'var(--text-primary)',
              }}
            >
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
              <span className="explore-small-caps" style={{ marginRight: '0.4rem' }}>
                contact
              </span>
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
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          wordBreak: 'break-all',
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

// A PDS page renders up to ~50 repo rows at once, each of which looks up its
// handle via describeRepo. Firing all of them on mount hit the PDS with ~50
// simultaneous requests (rate-limit / hammer risk). This tiny semaphore caps
// concurrent lookups; rows still fill in their handle as slots free up.
const HANDLE_LOOKUP_CONCURRENCY = 6;
let activeLookups = 0;
const lookupWaiters: (() => void)[] = [];

function acquireLookupSlot(): Promise<void> {
  if (activeLookups < HANDLE_LOOKUP_CONCURRENCY) {
    activeLookups++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => lookupWaiters.push(resolve));
}

function releaseLookupSlot(): void {
  const next = lookupWaiters.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else activeLookups--;
}

async function describeRepoLimited(pdsBase: string, did: string) {
  await acquireLookupSlot();
  try {
    return await describeRepo(pdsBase, did);
  } finally {
    releaseLookupSlot();
  }
}

/**
 * Single repo row — DID always shown immediately; the canonical handle is
 * fetched in the background via describeRepo and reported up to the parent,
 * which owns the handle map so the repo search can match on it.
 */
function RepoRow({
  repo,
  pdsBase,
  handle,
  onHandle,
}: {
  repo: RepoEntry;
  pdsBase: string;
  handle: string | null;
  onHandle: (did: string, handle: string) => void;
}) {
  useEffect(() => {
    // Already resolved (or resolved before a filter hid this row): nothing
    // to fetch.
    if (handle) return undefined;
    let cancelled = false;
    describeRepoLimited(pdsBase, repo.did)
      .then((res) => {
        if (!cancelled && res.handle) onHandle(repo.did, res.handle);
      })
      .catch(() => {
        // Handle lookup is best-effort. Showing just the DID is fine.
      });
    return () => {
      cancelled = true;
    };
  }, [pdsBase, repo.did, handle, onHandle]);

  // The repo's head `rev` is itself a TID (the commit timestamp), so we
  // can render the last-updated time without a second round-trip. Custom
  // / non-TID revs fall back to null and the line is just hidden.
  const revDate = repo.rev ? tidToDate(repo.rev) : null;

  // `active === false` records carry a `status` like 'takendown' /
  // 'suspended' / 'deactivated' / 'deleted'. Show it prominently — those
  // repos still appear in listRepos but their records won't fetch.
  const showStatus = repo.active === false || (repo.status && repo.status !== 'active');
  const statusLabel = repo.status || (repo.active === false ? 'inactive' : null);

  return (
    <li style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* `prefetch={false}` + `rel="nofollow"`, per <LinkifiedJson>. One row
          per repo hosted here, and a busy PDS hosts thousands, so this is the
          widest single fan-out in the explorer: left on the default, rendering
          one PDS page queued a prefetch for every account on it. */}
      <Link
        href={`/explore/${encodeRepo(handle || repo.did)}`}
        prefetch={false}
        rel="nofollow"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(14ch, 24ch) 1fr auto',
          gap: '0.75rem',
          alignItems: 'center',
          padding: '0.55rem 1rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={{ minWidth: 0 }}>
          <code
            style={{
              background: 'transparent',
              padding: 0,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'block',
            }}
            title={repo.did}
          >
            {handle ? `@${handle}` : shortDid(repo.did)}
          </code>
          {revDate && (
            <time
              dateTime={revDate.toISOString()}
              title={`rev ${repo.rev} · ${revDate.toISOString()}`}
              style={{
                display: 'block',
                marginTop: '0.125rem',
                fontSize: '0.7rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              updated {formatTidRelative(revDate)}
            </time>
          )}
        </div>
        <span
          style={{
            color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
          title={repo.did}
        >
          {handle ? repo.did : ''}
        </span>
        {showStatus && statusLabel && (
          <span
            title={`Repo status: ${statusLabel}`}
            style={{
              padding: '0.125rem 0.4rem',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--danger)',
              border: '1px solid var(--danger)',
              background: 'transparent',
              whiteSpace: 'nowrap',
              textTransform: 'lowercase',
            }}
          >
            {statusLabel}
          </span>
        )}
      </Link>
    </li>
  );
}
