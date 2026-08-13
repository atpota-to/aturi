'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
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

  const getContextText = () => {
    switch (type) {
      case 'post':
        return `Open post by ${display} on...`;
      case 'profile':
        return `Open profile for ${display} on...`;
      case 'list':
        return `Open list by ${display} on...`;
      case 'record':
        return `Open record from ${display} on...`;
      default:
        return `Open content from ${display} on...`;
    }
  };

  const renderRecommendedWaypoints = () => {
    if (!recommendedWaypoints || recommendedWaypoints.length === 0) return null;

    return (
      <div className="featured-section">
        <h2 className="section-header" style={{ marginBottom: '0.75rem' }}>
          {recommendedLabel}
        </h2>
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '1rem' 
        }}>
          {recommendedWaypoints.map((waypoint, index) => {
            const url = waypoint.getUrl(handle, collection, rkey, did);
            if (!url) return null;

            const isCopied = copiedId === waypoint.id;
            
            // Organic rotation for each button
            const rotations = [0.3, -0.2, 0.4];
            const rotation = rotations[index % rotations.length];

            return (
              <div
                key={waypoint.id}
                className="waypoint-button featured-waypoint"
                onClick={(e) => handleWaypointClick(url, e)}
                style={{ 
                  cursor: 'pointer',
                  transform: `rotate(${rotation}deg)`,
                  // @ts-expect-error - CSS custom property
                  '--button-rotation': `rotate(${rotation}deg)`
                }}
              >
                <div className="waypoint-icon">{waypoint.icon}</div>
                <div className="waypoint-content">
                  <div className="waypoint-name">{waypoint.name}</div>
                  <div className="waypoint-description">
                    {typeof waypoint.description === 'function'
                      ? waypoint.description(collection, type)
                      : waypoint.description}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button
                    onClick={(e) => handleCopy(url, waypoint.id, e)}
                    aria-label="Copy link"
                    className="copy-button"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {isCopied ? (
                      <Check size={20} style={{ color: 'var(--text-accent)' }} />
                    ) : (
                      <Copy size={20} />
                    )}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open in ${waypoint.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    <ExternalLink size={20} />
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
    <div id="waypoint-picker">
      {newWaypoints.length > 0 && (
        <NewWaypointsBanner
          waypoints={newWaypoints}
          onAdd={() => update((p) => addWaypointsToDefaultGroups(p, newWaypointIds))}
          onDismiss={() => update((p) => markWaypointsKnown(p, newWaypointIds))}
        />
      )}

      {/* Header. When the layout switch follows it, the switch owns the gap
          down to the list and the header gives up most of its own. */}
      <header
        style={{
          marginBottom: hasWaypoints ? '1rem' : '2rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Choose where to view
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
          {getContextText()}
        </p>
      </header>

      {/* Layout switch. Sits above the list rather than only in settings so
          the change is visible where it happens; the choice is saved to
          preferences and follows the account. Hidden when there's no list to
          lay out. */}
      {hasWaypoints && (
        <div className="waypoint-layout-bar">
          <span className="waypoint-layout-bar-label">Layout</span>
          <WaypointLayoutToggle />
        </div>
      )}

      {/* Waypoint Options */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {!hasWaypoints ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>
              No waypoints available for this content type yet.
            </p>
          </div>
        ) : layout !== 'classic' ? (
          /* Compact layouts. Same groups in the same order as below — the
             recommended block, then every group the user has arranged — just
             drawn as lines or tiles instead of cards. */
          <div className={`waypoint-compact is-${layout}`}>
            {recommendedWaypoints.length > 0 && (
              <CompactWaypointGroup
                label={recommendedLabel}
                waypoints={recommendedWaypoints}
                layout={layout}
                type={type}
                handle={handle}
                collection={collection}
                rkey={rkey}
                did={did}
                copiedId={copiedId}
                onCopy={handleCopy}
                highlighted
              />
            )}
            {categorizedWaypoints.map(({ category, waypoints }) => (
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
        ) : (
          <>
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
                  {/* Other Waypoints Header */}
                  {recommendedWaypoints.length > 0 && (
                    <h2 className="section-header">
                      More Options
                    </h2>
                  )}

                  {/* Categorized Waypoints */}
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '1.5rem' 
                  }}>
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
      </div>

      {/* About aturi.to */}
      <div
        className="card"
        style={{
          marginTop: '3rem',
          textAlign: 'center',
        }}
      >
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          What is aturi.to?
        </h3>
        <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', marginBottom: '0.75rem', lineHeight: 1.4 }}>
          Tour the Atmosphere.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Switch between clients, share universal links, and explore any account&rsquo;s PDS data.
        </p>
        <ShareButton
          url={typeof window !== 'undefined' ? window.location.href : ''}
          label="Share this waypoint page"
        />
      </div>
    </div>
  );
}
