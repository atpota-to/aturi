'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ExternalLink, Copy, Check, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getCategorizedWaypoints,
  getRecommendedWaypoints,
  getWaypointsForType,
  WAYPOINT_DESTINATIONS,
  type WaypointType
} from '@/utils/waypoints';
import { waypointActivity } from '@/utils/waypoints.data';
import {
  personalizeCategorized,
  personalizeRecommended,
  customToWaypoint,
} from '@/utils/personalizeWaypoints';
import {
  newBuiltinWaypointIds,
  addWaypointsToDefaultGroups,
  markWaypointsKnown,
} from '@/utils/preferences';
import { usePreferences } from './PreferencesProvider';
import ShareButton from './ShareButton';
import CategoryCard from './CategoryCard';
import CompactWaypointGroup from './CompactWaypointGroup';
import WaypointLayoutToggle from './WaypointLayoutToggle';
import NewWaypointsBanner from './NewWaypointsBanner';

type WaypointPickerProps = {
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  displayName?: string;
  did?: string;
  /**
   * Collection NSIDs found in the target repo (from describeRepo). When
   * provided, waypoints whose `expectedCollections` match none of these are
   * hidden — e.g. the Tangled waypoint won't show for an account with no
   * `sh.tangled.*` records. `null`/`undefined` (scan failed or not run, as on
   * record pages) leaves every waypoint visible. Generic tools that declare no
   * `expectedCollections` (PDSls, atp.tools, Aturi Explore…) are never hidden.
   */
  repoCollections?: string[] | null;
};

