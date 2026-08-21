'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo, shortDid, spaceExplorePath } from '@/utils/atproto/urls';
import { parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { listSpaceRecords, listSpaces } from '@/utils/atproto/spaceClient';
import { resolveDidHandle } from '@/utils/atproto/identity';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { formatCount } from '../collectionListHelpers';
import { useOwnPdsTransport, useSpaceGrant } from './useSpaceAccess';

/**
 * Your permissioned data on the repo page, as one tree:
 *
 *   space  →  collection  →  record
 *
 * The same three levels the public half of the page already has, in the same
 * styling, so exploring your own data doesn't mean learning a second shape.
 * Every row links to the full page for that level, but the point is that you
 * shouldn't have to go there to see what you have.
 *
 * It renders only for the account itself, and that is a protocol limit rather
 * than a product choice: `listSpaces` reads the caller's own PDS and takes no
 * subject parameter, so no request exists that asks which spaces somebody else
 * writes to.
 *
 * **No credential is involved anywhere in here**, which is what makes the tree
 * expandable without prompting. Reading your own repo in a space needs only
 * the OAuth token: the repo host compares that token's DID against the
 * requested repo, so a `read_self` grant addresses exactly this. The consent
 * gate in `useSpaceAccess` guards the other thing — minting a credential sends
 * a token naming you to a host the *address* chose — and none of that happens
 * on this page, where both the repo and the host are your own.
 */

/** Spaces listed inline. Rows are collapsed, so this can be generous. */
const SPACE_LIMIT = 25;

/**
 * Records pulled per space. One request returns every collection *and* its
 * records, since `listRecords` without a collection spans all of them — so a
 * space costs exactly one round trip to expand, however many collections it
 * turns out to hold.
 */
const RECORDS_PER_SPACE = 200;

type CollectionNode = { collection: string; rkeys: string[] };

type SpaceContents =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; collections: CollectionNode[]; complete: boolean };

