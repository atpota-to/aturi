'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo } from '@/utils/atproto/urls';
import type { IdentityBundle } from '@/utils/atproto/identity';

type SubGroup = {
  /** 3rd NSID segment, e.g. "feed", "graph", "actor". */
  key: string;
  /** Composite key used as a stable React + collapsed-state id. */
  fullKey: string;
  items: string[];
};

type MajorGroup = {
  /** First two NSID segments, e.g. "app.bsky", "is.dame". */
  key: string;
  /** 3-segment NSIDs that live directly under the major group (no sub). */
  directItems: string[];
  /** 4+ segment NSIDs grouped by their 3rd segment. */
  subgroups: SubGroup[];
  /** Total leaf NSIDs across direct + all sub-groups. */
  totalCount: number;
};

/**
 * Two-level hierarchical grouping.
 *
 *   `app.bsky.feed.post`        → major `app.bsky`, sub `feed`, leaf
 *   `app.bsky.feed.post.shit`   → major `app.bsky`, sub `feed`, leaf
 *   `app.bsky.actor.profile`    → major `app.bsky`, sub `actor`, leaf
 *   `is.dame.now`               → major `is.dame`, no sub, direct leaf
 *
 * For NSIDs with fewer than 4 segments there's no third segment to sub-group
 * by, so they sort under the major group as direct leaves above the sub-groups.
 */
function groupHierarchically(list: string[], filterStr: string): MajorGroup[] {
  const f = filterStr.trim().toLowerCase();
  const filtered = f ? list.filter((nsid) => nsid.toLowerCase().includes(f)) : list;

  // Two-pass: bucket by major, then by sub within each major.
  const majors = new Map<
    string,
    { direct: string[]; subs: Map<string, string[]> }
  >();
  for (const nsid of filtered) {
    const segs = nsid.split('.');
    const major = segs.length >= 2 ? `${segs[0]}.${segs[1]}` : nsid;
    if (!majors.has(major)) majors.set(major, { direct: [], subs: new Map() });
    const bucket = majors.get(major)!;
    if (segs.length >= 4) {
      const subKey = segs[2];
      if (!bucket.subs.has(subKey)) bucket.subs.set(subKey, []);
      bucket.subs.get(subKey)!.push(nsid);
    } else {
      bucket.direct.push(nsid);
    }
  }

  // Sort + materialize. Sub-groups with a single item are hoisted up to
  // the major's direct list — a collapsible group containing one row is
  // pure wrapper noise.
  return Array.from(majors.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([majorKey, bucket]) => {
      const hoistedDirect = [...bucket.direct];
      const subgroups: SubGroup[] = [];
      for (const [subKey, items] of bucket.subs.entries()) {
        if (items.length === 1) {
          hoistedDirect.push(items[0]);
        } else {
          subgroups.push({
            key: subKey,
            fullKey: `${majorKey}.${subKey}`,
            items: items.sort(),
          });
        }
      }
      subgroups.sort((a, b) => a.key.localeCompare(b.key));
      const totalCount =
        hoistedDirect.length + subgroups.reduce((acc, s) => acc + s.items.length, 0);
      return {
        key: majorKey,
        directItems: hoistedDirect.sort(),
        subgroups,
        totalCount,
      };
    });
}

