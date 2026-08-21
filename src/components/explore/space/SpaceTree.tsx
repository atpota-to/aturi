'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, FolderOpen, Info } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo, shortDid, spaceExplorePath } from '@/utils/atproto/urls';
import { parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { listSpaceRecords, listSpaces } from '@/utils/atproto/spaceClient';
import { resolveDidHandle } from '@/utils/atproto/identity';
import { formatCount } from '../collectionListHelpers';
import { useOwnPdsTransport } from './useSpaceAccess';

/**
 * The space → collection tree, and the loading behind it, shared by the repo
 * page's permissioned-data section and the dedicated spaces page.
 *
 * Records stop at the collection row on purpose: the records list is a page
 * with its own filtering and paging, and a nested copy would go stale against
 * it and drown the tree at any real record count.
 *
 * **No credential is involved anywhere in here.** Reading your own repo in a
 * space needs only the OAuth token — the repo host compares that token's DID
 * against the requested repo, which is exactly what a `read_self` grant
 * addresses. The consent gate in `useSpaceAccess` guards the other thing:
 * minting a credential sends a token naming you to a host the *address* chose.
 * Nothing here does that, because both the repo and the host are your own.
 */

/**
 * Records scanned per space to derive its collection list. There is no "list
 * the collections in a space" method — `listRecords` without a collection
 * spans all of them — so one request per space yields both the collections and
 * their counts.
 */
const RECORDS_PER_SPACE = 200;

export type CollectionNode = { collection: string; count: number };

export type SpaceContents =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; collections: CollectionNode[]; complete: boolean };

/** What {@link useSpaceTree} hands back to whatever is rendering it. */
export type SpaceTree = {
  uris: string[];
  /** More spaces exist than the caller's limit asked for. */
  more: boolean;
  loading: boolean;
  error: string | null;
  contents: ReadonlyMap<string, SpaceContents>;
  handles: ReadonlyMap<string, string>;
  /** Total records counted across every space whose scan has landed. */
  totalRecords: number;
  /** Distinct collections seen across every space whose scan has landed. */
  totalCollections: number;
  /** Distinct authorities across the listed spaces. */
  authorities: string[];
};

/**
 * Lists the signed-in account's spaces and scans each one for its collections.
 *
 * Every listed space is fetched as soon as the list arrives, because the rows
 * render expanded — a list of addresses you have to click open one at a time
 * is a table of contents, not a view of your data. These are same-origin
 * requests to the visitor's own PDS, so the browser's per-origin cap paces
 * them without help from here.
 */
export function useSpaceTree({
  enabled,
  limit,
}: {
  enabled: boolean;
  limit: number;
}): SpaceTree {
  const { did: signedInDid, pds } = useAtprotoSession();
  const transport = useOwnPdsTransport();

  const [uris, setUris] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contents, setContents] = useState<ReadonlyMap<string, SpaceContents>>(new Map());
  const [handles, setHandles] = useState<ReadonlyMap<string, string>>(new Map());

  const canList = enabled && transport !== null;

  // Unmount has to stop late responses from writing into a dead tree, and the
  // per-space fetches don't each own an effect to hang that on.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Which spaces a fetch has already been fired for. A ref rather than state
  // so the load effect doesn't re-run every time a response lands.
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setUris([]);
    setMore(false);
    setError(null);
    setContents(new Map());
    requested.current.clear();
    if (!canList || !transport) return undefined;

    setLoading(true);
    listSpaces(transport, { limit: limit + 1 })
      .then((page) => {
        if (cancelled) return;
        const found = page.spaces.map((space) => space.uri);
        setUris(found.slice(0, limit));
        setMore(found.length > limit || Boolean(page.cursor));
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
  }, [canList, transport, limit]);

  // Authority handles, resolved once per distinct DID. A space anchored on
  // someone else's account is the common case here, not the exception. Keyed
  // off a joined string so the effect has one primitive dependency.
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
        // `excludeValues`: this derives collection names and counts, and the
        // values are the expensive half of the response.
        const page = await listSpaceRecords(transport, pds, {
          space: uri,
          repo: signedInDid,
          limit: RECORDS_PER_SPACE,
          excludeValues: true,
        });
        if (!alive.current) return;
        const counts = new Map<string, number>();
        for (const record of page.records) {
          counts.set(record.collection, (counts.get(record.collection) ?? 0) + 1);
        }
        const collections = [...counts.entries()]
          .map(([collection, count]) => ({ collection, count }))
          .sort((a, b) => a.collection.localeCompare(b.collection));
        setContents((prev) =>
          new Map(prev).set(uri, { status: 'ready', collections, complete: !page.cursor }),
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

  useEffect(() => {
    if (!canList) return;
    for (const uri of uris) {
      if (requested.current.has(uri)) continue;
      requested.current.add(uri);
      void loadSpace(uri);
    }
  }, [uris, canList, loadSpace]);

  let totalRecords = 0;
  const collectionNames = new Set<string>();
  for (const entry of contents.values()) {
    if (entry.status !== 'ready') continue;
    for (const node of entry.collections) {
      totalRecords += node.count;
      collectionNames.add(node.collection);
    }
  }

  const authorities = new Set<string>();
  for (const uri of uris) {
    const parts = parseSpaceAtUri(uri);
    if (parts) authorities.add(parts.authority);
  }

  return {
    uris,
    more,
    loading,
    error,
    contents,
    handles,
    totalRecords,
    totalCollections: collectionNames.size,
    authorities: [...authorities],
  };
}

