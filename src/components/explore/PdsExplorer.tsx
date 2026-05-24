'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Server } from 'lucide-react';
import {
  describeServer,
  listRepos,
  normalizePdsBase,
  type RepoEntry,
  type ServerDescription,
} from '@/utils/atproto/pdsServer';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import AppearIn from './AppearIn';
import CopyButton from './CopyButton';
import ShareLinkChip from './ShareLinkChip';

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

  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [reposLoading, setReposLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setServerInfo(null);
    setServerError(null);
    describeServer(pdsBase)
      .then((d) => {
        if (!cancelled) setServerInfo(d);
      })
      .catch((err) => {
        if (!cancelled) setServerError(err instanceof Error ? err.message : String(err));
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
    loadPage(undefined);
  }, [loadPage]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <PdsHeader host={host} info={serverInfo} error={serverError} pdsBase={pdsBase} />
      </AppearIn>

      <AppearIn delay={0.08}>
        <section>
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
              {repos.length}
              {!done && '+'} loaded
            </span>
          </header>

          {reposError && <p className="explore-error">{reposError}</p>}
          {repos.length === 0 && reposLoading && (
            <p className="explore-placeholder">Loading repos…</p>
          )}
          {repos.length === 0 && !reposLoading && !reposError && (
            <p className="explore-placeholder">No repos reported by this PDS.</p>
          )}

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: repos.length ? '1px solid var(--border-medium)' : 0,
              background: 'var(--bg-secondary)',
              display: repos.length ? 'flex' : undefined,
              flexDirection: 'column',
            }}
          >
            {repos.map((r) => (
              <RepoRow
                key={r.did}
                repo={r}
                pdsBase={pdsBase}
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
  error,
  pdsBase,
}: {
  host: string;
  info: ServerDescription | null;
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

/**
 * Single repo row — DID always shown immediately; the canonical handle is
 * fetched in the background via describeRepo and slots in once available.
 */
function RepoRow({ repo, pdsBase }: { repo: RepoEntry; pdsBase: string }) {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    describeRepo(pdsBase, repo.did)
      .then((res) => {
        if (!cancelled && res.handle) setHandle(res.handle);
      })
      .catch(() => {
        // Handle lookup is best-effort. Showing just the DID is fine.
      });
    return () => {
      cancelled = true;
    };
  }, [pdsBase, repo.did]);

  return (
    <li style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <Link
        href={`/explore/${encodeRepo(handle || repo.did)}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(14ch, 24ch) 1fr',
          gap: '0.75rem',
          alignItems: 'baseline',
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
        <code
          style={{
            background: 'transparent',
            padding: 0,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={repo.did}
        >
          {handle ? `@${handle}` : shortDid(repo.did)}
        </code>
        <span
          style={{
            color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={repo.did}
        >
          {handle ? repo.did : ''}
        </span>
      </Link>
    </li>
  );
}
