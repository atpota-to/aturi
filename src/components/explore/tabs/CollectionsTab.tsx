'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Pin, Search } from 'lucide-react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo } from '@/utils/atproto/urls';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { CollectionsTabSkeleton } from '../skeletons/pages';
import { useMyCollections } from '../useRepoCollections';
import { useMediaQuery } from '../useIsNarrow';
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
import { groupHierarchically, pinnedKey } from './collectionGrouping';
import { CHROME_RESULTS_ID, useChromeBarField, type ChromeBarField } from '../ChromeBarContext';
import GroupHeader from './GroupHeader';
import LeafRow from './LeafRow';

export default function CollectionsTab({
  identity,
  variant = 'page',
  current,
}: {
  identity: IdentityBundle;
  /**
   * `page` is the repo page's Collections tab. `sidebar` is the compact tree
   * beside a collection's records: it leaves the bottom chrome bar to the
   * record search and drops the pin buttons (pinning lives on the repo page).
   */
  variant?: 'page' | 'sidebar';
  /** The collection being viewed, highlighted in the tree. */
  current?: string;
}) {
  const sidebar = variant === 'sidebar';
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
  const canPin = !sidebar;
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

  // On a phone the tree starts folded whatever the preference says: open,
  // 179 collections make a page some 12,000px tall with nothing to hold on
  // to. Taps and the expand-all button still open groups (openOverrides),
  // a preference of "collapsed" is still honoured, and the server snapshot
  // is false, so wider layouts render exactly as before.
  const isPhone = useMediaQuery('(max-width: 640px)');
  const defaultOpen = !prefs.collectionGroupsCollapsedByDefault && !isPhone;
  // In the sidebar, beside a collection's records, only the groups on the
  // way to that collection start open: the tree is there to say where you
  // are, and 39 open namespaces said nothing. `prefix` is the dotted
  // namespace a key stands for (a pinned group's key is not its prefix).
  function isOpen(key: string, prefix = key): boolean {
    return (
      openOverrides[key] ??
      (sidebar && current ? current.startsWith(`${prefix}.`) : defaultOpen)
    );
  }
  function toggle(key: string, prefix = key) {
    setOpenOverrides((prev) => ({ ...prev, [key]: !isOpen(key, prefix) }));
  }

  // The sidebar's tree is its own scroller on wide screens; bring the row
  // for the current collection into it. The scroller alone moves, never the
  // window (scrollIntoView would also scroll the page on a phone).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    const row = scroller?.querySelector<HTMLElement>('.fx-row[data-current]');
    if (!sidebar || !scroller || !row || scroller.scrollHeight <= scroller.clientHeight) return;
    scroller.scrollTop =
      row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  }, [sidebar, current, collections]);

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

  // Mirror the filter into the bottom chrome bar, which takes it over on
  // phones (where the in-page field steps aside) — same state, so either
  // copy moves both. Wider screens keep the in-page field and the bar shows
  // its jump search (`inPage`). Registered from here rather than from <RepoExplorer> because
  // only this tab has lexicons to narrow; switching to ID / Log / Backlinks
  // unmounts it and the bar falls back to its jump search.
  const shownCount =
    pinnedCount + groups.reduce((acc, g) => acc + g.totalCount, 0);
  const narrowed = filter.trim() !== '' || commonFilter !== 'all';
  const chromeField: ChromeBarField = {
    placeholder: 'Filter collections…',
    label: 'Filter lexicons on this repo',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    inPage: true,
    status: !collections
      ? null
      : narrowed
        ? `${shownCount}/${collections.length}`
        : `${collections.length}`,
  };
  // The sidebar copy never registers: the collection page's bar belongs to
  // its record search, and a second registration would clobber it.
  const bridge = sidebar ? null : <ChromeFieldBridge field={chromeField} />;

  // An inactive repo fails this read by design, and the status banner at the
  // top of the page has already explained why. Repeating the PDS's 400 here as
  // a red error reads as a bug in the explorer, so the tab states the reason
  // and keeps the raw response one click away for anyone debugging.
  if (error && identity.repoStatus) {
    return (
      <>{bridge}<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p className="explore-placeholder">
          No collections to list: this repo is{' '}
          {identity.repoStatus.status || 'inactive'} and its PDS refuses record reads.
        </p>
        <details className="explore-raw-details">
          <summary>Raw response</summary>
          <pre className="explore-json">{error}</pre>
        </details>
      </div></>
    );
  }
  if (error) return <>{bridge}<p className="explore-error">{error}</p></>;
  if (!collections) return <>{bridge}<CollectionsTabSkeleton sidebar={sidebar} /></>;
  if (collections.length === 0) {
    return <>{bridge}<p className="explore-placeholder">No collections on this repo.</p></>;
  }

  const leafHref = (nsid: string) => `/explore/${repoSeg}/${nsid}`;

  return (
    <>
      {bridge}
      <div
        id={sidebar ? undefined : CHROME_RESULTS_ID}
        className="fx-tree-pane"
        style={{ display: 'flex', flexDirection: 'column', gap: sidebar ? 0 : '12px' }}
      >
        <div className="fx-tree-tools">
          <label className="fx-field">
            <Search size={14} aria-hidden />
            <span className="fx-sr">Filter collections</span>
            <input
              type="text"
              placeholder={`Filter ${collections.length} collection${collections.length === 1 ? '' : 's'}`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {narrowed && (
              <span className="fx-field-status">
                {shownCount}/{collections.length}
              </span>
            )}
          </label>
          {/* Phone only: the field above is hidden there (the bottom bar
              carries it), so the row says what it's listing instead. */}
          <span className="fx-tree-count" aria-hidden>
            {narrowed ? `${shownCount} of ${collections.length}` : collections.length} collection
            {collections.length === 1 ? '' : 's'}
          </span>
          {showCommonFilter && (
            <div
              role="radiogroup"
              aria-label="Filter by what you have in common"
              style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px' }}
            >
              {(
                [
                  { value: 'all', label: 'All' },
                  { value: 'mutual', label: 'In common' },
                  { value: 'notMine', label: "I don't have" },
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
                    className="fx-chip"
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
              className="fx-btn fx-btn-icon"
            >
              {anyOpen ? (
                <ChevronsDownUp size={14} aria-hidden />
              ) : (
                <ChevronsUpDown size={14} aria-hidden />
              )}
            </button>
          )}
        </div>

        <div className="fx-tree-scroll" ref={scrollRef}>
          {hasAnyPinned && (
            <section className="fx-tree-pinned" aria-label="Pinned collections">
              <div className="fx-tree-label">
                <Pin size={12} aria-hidden />
                Pinned
                <span>{pinnedCount}</span>
              </div>

              {/* Pinned NSID groups — collapsible, with a group-level unpin
                  in the header. Their members are plain links; the group is
                  the unit you pin/unpin. */}
              {pinnedGroups.map((g) => {
                const open = isOpen(pinnedKey(g.entry), g.prefix);
                return (
                  <div key={g.entry} className="fx-tree-block">
                    <GroupHeader
                      open={open}
                      onToggle={() => toggle(pinnedKey(g.entry), g.prefix)}
                      prefix={g.prefix}
                      count={g.items.length}
                      emphasize
                      pinnable={canPin}
                      pinned
                      onTogglePin={() => toggleGroupPin(g.prefix)}
                    />
                    {open && (
                      <ul style={listStyle()}>
                        {g.items.map((nsid) => (
                          <LeafRow
                            key={nsid}
                            nsid={nsid}
                            href={leafHref(nsid)}
                            dimPrefix={`${g.prefix}.`}
                            inCommon={myCollections?.has(nsid)}
                            current={nsid === current}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              {/* Individually-pinned lexicons. */}
              {pinnedSingles.length > 0 && (
                <ul style={listStyle()}>
                  {pinnedSingles.map((nsid) => (
                    <LeafRow
                      key={nsid}
                      nsid={nsid}
                      href={leafHref(nsid)}
                      flat
                      inCommon={myCollections?.has(nsid)}
                      pinnable={canPin}
                      pinned
                      onTogglePin={() => togglePin(nsid)}
                      current={nsid === current}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          {groups.length === 0 && !hasAnyPinned ? (
            <p className="fx-empty">
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
            <div className="fx-tree">
              {groups.map((g) => {
                const majorOpen = isOpen(g.key);
                return (
                  <section key={g.key} className="fx-tree-block">
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
                      <div>
                        {/* Direct leaves (3-segment NSIDs) come first. */}
                        {g.directItems.length > 0 && (
                          <ul style={listStyle()}>
                            {g.directItems.map((nsid) => (
                              <LeafRow
                                key={nsid}
                                nsid={nsid}
                                href={leafHref(nsid)}
                                dimPrefix={`${g.key}.`}
                                inCommon={myCollections?.has(nsid)}
                                pinnable={canPin}
                                pinned={activePinSet.has(nsid)}
                                onTogglePin={() => togglePin(nsid)}
                                current={nsid === current}
                              />
                            ))}
                          </ul>
                        )}
                        {/* Then collapsible sub-groups. */}
                        {g.subgroups.map((sub) => {
                          const subOpen = isOpen(sub.fullKey);
                          return (
                            <div key={sub.fullKey}>
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
                                <ul style={listStyle()}>
                                  {sub.items.map((nsid) => (
                                    <LeafRow
                                      key={nsid}
                                      nsid={nsid}
                                      href={leafHref(nsid)}
                                      deepIndent
                                      dimPrefix={`${sub.fullKey}.`}
                                      inCommon={myCollections?.has(nsid)}
                                      pinnable={canPin}
                                      pinned={activePinSet.has(nsid)}
                                      onTogglePin={() => togglePin(nsid)}
                                      current={nsid === current}
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
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Mirrors the filter into the bottom chrome bar so it stays reachable once the
 * in-page field has scrolled away — same state, so typing in either moves
 * both. A component rather than a call in <CollectionsTab> so the sidebar copy
 * can leave the bar alone: the hook clears the bar when passed null, which
 * would wipe the record search the collection page publishes.
 */
function ChromeFieldBridge({ field }: { field: ChromeBarField }) {
  useChromeBarField(field);
  return null;
}

function listStyle(): React.CSSProperties {
  return {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  };
}