/**
 * The rendered tree, grouped by space type.
 *
 * The type is the application: `at.secretsky.feed` is Secretsky, whoever runs
 * the particular space. The authority only says *which* Secretsky feed, and
 * two authorities running the same type are separate spaces holding separate
 * data, so they can be listed together but never merged.
 *
 * Ungrouped, a visitor in five Secretsky feeds got five cards that opened with
 * someone else's handle, and had to read the type off each one to see they
 * were the same app. Grouped, the app is the heading and the authority is what
 * distinguishes the rows under it.
 */
export function SpaceTreeList({
  tree,
  memberDid,
}: {
  tree: SpaceTree;
  memberDid: string;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggleSpace(uri: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }

  // Grouped in the order the types first appear, so the listing keeps whatever
  // order the PDS returned rather than imposing an alphabetical one on it.
  const groups: { type: string; uris: string[] }[] = [];
  const unparsed: string[] = [];
  for (const uri of tree.uris) {
    const parts = parseSpaceAtUri(uri);
    if (!parts) {
      unparsed.push(uri);
      continue;
    }
    const group = groups.find((g) => g.type === parts.spaceType);
    if (group) group.uris.push(uri);
    else groups.push({ type: parts.spaceType, uris: [uri] });
  }

  function recordsIn(uris: string[]): number | null {
    let total = 0;
    let any = false;
    for (const uri of uris) {
      const entry = tree.contents.get(uri);
      if (entry?.status !== 'ready') continue;
      any = true;
      for (const node of entry.collections) total += node.count;
    }
    return any ? total : null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {groups.map((group) => {
        const records = recordsIn(group.uris);
        return (
          <div
            key={group.type}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: '0.5rem',
              }}
            >
              <code
                style={{
                  background: 'transparent',
                  padding: 0,
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  overflowWrap: 'anywhere',
                }}
              >
                {group.type}
              </code>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                {group.uris.length === 1 ? '1 space' : `${formatCount(group.uris.length)} spaces`}
                {records !== null && ` · ${formatCount(records)} records`}
              </span>
            </div>
            {group.uris.map((uri) => {
              const parts = parseSpaceAtUri(uri);
              return (
                <SpaceBranch
                  key={uri}
                  uri={uri}
                  memberDid={memberDid}
                  authorityHandle={parts ? tree.handles.get(parts.authority) : undefined}
                  isOwnAuthority={Boolean(parts && parts.authority === memberDid)}
                  open={!collapsed.has(uri)}
                  onToggle={() => toggleSpace(uri)}
                  contents={tree.contents.get(uri)}
                />
              );
            })}
          </div>
        );
      })}

      {unparsed.map((uri) => (
        <SpaceBranch
          key={uri}
          uri={uri}
          memberDid={memberDid}
          open
          onToggle={() => undefined}
          contents={undefined}
        />
      ))}
    </div>
  );
}

/**
 * One space and its collections. A space whose address this app can't parse
 * still gets a row, as text — it is a real space that simply has no page here,
 * and hiding it would be worse than showing it.
 */