export default function CollectionsTab({ identity }: { identity: IdentityBundle }) {
  const [collections, setCollections] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /** Collapsed-state map keyed by full group/sub key (e.g. "app.bsky" or "app.bsky.feed"). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setCollections(null);
    setError(null);
    describeRepo(identity.pds, identity.did)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.collections) ? [...res.collections].sort() : [];
        setCollections(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity.pds, identity.did]);

  const groups = useMemo(
    () => groupHierarchically(collections || [], filter),
    [collections, filter],
  );

  const repoSeg = encodeRepo(identity.handle || identity.did);

  function toggle(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] ? true : false }));
  }

  if (error) return <p className="explore-error">{error}</p>;
  if (!collections) return <p className="explore-placeholder">Loading collections…</p>;
  if (collections.length === 0) {
    return <p className="explore-placeholder">No collections on this repo.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <input
        type="text"
        placeholder="Filter lexicons…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          maxWidth: '24rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          outline: 'none',
        }}
      />

      {groups.length === 0 ? (
        <p className="explore-placeholder">
          No collections match <code>{filter}</code>.
        </p>
      ) : (
        groups.map((g) => {
          const majorOpen = collapsed[g.key] !== true;
          return (
            <section
              key={g.key}
              style={{
                border: '1px solid var(--border-medium)',
                background: 'var(--bg-secondary)',
              }}
            >
              <GroupHeader
                open={majorOpen}
                onToggle={() => toggle(g.key)}
                prefix={g.key}
                count={g.totalCount}
                emphasize
              />
              {majorOpen && (
                <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {/* Direct leaves (3-segment NSIDs) come first. */}
                  {g.directItems.length > 0 && (
                    <ul style={listStyle()}>
                      {g.directItems.map((nsid, i) => (
                        <LeafRow
                          key={nsid}
                          nsid={nsid}
                          href={`/explore/${repoSeg}/${nsid}`}
                          dimPrefix={`${g.key}.`}
                          baseBg={i % 2 === 0 ? 'var(--bg-primary)' : 'transparent'}
                        />
                      ))}
                    </ul>
                  )}
                  {/* Then collapsible sub-groups. */}
                  {g.subgroups.map((sub) => {
                    const subOpen = collapsed[sub.fullKey] !== true;
                    return (
                      <div
                        key={sub.fullKey}
                        style={{
                          borderTop:
                            g.directItems.length > 0 || g.subgroups.indexOf(sub) > 0
                              ? '1px solid var(--border-subtle)'
                              : undefined,
                        }}
                      >
                        <GroupHeader
                          open={subOpen}
                          onToggle={() => toggle(sub.fullKey)}
                          prefix={sub.fullKey}
                          dimPrefix={`${g.key}.`}
                          count={sub.items.length}
                          indent
                        />
                        {subOpen && (
                          <ul
                            style={{
                              ...listStyle(),
                              borderTop: '1px solid var(--border-subtle)',
                            }}
                          >
                            {sub.items.map((nsid, i) => (
                              <LeafRow
                                key={nsid}
                                nsid={nsid}
                                href={`/explore/${repoSeg}/${nsid}`}
                                deepIndent
                                dimPrefix={`${sub.fullKey}.`}
                                baseBg={i % 2 === 0 ? 'var(--bg-primary)' : 'transparent'}
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function GroupHeader({
  open,
  onToggle,
  prefix,
  dimPrefix,
  count,
  emphasize,
  indent,
}: {
  open: boolean;
  onToggle: () => void;
  prefix: string;
  /** Leading slice of `prefix` to render dimmed because it's inherited from a parent group. */
  dimPrefix?: string;
  count: number;
  emphasize?: boolean;
  indent?: boolean;
}) {
  const hasDim = dimPrefix && prefix.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? prefix.slice(dimPrefix.length) : prefix;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        width: '100%',
        padding: indent ? '0.55rem 1rem 0.55rem 1.5rem' : '0.625rem 1rem',
        background: 'transparent',
        border: 0,
        textAlign: 'left',
        fontFamily: 'var(--font-mono)',
        fontSize: indent ? '0.8125rem' : '0.875rem',
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
          // minWidth: 0 lets the flex item shrink below its intrinsic
          // content width — without it, a long unbreakable NSID (e.g. a
          // ULID-style rkey segment) pushes the count badge off the row.
          minWidth: 0,
          background: 'transparent',
          padding: 0,
          color: emphasize ? 'var(--text-accent)' : 'var(--text-secondary)',
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
        }}
      >
        {dim && <span style={{ color: 'var(--text-tertiary)' }}>{dim}</span>}
        {tail}
        <span style={{ color: 'var(--text-tertiary)' }}>.*</span>
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
        {count}
      </span>
    </button>
  );
}

function LeafRow({
  nsid,
  href,
  deepIndent,
  dimPrefix,
  baseBg,
}: {
  nsid: string;
  href: string;
  deepIndent?: boolean;
  /** Leading slice of `nsid` that's redundant given the parent group; rendered dimmed. */
  dimPrefix?: string;
  /** Resting background for zebra striping; mouseleave restores to this. */
  baseBg: string;
}) {
  const hasDim = dimPrefix && nsid.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? nsid.slice(dimPrefix.length) : nsid;
  return (
    <li>
      <Link
        href={href}
        style={{
          display: 'block',
          padding: deepIndent
            ? '0.5rem 1rem 0.5rem 3rem'
            : '0.5rem 1rem 0.5rem 2.5rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          background: baseBg,
          textDecoration: 'none',
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
          transition: 'background 0.2s ease, color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
          e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = baseBg;
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
      >
        {dim && <span style={{ color: 'var(--text-tertiary)' }}>{dim}</span>}
        {tail}
      </Link>
    </li>
  );
}

function listStyle(): React.CSSProperties {
  return {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  };
}
