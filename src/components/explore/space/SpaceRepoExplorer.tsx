'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, User } from 'lucide-react';
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
import SkeletonSwap from '../skeletons/SkeletonSwap';
import { SpaceRepoSkeleton } from '../skeletons/pages';
import { SkeletonRowList } from '../skeletons/primitives';
import CopyButton from '../CopyButton';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
import SpaceTitleBar from './SpaceTitleBar';
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
        headline="That isn’t a space address."
        body={`Inside a space, a member is named by DID: at://{authority}/space/${spaceType}/${skey}/{did}. "${author}" isn’t a DID, so there is no repository it could name.`}
        initialQuery={author}
      />
    );
  }
  if (error || authorError) {
    const failed = error ? repo : author;
    return (
      <NotFoundPanel
        eyebrow="Couldn’t resolve"
        headline="That identifier didn’t resolve."
        body={`We couldn’t find an account for “${failed}”. Check the spelling, or try a DID or an at:// URI below.`}
        details={error || authorError}
        initialQuery={failed}
      />
    );
  }

  return (
    <SkeletonSwap
      loading={!identity || !authorIdentity}
      skeleton={<SpaceRepoSkeleton />}
    >
      {identity && authorIdentity && (
        <SpaceRepoView
          identity={identity}
          authorIdentity={authorIdentity}
          spaceType={spaceType}
          skey={skey}
        />
      )}
    </SkeletonSwap>
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
    <div className="fx-explorer" data-page="space-member">
      <div className="fx-head">
        <AppearIn rise>
          <SpaceTitleBar
            crumbs={
              <Breadcrumb
                handle={identity.handle}
                did={identity.did}
                pds={identity.pds}
                spaceRoot
                spaceType={spaceType}
                skey={skey}
                author={authorIdentity.did}
                authorHandle={authorIdentity.handle}
                titled
              />
            }
            title={memberLabel}
            pill={
              <span className="fx-pill">
                <User size={12} aria-hidden />
                Member repository
              </span>
            }
            shareUrl={authorPath}
          />
        </AppearIn>
      </div>

      <aside className="fx-side" aria-label="Member">
        <AppearIn delay={0.04}>
          <section className="fx-card fx-sp-section">
            <div className="fx-sp-head">
              <h2 className="fx-sp-h2">Repository</h2>
            </div>
            <div className="fx-sp-body">
              <dl className="fx-sp-fields">
                <Field label="Member">
                  <Link href={`/explore/${encodeRepo(authorIdentity.did)}`} prefetch={false}>
                    <code>{memberLabel}</code>
                  </Link>
                  <CopyButton
                    value={authorIdentity.did}
                    label="Copy did"
                    compact
                    variant="subtle"
                    iconOnly
                  />
                </Field>
                <Field label="Repo host">
                  <code>{repoHost}</code>
                </Field>
                <Field label="Rev">
                  {rev ? (
                    <code>{rev}</code>
                  ) : neverWritten && error == null ? (
                    // Only after the record listing came back clean. The same
                    // RepoNotFound answers "never written" and "not readable by
                    // you", and the second one must not be reported as the first.
                    <span className="explore-muted">no writes yet</span>
                  ) : (
                    <span className="explore-muted">unknown</span>
                  )}
                </Field>
              </dl>
            </div>
          </section>
        </AppearIn>
      </aside>

      <div className="fx-main">
        {!transport && (
          <AppearIn delay={0.08}>
            <SpaceRepoAccessPanel access={access} repo={repoAccess} what={`${memberLabel}’s records in this space`} />
          </AppearIn>
        )}

        {transport && (
          <AppearIn delay={0.08} id={CHROME_RESULTS_ID}>
            <section className="fx-card fx-sp-section">
              <div className="fx-sp-head">
                <h2 className="fx-sp-h2">Collections</h2>
                {collections.length > 0 && (
                  <span className="fx-sp-head-count">{formatCount(collections.length)}</span>
                )}
              </div>
              {error != null && (
                <div className="fx-sp-body">
                  <SpaceReadErrorPanel err={error} what={`${memberLabel}’s records`} />
                </div>
              )}
              {error == null && (
                <>
                  {loading && records.length === 0 && (
                    <div className="fx-sp-body">
                      <SkeletonRowList rows={4} trailingWidth="4rem" />
                    </div>
                  )}
                  {!loading && collections.length === 0 && (
                    <p className="fx-sp-msg">No records from this member in this space.</p>
                  )}
                  {collections.length > 0 && visible.length === 0 && (
                    <p className="fx-sp-msg">
                      No collections match <code>{filter.trim()}</code>.
                    </p>
                  )}
                  {visible.length > 0 && (
                    <ul className="fx-sp-list">
                      {visible.map(([nsid, count]) => (
                        <li key={nsid}>
                          <Link href={`${authorPath}/${nsid}`} prefetch={false} className="fx-sp-row">
                            <code className="fx-sp-row-main">{nsid}</code>
                            <span className="fx-sp-row-end">
                              {formatCount(count)}
                              {complete ? '' : '+'}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!complete && records.length > 0 && (
                    <p className="fx-sp-note fx-sp-foot">
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
      className="fx-card fx-sp-section fx-sp-details"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <ChevronRight size={14} aria-hidden />
        Recent operations
      </summary>
      {loading && <p className="fx-sp-msg">Reading the operation log…</p>}
      {error != null && (
        <div className="fx-sp-body">
          <SpaceReadErrorPanel err={error} what="this repository’s operation log" />
        </div>
      )}
      {!loading && error == null && ops.length === 0 && open && (
        <p className="fx-sp-msg">No operations retained for this repository.</p>
      )}
      {ops.length > 0 && (
        <ul className="fx-sp-list">
          {ops.map((op) => (
            <li key={`${op.rev}-${op.collection}-${op.rkey}`}>
              <div className="fx-sp-row">
                <span className="fx-sp-op" data-kind={opKind(op)}>
                  {opKind(op)}
                </span>
                <span className="fx-sp-row-plain fx-sp-row-sub">
                  {op.collection}/{op.rkey}
                </span>
                <span className="fx-sp-row-end fx-sp-row-mono">{op.rev}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {ops.length > 0 && !reachedHead && (
        <p className="fx-sp-note fx-sp-foot">
          Stopped after {formatCount(ops.length)} operations without reaching the
          head of the log.
        </p>
      )}
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
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