function SpaceBranch({
  uri,
  memberDid,
  authorityHandle,
  isOwnAuthority,
  open,
  onToggle,
  contents,
}: {
  uri: string;
  memberDid: string;
  authorityHandle?: string;
  isOwnAuthority?: boolean;
  open: boolean;
  onToggle: () => void;
  contents: SpaceContents | undefined;
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
        {uri} (unrecognised address)
      </div>
    );
  }

  const spacePath = spaceExplorePath(parts);
  const memberPath = `${spacePath}/${encodeRepo(memberDid)}`;
  const count =
    contents?.status === 'ready'
      ? contents.collections.reduce((sum, node) => sum + node.count, 0)
      : null;

  const spaceLabel = isOwnAuthority
    ? `your ${parts.spaceType} space`
    : `${authorityHandle ? `@${authorityHandle}` : shortDid(parts.authority)}’s ${parts.spaceType} space`;

  return (
    <section style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
      {/* Toggle and the two destinations share the header row, the way the
          collections list pairs its group header with a pin. They used to be a
          footer of two underlined sentences on every card, which repeated the
          same two phrases once per space and cost a row each. */}
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
        {/* Stacked rather than side by side: the type and the authority are
            both unbreakable-ish strings, and competing for one line meant the
            NSID got chopped mid-word on a phone. Vertically each gets the full
            width, and the authority reads as the qualifier it is. */}
        {/* The authority leads and the type is dropped: the group heading
            above already names the type, and within a group the authority is
            the only thing telling two rows apart. The key stays as the
            qualifier, since one authority can run several spaces of a type. */}
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem',
            flex: 1,
            minWidth: 0,
          }}
        >
          <code
            style={{
              background: 'transparent',
              padding: 0,
              color: 'var(--text-accent)',
              // `anywhere` rather than `break-all`: break only when a segment
              // genuinely doesn't fit, instead of eagerly at any character.
              overflowWrap: 'anywhere',
            }}
          >
            {isOwnAuthority
              ? 'yours'
              : authorityHandle
                ? `@${authorityHandle}`
                : shortDid(parts.authority)}
          </code>
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-tertiary)',
              overflowWrap: 'anywhere',
            }}
          >
            {parts.skey}
          </span>
        </span>
        {count !== null && (
          <span
            style={{
              flexShrink: 0,
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              padding: '0.125rem 0.5rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {formatCount(count)}
          </span>
        )}
      </button>
        <Link
          href={memberPath}
          aria-label={`Your records in ${spaceLabel}`}
          title="Your records in this space"
          style={headerIconStyle}
        >
          <FolderOpen size={14} aria-hidden />
        </Link>
        <Link
          href={spacePath}
          aria-label={`About ${spaceLabel}`}
          title="About this space"
          style={headerIconStyle}
        >
          <Info size={14} aria-hidden />
        </Link>
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

          {contents?.status === 'ready' && contents.collections.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {contents.collections.map((node, i) => (
                <CollectionRow
                  key={node.collection}
                  node={node}
                  href={`${memberPath}/${node.collection}`}
                  complete={contents.complete}
                  baseBg={i % 2 === 1 ? 'var(--bg-tertiary)' : 'transparent'}
                  first={i === 0}
                />
              ))}
            </ul>
          )}

          {contents?.status === 'ready' && !contents.complete && (
            <p style={{ ...noteStyle, padding: '0.5rem 1.5rem' }}>
              Counted from the first {formatCount(RECORDS_PER_SPACE)} records in
              this space, so these are lower bounds. Open a collection for its
              full listing.
            </p>
          )}

        </div>
      )}
    </section>
  );
}

/**
 * One collection inside a space — a link to its records, not a third level of
 * tree. The records list is a page with its own filtering and paging, and a
 * nested copy here would go stale against it.
 */
function CollectionRow({
  node,
  href,
  complete,
  baseBg,
  first,
}: {
  node: CollectionNode;
  href: string;
  /** False when the count is a lower bound from a truncated scan. */
  complete: boolean;
  /** Resting background for zebra striping; mouseleave restores to this. */
  baseBg: string;
  /**
   * First row in the list. Its rule is dropped because the branch body it
   * opens already draws one directly above — two adjacent 1px borders paint
   * as a single 2px line, which is what made this separator look heavier than
   * every other one in the tree.
   */
  first?: boolean;
}) {
  return (
    <li
      style={{
        borderTop: first ? 'none' : '1px solid var(--border-subtle)',
        background: baseBg,
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = baseBg;
      }}
    >
      <Link
        href={href}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.55rem 1rem 0.55rem 2.25rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
        }}
      >
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
          {formatCount(node.count)}
          {complete ? '' : '+'}
        </span>
      </Link>
    </li>
  );
}


/**
 * Icon links in a branch header, modelled on the collections list's pin
 * button. Padding is tighter than the pin's because two of them sit here and
 * the space's own handle needs the width: an alpha-PDS handle runs to about
 * thirty characters, and every pixel these take is one it wraps by.
 */
const headerIconStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 0.5rem',
  color: 'var(--text-tertiary)',
  flexShrink: 0,
  transition: 'color 0.15s ease',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};