export default function RepoSpacesSection({ identity }: { identity: IdentityBundle }) {
  const { did: signedInDid, pds } = useAtprotoSession();
  const grant = useSpaceGrant();
  const transport = useOwnPdsTransport();

  const [uris, setUris] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openSpaces, setOpenSpaces] = useState<ReadonlySet<string>>(new Set());
  const [openCollections, setOpenCollections] = useState<ReadonlySet<string>>(new Set());
  const [contents, setContents] = useState<ReadonlyMap<string, SpaceContents>>(new Map());

  const [handles, setHandles] = useState<ReadonlyMap<string, string>>(new Map());

  const isSelf = Boolean(signedInDid && signedInDid === identity.did);
  const canList = isSelf && transport !== null && (grant === 'read' || grant === 'read_self');

  // Unmount has to stop late responses from writing into a dead tree, and the
  // per-space fetches are fired from click handlers rather than an effect, so
  // there is no cleanup function to hang that on.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUris([]);
    setMore(false);
    setError(null);
    setOpenSpaces(new Set());
    setOpenCollections(new Set());
    setContents(new Map());
    if (!canList || !transport) return undefined;

    setLoading(true);
    listSpaces(transport, { limit: SPACE_LIMIT + 1 })
      .then((page) => {
        if (cancelled) return;
        const found = page.spaces.map((space) => space.uri);
        setUris(found.slice(0, SPACE_LIMIT));
        setMore(found.length > SPACE_LIMIT || Boolean(page.cursor));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canList, transport]);

  // Authority handles, resolved once per distinct DID. A space anchored on
  // someone else's account is the common case here, not the exception.
  const uriKey = uris.join('\n');
  useEffect(() => {
    const dids = new Set<string>();
    for (const uri of uriKey ? uriKey.split('\n') : []) {
      const parts = parseSpaceAtUri(uri);
      if (parts) dids.add(parts.authority);
    }
    if (dids.size === 0) return undefined;

    let cancelled = false;
    Promise.all(
      [...dids].map(async (did) => [did, await resolveDidHandle(did)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const [did, handle] of pairs) if (handle) next.set(did, handle);
      setHandles(next);
    });

    return () => {
      cancelled = true;
    };
  }, [uriKey]);

  const loadSpace = useCallback(
    async (uri: string) => {
      if (!transport || !pds || !signedInDid) return;
      setContents((prev) => new Map(prev).set(uri, { status: 'loading' }));
      try {
        // `excludeValues`: the tree renders keys, not bodies, and the values
        // are the expensive half of the response.
        const page = await listSpaceRecords(transport, pds, {
          space: uri,
          repo: signedInDid,
          limit: RECORDS_PER_SPACE,
          excludeValues: true,
        });
        if (!alive.current) return;
        const grouped = new Map<string, string[]>();
        for (const record of page.records) {
          const list = grouped.get(record.collection);
          if (list) list.push(record.rkey);
          else grouped.set(record.collection, [record.rkey]);
        }
        const collections = [...grouped.entries()]
          .map(([collection, rkeys]) => ({ collection, rkeys }))
          .sort((a, b) => a.collection.localeCompare(b.collection));
        setContents((prev) =>
          new Map(prev).set(uri, {
            status: 'ready',
            collections,
            complete: !page.cursor,
          }),
        );
      } catch (err) {
        if (!alive.current) return;
        setContents((prev) =>
          new Map(prev).set(uri, {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [transport, pds, signedInDid],
  );

  function toggleSpace(uri: string) {
    setOpenSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
    // Fetch on first open only; a collapse-and-reopen reuses what came back.
    if (!contents.has(uri)) void loadSpace(uri);
  }

  function toggleCollection(key: string) {
    setOpenCollections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!isSelf) return null;

  const repoSegment = encodeRepo(identity.handle || identity.did);

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        borderTop: '1px solid var(--border-medium)',
        paddingTop: '1.25rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1rem',
            color: 'var(--text-primary)',
          }}
        >
          Permissioned spaces
        </h2>
        <Link href={`/explore/${repoSegment}/space`} className="explore-json-link">
          Open spaces explorer →
        </Link>
      </div>

      <p style={noteStyle}>
        Records you keep outside your public repo. Only you can see this list
        when logged in.
      </p>

      {grant === 'unknown' && <p className="explore-placeholder">Checking your access…</p>}

      {grant === 'none' && (
        <p style={noteStyle}>
          Your session has no space permission, so there’s nothing to read.
          Sign in again and tick a permissioned-data row to grant one.
        </p>
      )}

      {canList && (
        <>
          {error && <p className="explore-error">{error}</p>}
          {!error && loading && uris.length === 0 && (
            <p className="explore-placeholder">Loading spaces…</p>
          )}
          {!error && !loading && uris.length === 0 && (
            <p className="explore-placeholder">
              You haven’t written to any spaces yet. Anything you write in a
              space app will show up here.
            </p>
          )}

          {uris.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {uris.map((uri) => (
                <SpaceBranch
                  key={uri}
                  uri={uri}
                  memberDid={signedInDid ?? ''}
                  authorityHandle={
                    parseSpaceAtUri(uri) ? handles.get(parseSpaceAtUri(uri)!.authority) : undefined
                  }
                  isOwnAuthority={parseSpaceAtUri(uri)?.authority === signedInDid}
                  open={openSpaces.has(uri)}
                  onToggle={() => toggleSpace(uri)}
                  contents={contents.get(uri)}
                  openCollections={openCollections}
                  onToggleCollection={toggleCollection}
                />
              ))}
            </div>
          )}

          {more && (
            <p style={noteStyle}>
              Showing the first {SPACE_LIMIT}.{' '}
              <Link href={`/explore/${repoSegment}/space`} className="explore-json-link">
                See all of them
              </Link>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One space and everything under it. A space whose address this app can't
 * parse still gets a row, as text — it is a real space that simply has no page
 * here, and hiding it would be worse than showing it.
 */
function SpaceBranch({
  uri,
  memberDid,
  authorityHandle,
  isOwnAuthority,
  open,
  onToggle,
  contents,
  openCollections,
  onToggleCollection,
}: {
  uri: string;
  memberDid: string;
  authorityHandle?: string;
  isOwnAuthority?: boolean;
  open: boolean;
  onToggle: () => void;
  contents: SpaceContents | undefined;
  openCollections: ReadonlySet<string>;
  onToggleCollection: (key: string) => void;
}) {
  const parts = parseSpaceAtUri(uri);

  if (!parts) {
    return (
      <div
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
          padding: '0.625rem 1rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-tertiary)',
          overflowWrap: 'anywhere',
        }}
      >
        {uri} — unrecognised address
      </div>
    );
  }

  const spacePath = spaceExplorePath(parts);
  const memberPath = `${spacePath}/${encodeRepo(memberDid)}`;
  const count =
    contents?.status === 'ready'
      ? contents.collections.reduce((sum, c) => sum + c.rkeys.length, 0)
      : null;

  return (
    <section style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: 1,
            minWidth: 0,
            padding: '0.625rem 1rem',
            background: 'transparent',
            border: 0,
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.875rem',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          ) : (
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          )}
          <code
            style={{
              minWidth: 0,
              background: 'transparent',
              padding: 0,
              color: 'var(--text-accent)',
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
            }}
          >
            {parts.spaceType}
            <span style={{ color: 'var(--text-tertiary)' }}>/{parts.skey}</span>
          </code>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexShrink: 0,
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
            }}
          >
            {isOwnAuthority ? 'yours' : authorityHandle ? `@${authorityHandle}` : shortDid(parts.authority)}
            {count !== null && (
              <span
                style={{
                  padding: '0.125rem 0.5rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {formatCount(count)}
              </span>
            )}
          </span>
        </button>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {(!contents || contents.status === 'loading') && (
            <p className="explore-placeholder" style={{ padding: '0.625rem 1.5rem', margin: 0 }}>
              Loading your records…
            </p>
          )}

          {contents?.status === 'error' && (
            <p className="explore-error" style={{ padding: '0.625rem 1.5rem', margin: 0 }}>
              {contents.message}
            </p>
          )}

          {contents?.status === 'ready' && contents.collections.length === 0 && (
            <p className="explore-placeholder" style={{ padding: '0.625rem 1.5rem', margin: 0 }}>
              You haven’t written anything to this space yet.
            </p>
          )}

          {contents?.status === 'ready' &&
            contents.collections.map((node) => {
              const key = `${uri} ${node.collection}`;
              return (
                <CollectionBranch
                  key={node.collection}
                  node={node}
                  collectionPath={`${memberPath}/${node.collection}`}
                  open={openCollections.has(key)}
                  onToggle={() => onToggleCollection(key)}
                />
              );
            })}

          {contents?.status === 'ready' && !contents.complete && (
            <p style={{ ...noteStyle, padding: '0.5rem 1.5rem' }}>
              Showing the first {formatCount(RECORDS_PER_SPACE)} records in this
              space. Open a collection for its full listing.
            </p>
          )}

          <div style={{ padding: '0.5rem 1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <Link href={memberPath} className="explore-json-link">
              Your repository here →
            </Link>
            <Link href={spacePath} className="explore-json-link">
              About this space →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

/** One collection inside a space, expanding to its record keys. */
function CollectionBranch({
  node,
  collectionPath,
  open,
  onToggle,
}: {
  node: CollectionNode;
  collectionPath: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: 1,
            minWidth: 0,
            padding: '0.55rem 1rem 0.55rem 1.5rem',
            background: 'transparent',
            border: 0,
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          ) : (
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          )}
          <code
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              padding: 0,
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
            }}
          >
            {node.collection}
          </code>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              padding: '0.125rem 0.5rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            {formatCount(node.rkeys.length)}
          </span>
        </button>
        <Link
          href={collectionPath}
          aria-label={`Open the full ${node.collection} listing`}
          title="Open the full listing"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 0.75rem',
            color: 'var(--text-tertiary)',
            textDecoration: 'none',
            fontSize: '0.75rem',
            flexShrink: 0,
          }}
        >
          →
        </Link>
      </div>

      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {node.rkeys.map((rkey, i) => (
            <li
              key={rkey}
              style={{
                background: i % 2 === 1 ? 'var(--bg-tertiary)' : 'transparent',
                transition: 'background 0.2s ease',
              }}
            >
              <Link
                href={`${collectionPath}/${encodeURIComponent(rkey)}`}
                style={{
                  display: 'block',
                  padding: '0.45rem 1rem 0.45rem 2.5rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  wordBreak: 'break-all',
                  overflowWrap: 'anywhere',
                }}
              >
                {rkey}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};