export default function WaypointPicker({
  type,
  handle,
  collection,
  rkey,
  displayName,
  did,
  repoCollections,
}: WaypointPickerProps) {
  const display = displayName || `@${handle}`;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { prefs, update } = usePreferences();
  // `dense` and `grid` are drawn by CompactWaypointGroup; `classic` keeps the
  // CategoryCard path below, collapsible headers and all.
  const layout = prefs.waypointLayout;

  // Set of collection NSIDs the target repo holds. `null` means "no opinion"
  // (scan failed/not run) — `waypointActivity` returns 'unknown' for everything
  // and nothing gets hidden. An empty array is a real answer (repo with no
  // collections), so only a nullish prop short-circuits to null.
  const repoCollectionSet = useMemo(
    () => (repoCollections ? new Set(repoCollections) : null),
    [repoCollections],
  );

  // Keep a waypoint unless we've positively confirmed the repo has no records
  // for it. 'present' and 'unknown' both pass; only 'absent' is filtered out.
  const isActiveForRepo = useCallback(
    (waypoint: { expectedCollections?: string[] }) =>
      waypointActivity(waypoint, repoCollectionSet) !== 'absent',
    [repoCollectionSet],
  );

  // Built-in waypoints that have shipped since the user last acknowledged the
  // catalog. Surfaced as a dismissable banner with one-click add.
  const newWaypointIds = useMemo(() => newBuiltinWaypointIds(prefs), [prefs]);
  const newWaypoints = useMemo(
    () => newWaypointIds.map((id) => WAYPOINT_DESTINATIONS[id]).filter(Boolean),
    [newWaypointIds],
  );

  // Get categorized waypoints and featured waypoint, with user prefs applied
  // (hidden built-ins removed, custom waypoints added as their own group,
  // user-defined ordering respected within each category).
  const categorizedWaypoints = useMemo(
    () =>
      personalizeCategorized(getCategorizedWaypoints(type), prefs, type).map(
        ({ category, waypoints }) => ({
          category,
          waypoints: waypoints.filter(isActiveForRepo),
        }),
      ),
    [type, prefs, isActiveForRepo],
  );
  const recommendedData = useMemo(
    () => getRecommendedWaypoints(type, collection),
    [type, collection]
  );
  const recommendedWaypoints = useMemo(
    () =>
      personalizeRecommended(recommendedData?.waypoints || [], prefs).filter(
        isActiveForRepo,
      ),
    [recommendedData, prefs, isActiveForRepo]
  );
  const recommendedLabel = useMemo(
    () => recommendedData?.label || '',
    [recommendedData]
  );
  // Flat list of every waypoint the user has surfaced (in any group),
  // scoped to the current record type. Used by the smart-expansion
  // heuristic below to decide which categories open by default.
  const availableWaypoints = useMemo(() => {
    const visible = new Set<string>();
    for (const g of prefs.waypointGroups) {
      for (const id of g.waypointIds) visible.add(id);
    }
    const out: typeof categorizedWaypoints[number]['waypoints'] = [];
    const customById = new Map(prefs.customWaypoints.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const id of visible) {
      if (seen.has(id)) continue;
      seen.add(id);
      const custom = customById.get(id);
      if (custom) {
        if (custom.supportedTypes.includes(type)) {
          out.push(customToWaypoint(custom));
        }
        continue;
      }
      const builtin = getWaypointsForType(type).find((w) => w.id === id);
      if (builtin) out.push(builtin);
    }
    return out.filter(isActiveForRepo);
  }, [type, prefs, isActiveForRepo]);

  const hasWaypoints = availableWaypoints.length > 0;

  // Smart expansion: Compute initial expanded categories based on compatible waypoints
  const initialExpandedCategories = useMemo(() => {
    const initialExpanded = new Set<string>();
    
    // Check each category to see if it contains compatible waypoints
    for (const { category, waypoints } of categorizedWaypoints) {
      // Check if any waypoint in this category can handle the current content
      const hasCompatible = waypoints.some(waypoint => {
        const url = waypoint.getUrl(handle, collection, rkey, did);
        return url !== null;
      });
      
      if (hasCompatible) {
        initialExpanded.add(category.id);
      }
      
      // Also check subcategories and auto-expand them
      if (category.subcategories) {
        for (const subcategory of category.subcategories) {
          // Get waypoints for this subcategory
          const subcatWaypoints = availableWaypoints.filter(w => w.category === subcategory.id);
          const hasSubcatCompatible = subcatWaypoints.some(waypoint => {
            const url = waypoint.getUrl(handle, collection, rkey, did);
            return url !== null;
          });
          
          if (hasSubcatCompatible) {
            // Expand both parent and subcategory
            initialExpanded.add(category.id);
            initialExpanded.add(subcategory.id);
          }
        }
      }
    }
    
    return initialExpanded;
  }, [categorizedWaypoints, availableWaypoints, handle, collection, rkey, did]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(initialExpandedCategories);

  // Update expanded categories when the initial computation changes
  useEffect(() => {
    setExpandedCategories(initialExpandedCategories);
  }, [initialExpandedCategories]);

  const handleCopy = async (url: string, waypointId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(waypointId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleWaypointClick = (url: string, e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'A'
    ) {
      return;
    }
    // Open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // "Open @alice.test's profile in…", plus a one-line subhead saying what
  // every option has in common.
  const getContextText = () => {
    switch (type) {
      case 'post':
        return `Open ${display}’s post in…`;
      case 'profile':
        return `Open ${display}’s profile in…`;
      case 'list':
        return `Open ${display}’s list in…`;
      case 'record':
        return `Open this record from ${display} in…`;
      default:
        return `Open content from ${display} in…`;
    }
  };

  const getSubheadText = () => {
    switch (type) {
      case 'post':
        return 'Pick an app. They all show the same post.';
      case 'profile':
        return 'Pick an app. They all show the same account.';
      case 'list':
        return 'Pick an app. They all show the same list.';
      default:
        return 'Pick an app. They all read the same record.';
    }
  };

  const describe = (waypoint: (typeof recommendedWaypoints)[number]) =>
    typeof waypoint.description === 'function'
      ? waypoint.description(collection, type)
      : waypoint.description;

  // Compact layouts: groups that have at least one waypoint able to open this
  // content. All of them show by default, as they always have; the "Show
  // fewer" disclosure folds the list down to the first group, and its
  // collapsed label counts every distinct app across them.
  const compactGroups = useMemo(
    () =>
      categorizedWaypoints.filter(({ waypoints }) =>
        waypoints.some((w) => w.getUrl(handle, collection, rkey, did) !== null),
      ),
    [categorizedWaypoints, handle, collection, rkey, did],
  );
  const compactAppCount = useMemo(() => {
    const ids = new Set<string>();
    for (const { waypoints } of compactGroups) {
      for (const w of waypoints) {
        if (w.getUrl(handle, collection, rkey, did) !== null) ids.add(w.id);
      }
    }
    return ids.size;
  }, [compactGroups, handle, collection, rkey, did]);
  const [showAllGroups, setShowAllGroups] = useState(true);
  const visibleGroups = showAllGroups ? compactGroups : compactGroups.slice(0, 1);

  /**
   * The recommended waypoints as large rows: the first is the solid primary
   * choice, the rest are outlined. Rows are real anchors (cmd-click and
   * keyboard work natively); the copy button sits beside the anchor, not in
   * it, so neither swallows the other's click.
   */
  const renderRecommendedRows = () => {
    const rows = recommendedWaypoints
      .map((waypoint) => ({ waypoint, url: waypoint.getUrl(handle, collection, rkey, did) }))
      .filter((r): r is { waypoint: typeof r.waypoint; url: string } => r.url !== null);
    if (rows.length === 0) return null;

    return (
      <section className="fn-lp-recommended" aria-label={recommendedLabel || 'Recommended'}>
        {rows.map(({ waypoint, url }, index) => {
          const isCopied = copiedId === waypoint.id;
          return (
            <div
              key={waypoint.id}
              className={`fn-lp-hero${index === 0 ? ' is-primary' : ''}`}
            >
              <a
                className="fn-lp-hero-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={describe(waypoint)}
              >
                <span className="fn-lp-hero-icon" aria-hidden="true">{waypoint.icon}</span>
                <span className="fn-lp-hero-text">
                  <span className="fn-lp-hero-name">{waypoint.name}</span>
                  <span className="fn-lp-hero-sub">Recommended</span>
                </span>
                <ArrowRight className="fn-lp-hero-arrow" size={18} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="fn-lp-hero-copy"
                aria-label={`Copy ${waypoint.name} link`}
                onClick={(e) => handleCopy(url, waypoint.id, e)}
              >
                {isCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          );
        })}
      </section>
    );
  };

  const renderRecommendedWaypoints = () => {
    if (!recommendedWaypoints || recommendedWaypoints.length === 0) return null;

    return (
      <div className="featured-section">
        <h2 className="section-header">{recommendedLabel}</h2>
        <div className="fn-lp-stack">
          {recommendedWaypoints.map((waypoint) => {
            const url = waypoint.getUrl(handle, collection, rkey, did);
            if (!url) return null;

            const isCopied = copiedId === waypoint.id;

            return (
              <div
                key={waypoint.id}
                className="waypoint-button featured-waypoint"
                onClick={(e) => handleWaypointClick(url, e)}
                style={{ cursor: 'pointer' }}
              >
                <div className="waypoint-icon">{waypoint.icon}</div>
                <div className="waypoint-content">
                  <div className="waypoint-name">{waypoint.name}</div>
                  <div className="waypoint-description">{describe(waypoint)}</div>
                </div>
                <div className="waypoint-button-actions">
                  <button
                    onClick={(e) => handleCopy(url, waypoint.id, e)}
                    aria-label="Copy link"
                    className="copy-button"
                  >
                    {isCopied ? (
                      <Check size={18} style={{ color: 'var(--text-accent)' }} />
                    ) : (
                      <Copy size={18} />
                    )}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open in ${waypoint.name}`}
                    className="waypoint-open-link"
                  >
                    <ExternalLink size={18} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div id="waypoint-picker" className="fn-lp-picker">
      {newWaypoints.length > 0 && (
        <NewWaypointsBanner
          waypoints={newWaypoints}
          onAdd={() => update((p) => addWaypointsToDefaultGroups(p, newWaypointIds))}
          onDismiss={() => update((p) => markWaypointsKnown(p, newWaypointIds))}
        />
      )}

      <header className="fn-lp-head">
        <h1>{getContextText()}</h1>
        <p>{getSubheadText()}</p>
      </header>

      {!hasWaypoints ? (
        <div className="card fn-lp-empty">
          <p>No waypoints available for this content type yet.</p>
        </div>
      ) : layout !== 'classic' ? (
        <>
          {renderRecommendedRows()}

          {/* Layout switch. Sits beside the list rather than only in settings
              so the change is visible where it happens; the choice is saved to
              preferences and follows the account. */}
          <div className="waypoint-layout-bar">
            <span className="waypoint-layout-bar-label">Layout</span>
            <WaypointLayoutToggle />
          </div>

          {/* Every group the user has arranged, drawn as rows or tiles. */}
          <div className={`waypoint-compact is-${layout}`} id="waypoint-groups">
            {visibleGroups.map(({ category, waypoints }) => (
              <CompactWaypointGroup
                key={category.id}
                label={category.name}
                waypoints={waypoints}
                layout={layout}
                type={type}
                handle={handle}
                collection={collection}
                rkey={rkey}
                did={did}
                copiedId={copiedId}
                onCopy={handleCopy}
              />
            ))}
          </div>

          {compactGroups.length > 1 && (
            <button
              type="button"
              className="fn-lp-see-all"
              aria-expanded={showAllGroups}
              aria-controls="waypoint-groups"
              onClick={() => setShowAllGroups((v) => !v)}
            >
              {showAllGroups ? 'Show fewer apps' : `See all ${compactAppCount} apps`}
              {showAllGroups ? (
                <ChevronUp size={15} aria-hidden="true" />
              ) : (
                <ChevronDown size={15} aria-hidden="true" />
              )}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="waypoint-layout-bar">
            <span className="waypoint-layout-bar-label">Layout</span>
            <WaypointLayoutToggle />
          </div>

          {/* Recommended Waypoints */}
          {renderRecommendedWaypoints()}

          {/* More Options Section */}
          {(() => {
            // Filter categories to only show those with at least one compatible waypoint
            const filteredCategories = categorizedWaypoints
              .map(({ category, waypoints }) => {
                // Check if any waypoints are compatible (don't filter by recommended status)
                const compatibleWaypoints = waypoints.filter(waypoint => {
                  const url = waypoint.getUrl(handle, collection, rkey, did);
                  return url !== null;
                });

                // Prepare subcategories data if they exist
                const subcategoriesData = category.subcategories?.map(subcat => {
                  const subcatWaypoints = availableWaypoints
                    .filter(w => w.category === subcat.id);

                  const compatibleSubcatWaypoints = subcatWaypoints.filter(waypoint => {
                    const url = waypoint.getUrl(handle, collection, rkey, did);
                    return url !== null;
                  });

                  return {
                    category: subcat,
                    waypoints: subcatWaypoints,
                    compatibleCount: compatibleSubcatWaypoints.length,
                    isExpanded: expandedCategories.has(subcat.id),
                    onToggle: () => toggleCategory(subcat.id),
                  };
                }).filter(sub => sub.compatibleCount > 0);

                // Calculate total compatible waypoints (category + subcategories)
                const totalCompatible = compatibleWaypoints.length +
                  (subcategoriesData?.reduce((sum, sub) => sum + sub.compatibleCount, 0) || 0);

                return {
                  category,
                  waypoints, // Keep all waypoints, not just non-recommended ones
                  subcategoriesData,
                  hasCompatible: totalCompatible > 0,
                };
              })
              .filter(data => data.hasCompatible);

            // Only show "More Options" section if there are categories to display
            if (filteredCategories.length === 0) {
              return null;
            }

            return (
              <div className="more-options-section">
                {recommendedWaypoints.length > 0 && (
                  <h2 className="section-header">More options</h2>
                )}

                <div className="fn-lp-stack">
                  {filteredCategories.map(({ category, waypoints, subcategoriesData }) => (
                    <CategoryCard
                      key={category.id}
                      category={category}
                      waypoints={waypoints}
                      isExpanded={expandedCategories.has(category.id)}
                      onToggle={() => toggleCategory(category.id)}
                      handle={handle}
                      collection={collection}
                      rkey={rkey}
                      did={did}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                      onWaypointClick={handleWaypointClick}
                      subcategories={subcategoriesData}
                      alwaysShowCategoryHeader={true}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* About aturi.to */}
      <section className="card fn-lp-about" aria-labelledby="fn-lp-about-title">
        <div>
          <h3 id="fn-lp-about-title">What is aturi.to?</h3>
          <p>
            Tour the Atmosphere. Switch between clients, share universal links,
            and explore any account&rsquo;s PDS data.
          </p>
        </div>
        <ShareButton
          url={typeof window !== 'undefined' ? window.location.href : ''}
          label="Share this waypoint page"
        />
      </section>

      {/* Remember-my-choice bar. Opening links automatically is the existing
          auto-redirect preference (favourite app per kind of link), which
          lives in account settings; this bar states whether it's on and
          links there rather than setting anything itself. */}
      <div className="fn-lp-remember" role="region" aria-label="Remember my choice">
        <div className="fn-lp-remember-text">
          <span className="fn-lp-remember-title">
            {prefs.autoRedirect ? 'Auto-redirect is on' : 'Remember my choice'}
          </span>
          <span className="fn-lp-remember-sub">
            {prefs.autoRedirect
              ? 'Links like this open in your favorite app right away.'
              : 'Pick a favorite app and links like this open there right away.'}
          </span>
        </div>
        <Link href="/account#redirects" className="fn-lp-btn fn-lp-remember-action">
          {prefs.autoRedirect ? 'Change' : 'Set up'}
        </Link>
      </div>
    </div>
  );
}
