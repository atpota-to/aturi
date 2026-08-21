'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { formatSpaceRef, isValidDid, isValidNsid, isValidRecordKey } from '@/utils/atproto/spaceUri';
import type { IdentityBundle } from '@/utils/atproto/identity';
import {
  classifySpaceError,
  collectSpacePages,
  getSpaceLatestCommit,
  listSpaceRecords,
  listSpaceRepoOps,
  type SpaceOpEntry,
  type SpaceRecordRow,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import CopyButton from '../CopyButton';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
import { useResolvedIdentity, useSpaceAccess, useSpaceRepoAccess } from './useSpaceAccess';

const RECORDS_PER_PAGE = 100;
const OPS_PER_PAGE = 100;
/** Oplog pages to walk before giving up on reaching the head. */
const MAX_OP_PAGES = 3;

/**
 * L4 — one member's permissioned repository inside a space.
 *
 * The host addressed here is the *member's own PDS*, not the space host: a
 * permissioned repo lives with its owner and only the space-wide metadata lives
 * with the authority. That is why this level resolves a second identity.
 */
export default function SpaceRepoExplorer({
  repo,
  spaceType,
  skey,
  author,
}: {
  repo: string;
  spaceType: string;
  skey: string;
  author: string;
}) {
  const { identity, error } = useResolvedIdentity(repo);
  const { identity: authorIdentity, error: authorError } = useResolvedIdentity(author);

  if (!isValidNsid(spaceType) || !isValidRecordKey(skey) || !isValidDid(author)) {
    return (
      <NotFoundPanel
        eyebrow="Not a space address"
        headline="That isn't a space address."
        body={`Inside a space, a member is named by DID: at://{authority}/space/${spaceType}/${skey}/{did}. "${author}" isn't a DID, so there is no repository it could name.`}
        initialQuery={author}
      />
    );
  }
  if (error || authorError) {
    const failed = error ? repo : author;
    return (
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That identifier didn't resolve."
        body={`We tried to resolve "${failed}" and the AT Protocol resolver returned: ${error || authorError}. Try another handle, DID, or AT URI below.`}
        initialQuery={failed}
      />
    );
  }
  if (!identity || !authorIdentity) {
    return <p className="explore-placeholder">Resolving identities…</p>;
  }

  return (
    <SpaceRepoView
      identity={identity}
      authorIdentity={authorIdentity}
      spaceType={spaceType}
      skey={skey}
    />
  );
}

function SpaceRepoView({
  identity,
  authorIdentity,
  spaceType,
  skey,
}: {
  identity: IdentityBundle;
  authorIdentity: IdentityBundle;
  spaceType: string;
  skey: string;
}) {
  const space = useMemo(
    () => formatSpaceRef({ authority: identity.did, spaceType, skey }),
    [identity.did, spaceType, skey],
  );
  const access = useSpaceAccess(space);
  // Never `access.transport` directly: the member DID came out of the URL,
  // and so does the host it resolves to. See useSpaceRepoAccess.
  const repoAccess = useSpaceRepoAccess(access, space, authorIdentity.did);
  const transport = repoAccess.transport;
  const repoHost = authorIdentity.pds;

  const [rev, setRev] = useState<string | null>(null);
  const [neverWritten, setNeverWritten] = useState(false);
  const [records, setRecords] = useState<SpaceRecordRow[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRev(null);
    setNeverWritten(false);
    if (!transport) return undefined;
    getSpaceLatestCommit(transport, repoHost, { space, repo: authorIdentity.did })
      .then((result) => {
        if (!cancelled) setRev(result.commit.rev);
      })
      .catch((err) => {
        if (cancelled) return;
        // A member who has never written has no commit, and the host says so
        // with the same RepoNotFound it uses for a repo you may not read.
        // Treating it as an error here would put a red box on an ordinary
        // empty account; the record listing below is the honest check.
        if (classifySpaceError(err).kind === 'repo-not-found') setNeverWritten(true);
      });
    return () => {
      cancelled = true;
    };
  }, [transport, repoHost, space, authorIdentity.did]);

  useEffect(() => {
    let cancelled = false;
    setRecords([]);
    setComplete(false);
    setError(null);
    if (!transport) return undefined;

    setLoading(true);
    // Values are excluded: this level only needs the shape of the repo — which
    // collections exist and how much is in each — and pulling every record body
    // to count them would be a lot of private data for a summary.
    collectSpacePages<SpaceRecordRow>(
      async (cursor) => {
        const page = await listSpaceRecords(transport, repoHost, {
          space,
          repo: authorIdentity.did,
          limit: RECORDS_PER_PAGE,
          cursor,
          excludeValues: true,
        });
        return { cursor: page.cursor, items: page.records };
      },
      { limit: RECORDS_PER_PAGE },
    )
      .then((result) => {
        if (cancelled) return;
        setRecords(result.items);
        setComplete(result.complete);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transport, repoHost, space, authorIdentity.did]);

  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      counts.set(record.collection, (counts.get(record.collection) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [records]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? collections.filter(([nsid]) => nsid.toLowerCase().includes(query)) : collections),
    [collections, query],
  );

  useChromeBarField({
    placeholder: 'Filter collections…',
    label: 'Filter the collections in this repository',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status:
      collections.length === 0
        ? null
        : `${formatCount(visible.length)}/${formatCount(collections.length)}`,
  });

  const repoSeg = encodeRepo(identity.handle || identity.did);
  const authorPath = `/explore/${repoSeg}/space/${spaceType}/${encodeURIComponent(skey)}/${encodeRepo(authorIdentity.did)}`;
  const memberLabel = authorIdentity.handle ? `@${authorIdentity.handle}` : shortDid(authorIdentity.did);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          spaceRoot
          spaceType={spaceType}
          skey={skey}
          author={authorIdentity.did}
          shareUrl={authorPath}
        />
      </AppearIn>

      <AppearIn delay={0.04}>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
            gap: '1rem',
            padding: '1rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            margin: 0,
          }}
        >
          <Field label="member">
            <Link
              href={`/explore/${encodeRepo(authorIdentity.did)}`}
              style={{ color: 'var(--text-primary)', textDecoration: 'none', minWidth: 0 }}
            >
              <code style={{ background: 'transparent', padding: 0, color: 'inherit' }}>
                {memberLabel}
              </code>
            </Link>
            <CopyButton value={authorIdentity.did} label="Copy did" compact variant="subtle" />
          </Field>
          <Field label="repo host">
            <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
              {repoHost}
            </code>
          </Field>
          <Field label="rev">
            {rev ? (
              <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
                {rev}
              </code>
            ) : neverWritten && error == null ? (
              // Only after the record listing came back clean. The same
              // RepoNotFound answers "never written" and "not readable by you",
              // and the second one must not be reported as the first.
              <span className="explore-muted">no writes yet</span>
            ) : (
              <span className="explore-muted">unknown</span>
            )}
          </Field>
        </dl>
      </AppearIn>

      {!transport && (
        <AppearIn delay={0.08}>
          <SpaceRepoAccessPanel access={access} repo={repoAccess} what={`${memberLabel}’s records in this space`} />
        </AppearIn>
      )}

      {transport && (
        <AppearIn delay={0.08} id={CHROME_RESULTS_ID}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h2 style={sectionHeadingStyle}>Collections</h2>
            {error != null && <SpaceReadErrorPanel err={error} what={`${memberLabel}’s records`} />}
            {error == null && (
              <>
                {loading && records.length === 0 && (
                  <p className="explore-placeholder">Loading records…</p>
                )}
                {!loading && collections.length === 0 && (
                  <p className="explore-placeholder">
                    No records from this member in this space.
                  </p>
                )}
                {collections.length > 0 && visible.length === 0 && (
                  <p className="explore-placeholder">
                    No collections match <code>{filter.trim()}</code>.
                  </p>
                )}
                {visible.length > 0 && (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      border: '1px solid var(--border-medium)',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    {visible.map(([nsid, count]) => (
                      <li key={nsid} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <Link
                          href={`${authorPath}/${nsid}`}
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'baseline',
                            gap: '0.75rem',
                            padding: '0.625rem 1rem',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            color: 'var(--text-primary)',
                            textDecoration: 'none',
                          }}
                        >
                          <code style={{ background: 'transparent', padding: 0, color: 'inherit' }}>
                            {nsid}
                          </code>
                          <span
                            style={{
                              marginLeft: 'auto',
                              color: 'var(--text-tertiary)',
                              fontSize: '0.75rem',
                            }}
                          >
                            {formatCount(count)}
                            {complete ? '' : '+'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {!complete && records.length > 0 && (
                  <p style={noteStyle}>
                    Counts are from the first {formatCount(records.length)} records;
                    the listing was cut off before the end.
                  </p>
                )}
              </>
            )}
          </section>
        </AppearIn>
      )}

      {transport && (
        <AppearIn delay={0.12}>
          <OpsSection
            space={space}
            repoHost={repoHost}
            repoDid={authorIdentity.did}
            transport={transport}
          />
        </AppearIn>
      )}
    </div>
  );
}

/**
 * The tail of the repository's operation log, collapsed by default.
 *
 * The oplog is a sync optimization with no history guarantee: a host may
 * compact or drop it, and omitting `since` returns whatever window is still
 * retained rather than everything that ever happened. Reaching the head is
 * signalled by the response carrying a `commit` — which is exactly when the
 * cursor stops coming — so the walk terminates on that and not on a count.
 */
function OpsSection({
  space,
  repoHost,
  repoDid,
  transport,
}: {
  space: string;
  repoHost: string;
  repoDid: string;
  transport: SpaceTransport;
}) {
  const [open, setOpen] = useState(false);
  const [ops, setOps] = useState<SpaceOpEntry[]>([]);
  const [reachedHead, setReachedHead] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setOps([]);
    setReachedHead(false);
    setError(null);
    if (!open) return undefined;

    setLoading(true);
    (async () => {
      try {
        const collected: SpaceOpEntry[] = [];
        let cursor: string | undefined;
        let head = false;
        for (let page = 0; page < MAX_OP_PAGES; page++) {
          const result = await listSpaceRepoOps(transport, repoHost, {
            space,
            repo: repoDid,
            limit: OPS_PER_PAGE,
            cursor,
            excludeValues: true,
          });
          collected.push(...result.ops);
          if (result.commit || !result.cursor) {
            head = true;
            break;
          }
          cursor = result.cursor;
        }
        if (cancelled) return;
        setOps(collected);
        setReachedHead(head);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, transport, repoHost, repoDid, space]);

  return (
    <details
      className="explore-section"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Recent operations</summary>
      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {loading && <p className="explore-placeholder">Reading the operation log…</p>}
        {error != null && <SpaceReadErrorPanel err={error} what="this repository’s operation log" />}
        {!loading && error == null && ops.length === 0 && open && (
          <p className="explore-placeholder">No operations retained for this repository.</p>
        )}
        {ops.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-secondary)',
            }}
          >
            {ops.map((op) => (
              <li
                key={`${op.rev}-${op.collection}-${op.rkey}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: '0.75rem',
                  padding: '0.5rem 1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--text-accent)' }}>{opKind(op)}</span>
                <span style={{ overflowWrap: 'anywhere' }}>
                  {op.collection}/{op.rkey}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{op.rev}</span>
              </li>
            ))}
          </ul>
        )}
        {ops.length > 0 && !reachedHead && (
          <p style={noteStyle}>
            Stopped after {formatCount(ops.length)} operations without reaching the
            head of the log.
          </p>
        )}
      </div>
    </details>
  );
}

/** `cid: null` is a delete; `prev: null` is a create; both present is an update. */
function opKind(op: SpaceOpEntry): string {
  if (op.cid === null) return 'delete';
  if (op.prev === null) return 'create';
  return 'update';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
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

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif)',
  fontWeight: 400,
  fontSize: '1rem',
  color: 'var(--text-primary)',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};
