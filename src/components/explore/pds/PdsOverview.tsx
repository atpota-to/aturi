'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink, RefreshCw, Server } from 'lucide-react';
import {
  COMMIT_WINDOW_LABELS,
  compareStatus,
  countFacets,
  statusLabel,
  statusMeaning,
  statusTone,
  type CommitWindow,
} from '@/lib/pdsExplorer';
import type { RelayResult } from '@/lib/tools/relay';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { RelayStatusRows } from '@/components/tools/RelayStatusList';
import AppearIn from '../AppearIn';
import CopyButton from '../CopyButton';
import { SkeletonBar } from '../skeletons/primitives';
import type { AddressPatch } from './AccountsPane';
import { AccountAvatar, CommitTime } from './parts';
import { nameOf, useAccountRows, useLoadProfiles, useNamesVersion, usePdsRepos, usePdsServer } from './usePdsData';
import VersionBadge from './VersionBadge';
import { shortDid } from '@/utils/atproto/urls';

const RECENT = 8;

/**
 * The host at a glance, as the workbench opens on it: what it says about
 * itself beside what its listing and the relays say about the accounts on
 * it. The frame is the account overview's (AccountView): a card on the
 * left, sections on the right, on the page tone, scrolling as one.
 *
 * Every figure about accounts is a way into the list it counts.
 */
