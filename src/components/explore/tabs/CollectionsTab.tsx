'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Check,
  Pin,
  PinOff,
} from 'lucide-react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo } from '@/utils/atproto/urls';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { useMyCollections } from '../useRepoCollections';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  PIN_GROUP_SUFFIX,
  isPinGroup,
  nsidCoveredByGroupPin,
  pinGroupPrefix,
  pinMatchesNsid,
  pinTargetFor,
  togglePinnedLexicon,
} from '@/utils/preferences';

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
  /**
   * Cross-repo filter:
   *   - `all`:        show everything on this repo (default)
   *   - `mutual`:     only NSIDs the viewer also has (intersection)
   *   - `notMine`:    only NSIDs the viewer doesn't have yet
   *
   * Only meaningful when signed in and viewing someone else's repo.
   */
  type CommonFilter = 'all' | 'mutual' | 'notMine';
  const [commonFilter, setCommonFilter] = useState<CommonFilter>('all');
  /**
   * Per-group open-state OVERRIDES keyed by full group/sub key (e.g.
   * "app.bsky" or "app.bsky.feed"). A missing key falls back to the
   * user's `collectionGroupsCollapsedByDefault` preference, which is
   * also what the "expand/collapse all" button targets — clicking it
   * writes an explicit override for every visible group key.
   */
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const myCollections = useMyCollections(identity.did);
  const { did: myDid } = useAtprotoSession();
  const { prefs, update } = usePreferences();

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

  // The Mutual-only filter needs me signed in AND looking at someone else
  // (so `myCollections` is non-null and the comparison is meaningful).
  const isSignedIn = Boolean(myDid);
  // "Own repo" is meaningless when signed out — there's no logged-in DID
  // to compare against — so this stays false in that case.
  const isOwnRepo = isSignedIn && myDid === identity.did;
  // Pin buttons work without sign-in: prefs are local-first and only
  // sync to the PDS once the user signs in.
  const canPin = true;
  // Signed-out users have no "mine vs others" distinction, so pin
  // toggles always target the primary list (`pinnedLexicons`). When
  // signed in, the scope picker decides.
  const pinTarget = isSignedIn ? pinTargetFor(prefs.pinScope, isOwnRepo) : 'mine';
  // Which list backs the Pinned section on THIS repo. For signed-out
  // users it's always the primary list — they can't experience the
  // split distinction.
  const activePinList =
    isSignedIn && prefs.pinScope === 'split' && !isOwnRepo
      ? prefs.pinnedLexiconsOthers
      : prefs.pinnedLexicons;
  // Whether the Pinned section bubbles up on this specific repo. When
  // signed out, treat every repo as "show pins here" (effectively `all`
  // scope) — `own` scope would otherwise hide pins everywhere since
  // there's no own repo to be on.
  const pinsVisibleHere =
    !isSignedIn
    || prefs.pinScope === 'all'
    || isOwnRepo
    || prefs.pinScope === 'split';
  // The pinned state shown on each row/header reflects whichever list the
  // next pin click would target — `activePinList` always equals that list
  // when pins are visible here, so a single set backs both exact (leaf) and
  // group (`prefix.*`) membership checks.
  const activePinSet = useMemo(() => new Set(activePinList), [activePinList]);
  const repoCollectionSet = useMemo(
    () => new Set(collections ?? []),
    [collections],
  );

  // Pinned NSID groups (`prefix.*`) that actually have a match on this repo,
  // each paired with the collections it surfaces. Order follows the pin list.
  const pinnedGroups = useMemo(() => {
    if (!pinsVisibleHere || !collections) {
      return [] as { entry: string; prefix: string; items: string[] }[];
    }
    const f = filter.trim().toLowerCase();
    const prefixes = activePinList.filter(isPinGroup).map(pinGroupPrefix);
    return prefixes
      // Drop group pins subsumed by a broader one (e.g. `app.bsky.feed.*`
      // when `app.bsky.*` is also pinned) so members never render twice.
      .filter((p) => !prefixes.some((o) => o !== p && p.startsWith(`${o}.`)))
      .map((prefix) => {
        const entry = `${prefix}${PIN_GROUP_SUFFIX}`;
        const items = collections
          .filter((c) => pinMatchesNsid(entry, c))
          .filter((c) => !f || c.toLowerCase().includes(f))
          .sort();
        return { entry, prefix, items };
      })
      .filter((g) => g.items.length > 0);
  }, [pinsVisibleHere, collections, activePinList, filter]);

  // Individually-pinned NSIDs present on this repo, minus any already
  // surfaced by a pinned group (a group pin subsumes its members).
  const pinnedSingles = useMemo(() => {
    if (!pinsVisibleHere || !collections) return [] as string[];
    const f = filter.trim().toLowerCase();
    return activePinList
      .filter((e) => !isPinGroup(e))
      .filter((n) => repoCollectionSet.has(n))
      .filter((n) => !nsidCoveredByGroupPin(activePinList, n))
      .filter((n) => !f || n.toLowerCase().includes(f));
  }, [pinsVisibleHere, collections, activePinList, repoCollectionSet, filter]);

  // Everything the Pinned section surfaces. The main grouped list drops
  // these so the same collection never renders twice.
  const surfacedSet = useMemo(() => {
    const s = new Set<string>(pinnedSingles);
    for (const g of pinnedGroups) for (const it of g.items) s.add(it);
    return s;
  }, [pinnedSingles, pinnedGroups]);
  const hasAnyPinned = pinnedGroups.length > 0 || pinnedSingles.length > 0;
  const pinnedCount =
    pinnedSingles.length + pinnedGroups.reduce((acc, g) => acc + g.items.length, 0);

  const groupSource = useMemo(() => {
    if (!collections) return [] as string[];
    let list = surfacedSet.size > 0
      ? collections.filter((n) => !surfacedSet.has(n))
      : collections;
    if (commonFilter !== 'all' && myCollections) {
      list = list.filter((n) =>
        commonFilter === 'mutual' ? myCollections.has(n) : !myCollections.has(n),
      );
    }
    return list;
  }, [collections, surfacedSet, commonFilter, myCollections]);

  const groups = useMemo(
    () => groupHierarchically(groupSource, filter),
    [groupSource, filter],
  );

  const repoSeg = encodeRepo(identity.handle || identity.did);

  const defaultOpen = !prefs.collectionGroupsCollapsedByDefault;
  function isOpen(key: string): boolean {
    return openOverrides[key] ?? defaultOpen;
  }
  function toggle(key: string) {
    setOpenOverrides((prev) => ({ ...prev, [key]: !isOpen(key) }));
  }

  // Collect every group key currently rendered so the "expand/collapse all"
  // button can target the visible set, not stale keys from a previous filter.
  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    for (const g of pinnedGroups) keys.push(pinnedKey(g.entry));
    for (const g of groups) {
      keys.push(g.key);
      for (const sg of g.subgroups) keys.push(sg.fullKey);
    }
    return keys;
  }, [groups, pinnedGroups]);
  const anyOpen = allGroupKeys.some((k) => isOpen(k));
  function setAllOpen(open: boolean) {
    setOpenOverrides((prev) => {
      const next = { ...prev };
      for (const k of allGroupKeys) next[k] = open;
      return next;
    });
  }

  function togglePin(nsid: string) {
    update((p) => togglePinnedLexicon(p, nsid, pinTarget));
  }
  // Pinning a group stores the `prefix.*` wildcard in the same list.
  function toggleGroupPin(prefix: string) {
    update((p) => togglePinnedLexicon(p, `${prefix}${PIN_GROUP_SUFFIX}`, pinTarget));
  }
  function isGroupPinned(prefix: string): boolean {
    return activePinSet.has(`${prefix}${PIN_GROUP_SUFFIX}`);
  }

  // Cross-repo filter only makes sense when signed in and viewing someone
  // else's repo (own repo is 100% mutual by definition).
  const showCommonFilter = Boolean(myDid) && !isOwnRepo && myCollections !== null;

  if (error) return <p className="explore-error">{error}</p>;
  if (!collections) return <p className="explore-placeholder">Loading collections…</p>;
  if (collections.length === 0) {
    return <p className="explore-placeholder">No collections on this repo.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Filter lexicons…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: '1 1 16rem',
            maxWidth: '24rem',
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            outline: 'none',
          }}
        />
        {showCommonFilter && (
          <div
            role="radiogroup"
            aria-label="Filter by what you have in common"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--border-medium)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {(
              [
                { value: 'all', label: 'all' },
                { value: 'mutual', label: 'in common' },
                { value: 'notMine', label: "i don't have" },
              ] as const
            ).map(({ value, label }) => {
              const active = commonFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCommonFilter(value)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.8rem',
                    background: active ? 'var(--accent-forest)' : 'transparent',
                    color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s ease, color 0.2s ease',
                    textTransform: 'lowercase',
                    letterSpacing: '0.02em',
                    fontFamily: 'var(--font-serif)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => setAllOpen(!anyOpen)}
            aria-label={anyOpen ? 'Collapse all groups' : 'Expand all groups'}
            title={anyOpen ? 'Collapse all groups' : 'Expand all groups'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.45rem',
              marginLeft: 'auto',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-accent)';
              e.currentTarget.style.borderColor = 'var(--text-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-medium)';
            }}
          >
            {anyOpen ? (
              <ChevronsDownUp size={14} aria-hidden />
            ) : (
              <ChevronsUpDown size={14} aria-hidden />
            )}
          </button>
        )}
      </div>

      {hasAnyPinned && (
        <section
          style={{
            border: '1px solid var(--text-accent)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.55rem 1rem',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.75rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-accent)',
            }}
          >
            <Pin size={12} aria-hidden />
            Pinned
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.7rem',
                letterSpacing: '0.04em',
                color: 'var(--text-tertiary)',
                textTransform: 'none',
              }}
            >
              {pinnedCount}
            </span>
          </div>

          {/* Pinned NSID groups — collapsible, with a group-level unpin in
              the header. Their members are plain links; the group is the
              unit you pin/unpin. */}
          {pinnedGroups.map((g) => {
            const open = isOpen(pinnedKey(g.entry));
            return (
              <div
                key={g.entry}
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <GroupHeader
                  open={open}
                  onToggle={() => toggle(pinnedKey(g.entry))}
                  prefix={g.prefix}
                  count={g.items.length}
                  emphasize
                  pinnable={canPin}
                  pinned
                  onTogglePin={() => toggleGroupPin(g.prefix)}
                />
                {open && (
                  <ul
                    style={{
                      ...listStyle(),
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {g.items.map((nsid, i) => (
                      <LeafRow
                        key={nsid}
                        nsid={nsid}
                        href={`/explore/${repoSeg}/${nsid}`}
                        dimPrefix={`${g.prefix}.`}
                        baseBg={i % 2 === 0 ? 'var(--bg-primary)' : 'transparent'}
                        inCommon={myCollections?.has(nsid)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {/* Individually-pinned lexicons. */}
          {pinnedSingles.length > 0 && (
            <ul
              style={{ ...listStyle(), borderTop: '1px solid var(--border-subtle)' }}
            >
              {pinnedSingles.map((nsid, i) => (
                <LeafRow
                  key={nsid}
                  nsid={nsid}
                  href={`/explore/${repoSeg}/${nsid}`}
                  baseBg={i % 2 === 0 ? 'var(--bg-primary)' : 'transparent'}
                  inCommon={myCollections?.has(nsid)}
                  pinnable={canPin}
                  pinned
                  onTogglePin={() => togglePin(nsid)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {groups.length === 0 && !hasAnyPinned ? (
        <p className="explore-placeholder">
          {commonFilter === 'mutual' ? (
            'No collections in common with this repo.'
          ) : commonFilter === 'notMine' ? (
            'You already have every collection this repo has.'
          ) : (
            <>
              No collections match <code>{filter}</code>.
            </>
          )}
        </p>
      ) : groups.length === 0 ? null : (
        groups.map((g) => {
          const majorOpen = isOpen(g.key);
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
                pinnable={canPin}
                pinned={isGroupPinned(g.key)}
                onTogglePin={() => toggleGroupPin(g.key)}
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
                          inCommon={myCollections?.has(nsid)}
                          pinnable={canPin}
                          pinned={activePinSet.has(nsid)}
                          onTogglePin={() => togglePin(nsid)}
                        />
                      ))}
                    </ul>
                  )}
                  {/* Then collapsible sub-groups. */}
                  {g.subgroups.map((sub) => {
                    const subOpen = isOpen(sub.fullKey);
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
                          pinnable={canPin}
                          pinned={isGroupPinned(sub.fullKey)}
                          onTogglePin={() => toggleGroupPin(sub.fullKey)}
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
                                inCommon={myCollections?.has(nsid)}
                                pinnable={canPin}
                                pinned={activePinSet.has(nsid)}
                                onTogglePin={() => togglePin(nsid)}
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
  pinnable,
  pinned,
  onTogglePin,
}: {
  open: boolean;
  onToggle: () => void;
  prefix: string;
  /** Leading slice of `prefix` to render dimmed because it's inherited from a parent group. */
  dimPrefix?: string;
  count: number;
  emphasize?: boolean;
  indent?: boolean;
  /** Show the pin/unpin button that pins the whole `prefix.*` group. */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const hasDim = dimPrefix && prefix.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? prefix.slice(dimPrefix.length) : prefix;
  const groupNsid = `${prefix}${PIN_GROUP_SUFFIX}`;
  return (
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
      {pinnable && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${groupNsid}` : `Pin ${groupNsid}`}
          title={
            pinned
              ? 'Unpin this group from the explorer'
              : 'Pin this whole group to the top of the list'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 0.75rem',
            background: 'transparent',
            border: 0,
            color: pinned ? 'var(--text-accent)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = pinned
              ? 'var(--text-accent)'
              : 'var(--text-tertiary)';
          }}
        >
          {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
        </button>
      )}
    </div>
  );
}

/**
 * Open-state key for a pinned group block, namespaced so it can't collide
 * with a main-list group key of the same prefix.
 */
function pinnedKey(entry: string): string {
  return `pinned:${entry}`;
}

function LeafRow({
  nsid,
  href,
  deepIndent,
  dimPrefix,
  baseBg,
  inCommon,
  pinnable,
  pinned,
  onTogglePin,
}: {
  nsid: string;
  href: string;
  deepIndent?: boolean;
  /** Leading slice of `nsid` that's redundant given the parent group; rendered dimmed. */
  dimPrefix?: string;
  /** Resting background for zebra striping; mouseleave restores to this. */
  baseBg: string;
  /** Signed-in viewer also has records in this collection — show a marker. */
  inCommon?: boolean;
  /** Show the pin/unpin button (only when prefs say pins apply on this repo). */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const hasDim = dimPrefix && nsid.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? nsid.slice(dimPrefix.length) : nsid;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'stretch',
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
        title={inCommon ? 'You have records in this collection too' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: deepIndent
            ? '0.5rem 0.5rem 0.5rem 3rem'
            : '0.5rem 0.5rem 0.5rem 2.5rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {dim && <span style={{ color: 'var(--text-tertiary)' }}>{dim}</span>}
          {tail}
        </span>
        {inCommon && (
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.7rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-accent)',
              flexShrink: 0,
            }}
          >
            <Check size={11} aria-hidden /> you
          </span>
        )}
      </Link>
      {pinnable && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${nsid}` : `Pin ${nsid}`}
          title={pinned ? 'Unpin from explorer' : 'Pin to top of collections list'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 0.75rem',
            background: 'transparent',
            border: 0,
            color: pinned ? 'var(--text-accent)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = pinned
              ? 'var(--text-accent)'
              : 'var(--text-tertiary)';
          }}
        >
          {pinned ? (
            <PinOff size={13} aria-hidden />
          ) : (
            <Pin size={13} aria-hidden />
          )}
        </button>
      )}
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