export default function PdsOverview({
  base,
  host,
  addressFor,
  relays,
  relayCount,
}: {
  base: string;
  host: string;
  addressFor: (patch: AddressPatch) => string;
  relays: RelayResult[];
  relayCount: number | null;
}) {
  return (
    <div className="fx-wb-page">
      <div className="fx-wb-page-inner fx-pd-page" data-tab="overview">
        <div className="fx-wb-overview">
          <div className="fx-wb-overview-side">
            <AppearIn>
              <ServerCard base={base} host={host} addressFor={addressFor} />
            </AppearIn>
          </div>
          <div className="fx-wb-overview-main">
            <AppearIn delay={0.05}>
              <AccountsGlance base={base} addressFor={addressFor} relayCount={relayCount} />
            </AppearIn>
            <AppearIn delay={0.1}>
              <section className="fx-wb-section">
                <div className="fx-pd-h-row">
                  <h2 className="fx-wb-h">Relays</h2>
                  <Link href={addressFor({ tab: 'relays' })} prefetch={false} className="fx-lx-more">
                    What each one says
                    <ArrowRight size={13} aria-hidden />
                  </Link>
                </div>
                <div className="fx-card fn-tool-relay-card" role="group" aria-label={`Relays crawling ${host}`}>
                  <RelayStatusRows results={relays} compact />
                </div>
              </section>
            </AppearIn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── The server ──────────────────────────────────────────────────────────────

function ServerCard({
  base,
  host,
  addressFor,
}: {
  base: string;
  host: string;
  addressFor: (patch: AddressPatch) => string;
}) {
  const server = usePdsServer(base);
  const { info, health, authServers, error } = server;
  const settled = Boolean(info || error);
  const origin = base.toLowerCase();

  return (
    <section className="fx-lx-card fx-pd-server" aria-label="Server">
      <div className="fx-pd-server-head">
        <span className="fx-lx-railmark" aria-hidden>
          <Server size={16} />
        </span>
        <span className="fx-pd-kicker">Personal Data Server</span>
      </div>
      <h1 className="fx-pd-server-host">{host}</h1>
      {error && (
        <p className="fx-pd-server-error" title={error}>
          It didn’t answer <code>describeServer</code>. It may not be a PDS, or it may be down.
        </p>
      )}
      <dl className="fx-pd-facts">
        <Fact label="Endpoint">
          <code>{base}</code>
          <CopyButton value={base} label="Copy URL" compact variant="subtle" iconOnly />
        </Fact>
        {info?.did ? (
          <Fact label="Server DID">
            <code>{info.did}</code>
            <CopyButton value={info.did} label="Copy DID" compact variant="subtle" iconOnly />
          </Fact>
        ) : (
          !settled && <FactSkeleton label="Server DID" />
        )}
        {health?.version && (
          <Fact label="Version">
            <code>{health.version}</code>
            <VersionBadge host={pdsHostname(base)} version={health.version} />
          </Fact>
        )}
        {authServers && (
          <Fact label="Sign-in">
            <span className="fx-pd-fact-text">
              {authServers.map((server, i) => {
                const own = server.replace(/\/$/, '').toLowerCase() === origin;
                const name = pdsHostname(server);
                return (
                  <span key={server}>
                    {i > 0 && ', '}
                    {own ? (
                      'On this PDS'
                    ) : (
                      <>
                        Through{' '}
                        <Link
                          href={`/explore/pds/${encodeURIComponent(name)}`}
                          prefetch={false}
                          title={`Accounts here sign in at ${name}`}
                        >
                          {name}
                        </Link>
                      </>
                    )}
                  </span>
                );
              })}
            </span>
          </Fact>
        )}
        {info?.availableUserDomains && info.availableUserDomains.length > 0 && (
          <Fact label="New handles">
            <span className="fx-pd-domains">
              {info.availableUserDomains.map((d) => (
                <code key={d} className="fx-pd-domain">
                  {d}
                </code>
              ))}
            </span>
          </Fact>
        )}
        {info?.inviteCodeRequired !== undefined && (
          <Fact label="Invite code">
            <span className="fx-pd-fact-text">{info.inviteCodeRequired ? 'Required to sign up' : 'Not required'}</span>
          </Fact>
        )}
        {info?.phoneVerificationRequired !== undefined && (
          <Fact label="Phone check">
            <span className="fx-pd-fact-text">{info.phoneVerificationRequired ? 'Required to sign up' : 'Not required'}</span>
          </Fact>
        )}
        {info?.contact?.email && (
          <Fact label="Contact">
            <a href={`mailto:${info.contact.email}`}>{info.contact.email}</a>
          </Fact>
        )}
      </dl>
      {(info?.links?.privacyPolicy || info?.links?.termsOfService) && (
        <div className="fx-pd-links">
          {info?.links?.privacyPolicy && <OutLink href={info.links.privacyPolicy}>Privacy policy</OutLink>}
          {info?.links?.termsOfService && <OutLink href={info.links.termsOfService}>Terms of service</OutLink>}
        </div>
      )}
      <div className="fx-pd-tools">
        {/* Static pages, so these links keep their prefetch. */}
        <Link href={`/tools/relay?host=${encodeURIComponent(pdsHostname(base))}`} rel="nofollow" className="fx-btn fx-btn-sm">
          Relay crawl check
        </Link>
        <Link href={addressFor({ tab: 'accounts' })} prefetch={false} className="fx-btn fx-btn-sm">
          Browse accounts
        </Link>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FactSkeleton({ label }: { label: string }) {
  return (
    <div aria-hidden>
      <dt>{label}</dt>
      <dd>
        <SkeletonBar width="80%" height="0.65rem" />
      </dd>
    </div>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  // Only http(s): the host writes these, and a javascript: URL is not a policy.
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="fx-pd-outlink">
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

// ─── The accounts ────────────────────────────────────────────────────────────

const COMMIT_ROWS: CommitWindow[] = ['24h', '7d', '30d', '1y', 'dormant'];

function pct(part: number, whole: number): string {
  if (whole === 0) return '0%';
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

function AccountsGlance({
  base,
  addressFor,
  relayCount,
}: {
  base: string;
  addressFor: (patch: AddressPatch) => string;
  relayCount: number | null;
}) {
  const listing = usePdsRepos(base);
  const rows = useAccountRows(listing.repos);
  const facets = useMemo(() => countFacets(rows, 'all', null), [rows]);
  const loaded = rows.length;
  const active = facets.byStatus.get('active') ?? 0;
  const inactive = loaded - active;
  const failed = Boolean(listing.error) && loaded === 0;
  const waiting = loaded === 0 && !listing.done && !listing.error;

  const standings = useMemo(
    () => Array.from(facets.byStatus.entries()).sort(([a], [b]) => compareStatus(a, b)),
    [facets],
  );

  // The most recent commits, named as soon as the rest of the page is.
  const recent = useMemo(
    () =>
      rows
        .filter((r) => r.date)
        .sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime())
        .slice(0, RECENT),
    [rows],
  );
  const recentDids = useMemo(() => recent.map((r) => r.did), [recent]);
  useLoadProfiles(recentDids);
  useNamesVersion();

  const scope = listing.done
    ? `All ${loaded.toLocaleString()} ${loaded === 1 ? 'account' : 'accounts'} the host lists.`
    : `The first ${loaded.toLocaleString()} accounts the host lists${
        relayCount !== null ? ` of about ${relayCount.toLocaleString()} the relays count` : ''
      }.`;

  return (
    <section className="fx-wb-section" aria-label="Accounts">
      <div className="fx-pd-h-row">
        <h2 className="fx-wb-h">Accounts</h2>
        {!failed && !waiting && <span className="fx-pd-h-note">{scope}</span>}
      </div>

      <div className="fn-stat-grid fx-pd-tiles">
        <Tile
          label="Hosted"
          value={relayCount !== null ? relayCount : loaded > 0 ? loaded : null}
          plus={relayCount === null && !listing.done}
          note={relayCount !== null ? 'counted by the relays' : 'listed by the host'}
          href={addressFor({ tab: 'accounts' })}
          waiting={waiting && relayCount === null}
        />
        {!failed && (
          <>
            <Tile
              label="Active"
              value={waiting ? null : active}
              note={loaded ? `${pct(active, loaded)} of those listed` : ''}
              href={addressFor({ status: 'active' })}
              waiting={waiting}
            />
            <Tile
              label="Inactive"
              value={waiting ? null : inactive}
              note={loaded ? `${pct(inactive, loaded)} of those listed` : ''}
              href={addressFor({ status: 'inactive' })}
              waiting={waiting}
            />
            <Tile
              label="Committed in 30 days"
              value={waiting ? null : facets.byCommit['30d']}
              note={loaded ? `${pct(facets.byCommit['30d'], loaded)} of those listed` : ''}
              href={addressFor({ commit: '30d', sort: 'commit', desc: true })}
              waiting={waiting}
            />
          </>
        )}
      </div>

      {failed && (
        <p className="fx-pd-note" title={listing.error ?? undefined}>
          The host didn’t list its accounts. It may be offline, or it may not allow listing: an entryway like
          bsky.social doesn’t, and the PDSs behind it do.
        </p>
      )}

      {loaded > 0 && (
        <div className="fx-pd-cards">
          <section className="fx-lx-card" aria-label="How they stand">
            <h3 className="fx-lx-h">How they stand</h3>
            <div
              className="fx-pd-split"
              role="img"
              aria-label={standings.map(([s, n]) => `${statusLabel(s)} ${n} (${pct(n, loaded)})`).join(', ')}
            >
              {standings.map(([s, n]) => (
                <span
                  key={s}
                  className="fx-pd-split-part"
                  data-tone={statusTone(s)}
                  style={{ flexGrow: n }}
                  title={`${statusLabel(s)}: ${n.toLocaleString()} (${pct(n, loaded)})`}
                />
              ))}
            </div>
            <ul className="fx-pd-legend">
              {standings.map(([s, n]) => (
                <li key={s}>
                  <Link href={addressFor({ status: s })} prefetch={false} title={statusMeaning(s)}>
                    <span className="fx-pd-standing" data-tone={statusTone(s)}>
                      <span className="fx-pd-dot" aria-hidden />
                      {statusLabel(s)}
                    </span>
                    <span className="fx-pd-legend-n">{n.toLocaleString()}</span>
                    <span className="fx-pd-legend-pct">{pct(n, loaded)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="fx-lx-card" aria-label="Last commit">
            <h3 className="fx-lx-h">
              Last commit
              <span className="fx-lx-h-count">each window includes the shorter ones</span>
            </h3>
            <ul className="fx-pd-bars">
              {COMMIT_ROWS.map((w) => {
                const n = facets.byCommit[w];
                return (
                  <li key={w}>
                    <Link
                      href={addressFor({ commit: w, sort: 'commit', desc: w !== 'dormant' })}
                      prefetch={false}
                      data-quiet={w === 'dormant' || undefined}
                      title={`${n.toLocaleString()} of ${loaded.toLocaleString()} (${pct(n, loaded)})`}
                    >
                      <span className="fx-pd-bar-label">{COMMIT_WINDOW_LABELS[w]}</span>
                      <span className="fx-pd-bar-track" aria-hidden>
                        <span className="fx-pd-bar-fill" style={{ width: `${loaded ? (n / loaded) * 100 : 0}%` }} />
                      </span>
                      <span className="fx-pd-bar-n">{n.toLocaleString()}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {recent.length > 0 && (
        <section className="fx-lx-card" aria-label="Most recently active">
          <h3 className="fx-lx-h">Most recently active</h3>
          <ul className="fx-lx-mini fx-pd-recent">
            {recent.map((row) => {
              const name = nameOf(row.did);
              const label = name?.handle ? `@${name.handle}` : shortDid(row.did);
              return (
                <li key={row.did}>
                  <Link
                    href={addressFor({ sort: 'commit', desc: true, account: row.did })}
                    prefetch={false}
                    rel="nofollow"
                  >
                    <span className="fx-pd-who">
                      <AccountAvatar avatar={name?.avatar ?? null} label={label} size={20} />
                      <span className="fx-lx-mini-name">{label}</span>
                    </span>
                    <CommitTime date={row.date} rev={row.rev} />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link href={addressFor({ sort: 'commit', desc: true })} prefetch={false} className="fx-lx-more">
            Every account by last commit
            <ArrowRight size={13} aria-hidden />
          </Link>
        </section>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  plus,
  note,
  href,
  waiting,
}: {
  label: string;
  value: number | null;
  plus?: boolean;
  note: string;
  href: string;
  waiting: boolean;
}) {
  return (
    <Link href={href} prefetch={false} className="fn-stat fx-pd-tile-stat">
      <span className="fn-stat-label">{label}</span>
      <span className="fn-stat-value">
        {waiting || value === null ? (
          <SkeletonBar width="3.5rem" height="1.2rem" />
        ) : (
          <>
            {value.toLocaleString()}
            {plus && '+'}
          </>
        )}
      </span>
      <span className="fx-pd-tile-note">{note}</span>
    </Link>
  );
}

// ─── Relays ──────────────────────────────────────────────────────────────────

/** The relays' view of the host, as a view of its own: every row in full. */
export function PdsRelays({
  base,
  relays,
  loading,
  rerun,
}: {
  base: string;
  relays: RelayResult[];
  loading: boolean;
  rerun: () => void;
}) {
  const hostname = pdsHostname(base);
  return (
    <div className="fx-wb-page">
      <div className="fx-wb-page-inner fx-pd-page" data-tab="relays">
        <AppearIn>
          <section className="fx-wb-section fx-pd-relays">
            <div className="fx-pd-h-row">
              <h1 className="fx-wb-h">Relays</h1>
              <button type="button" className="fx-btn fx-btn-sm" onClick={rerun} disabled={loading} data-wait={loading || undefined}>
                <RefreshCw size={13} aria-hidden className={loading ? 'explore-spin' : undefined} />
                Ask again
              </button>
            </div>
            <p className="fx-pd-lead">
              A relay crawls PDSs and passes their accounts’ changes on to the apps that read the network. This is what
              each relay the explorer asks knows of <code>{hostname}</code>: whether it’s crawling it, how many of its
              accounts it counts, and how far through its event stream it has read.
            </p>
            <div className="fx-card fn-tool-relay-card" role="group" aria-label={`Relays crawling ${hostname}`}>
              <RelayStatusRows results={relays} />
            </div>
            <p className="fx-pd-lead">
              A relay that doesn’t know the host carries none of its records. The{' '}
              {/* A static page, so the link keeps its prefetch. */}
              <Link href={`/tools/relay?host=${encodeURIComponent(hostname)}`} rel="nofollow">
                relay crawl check
              </Link>{' '}
              says what to do about that.
            </p>
          </section>
        </AppearIn>
      </div>
    </div>
  );
}
