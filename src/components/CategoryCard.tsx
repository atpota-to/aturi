'use client';

import { ArrowRight, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { WaypointCategory, Waypoint } from '@/utils/waypoints';

type CategoryCardProps = {
  category: WaypointCategory;
  waypoints: Waypoint[];
  isExpanded: boolean;
  onToggle: () => void;
  handle: string;
  collection?: string;
  rkey?: string;
  did?: string;
  copiedId: string | null;
  onCopy: (url: string, waypointId: string, e: React.MouseEvent) => void;
  subcategories?: Array<{
    category: WaypointCategory;
    waypoints: Waypoint[];
    isExpanded: boolean;
    onToggle: () => void;
  }>;
  alwaysShowCategoryHeader?: boolean;
};

export default function CategoryCard({
  category,
  waypoints,
  isExpanded,
  onToggle,
  handle,
  collection,
  rkey,
  did,
  copiedId,
  onCopy,
  subcategories,
  alwaysShowCategoryHeader = false,
}: CategoryCardProps) {
  const hasSubcategories = subcategories && subcategories.length > 0;
  
  // Safety check: if no waypoints AND no subcategories, don't render anything
  if ((!waypoints || waypoints.length === 0) && !hasSubcategories) {
    return null;
  }
  
  // If we have waypoints, find the default one
  const defaultWaypoint = waypoints && waypoints.length > 0 
    ? (waypoints.find(w => w.id === category.defaultWaypointId) || waypoints[0])
    : null;
  
  // Additional safety check: ensure default waypoint is actually compatible
  const compatibleDefaultWaypoint = defaultWaypoint && defaultWaypoint.getUrl?.(handle, collection, rkey, did) 
    ? defaultWaypoint 
    : waypoints?.find(w => w.getUrl(handle, collection, rkey, did) !== null);
  
  const hasMultiple = waypoints && waypoints.length > 1;
  const hasWaypoints = waypoints && waypoints.length > 0;

  const renderWaypointCard = (waypoint: Waypoint) => {
    const url = waypoint.getUrl(handle, collection, rkey, did);
    if (!url) return null;
    
    const isCopied = copiedId === waypoint.id;
    
    // The card is one link: the arrow anchor's ::after is stretched over
    // the card (link.css), so the whole card opens the app with one tab
    // stop and one announcement, and the copy button sits above it. A
    // div-button wrapper around the same anchor cost three stops a card.
    return (
      <div key={waypoint.id} className="waypoint-button">
        <div className="waypoint-icon">{waypoint.icon}</div>
        <div className="waypoint-content">
          <div className="waypoint-name">{waypoint.name}</div>
          <div className="waypoint-description">
            {typeof waypoint.description === 'function'
              ? waypoint.description(collection, undefined)
              : waypoint.description}
          </div>
        </div>
        {/* Open, then copy, with the same arrow as the Compact and Grid
            rows: the layouts are views of one list, so a row's actions
            shouldn't swap places or glyphs when the view changes. */}
        <div className="waypoint-button-actions">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open in ${waypoint.name}`}
            onClick={(e) => e.stopPropagation()}
            className="waypoint-open-link"
          >
            <ArrowRight size={18} />
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onCopy(url, waypoint.id, e); }}
            aria-label={`Copy ${waypoint.name} link`}
            className="copy-button"
          >
            {isCopied ? (
              <Check size={18} style={{ color: 'var(--text-accent)' }} />
            ) : (
              <Copy size={18} />
            )}
          </button>
        </div>
      </div>
    );
  };

  // The header carries the count the compact layouts show: how many of the
  // group's apps can open this record.
  const compatibleCount = (waypoints ?? []).filter(
    (w) => w.getUrl(handle, collection, rkey, did) !== null,
  ).length;

  if (!alwaysShowCategoryHeader && !hasMultiple && !hasSubcategories && hasWaypoints) {
    // Single waypoint with no subcategories - render it directly without category wrapper
    return renderWaypointCard(waypoints![0]);
  }

  return (
    <div className="category-section">
      {/* Category Header — the whole bar stays mouse-clickable, but the
          expand button carries the real toggle so it's keyboard-reachable
          and announces its state. stopPropagation prevents a double toggle
          when the button itself is clicked. */}
      <div className="category-header" onClick={onToggle}>
        <div className="category-title">
          <h3>
            {category.name}
            {compatibleCount > 0 && (
              <em aria-label={`${compatibleCount} apps`}>{compatibleCount}</em>
            )}
          </h3>
          {category.description && (
            <p className="category-description">{category.description}</p>
          )}
        </div>
        <div className="category-controls">
          {!isExpanded && hasWaypoints && (
            <span className="expand-indicator">
              +{(waypoints?.length || 0) + (subcategories?.length || 0) - 1} more
            </span>
          )}
          <button
            className="expand-button"
            aria-label={isExpanded ? 'Collapse category' : 'Expand category'}
            aria-expanded={isExpanded}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
      </div>

      {/* Waypoint Cards */}
      <div className={`waypoint-stack ${isExpanded ? 'expanded' : 'collapsed'}`}>
        {!isExpanded && compatibleDefaultWaypoint && (
          // Collapsed: Show only default with stacked effect
          <div className="stacked-cards">
            {renderWaypointCard(compatibleDefaultWaypoint)}
          </div>
        )}
        {isExpanded && (
          // Expanded: Show all waypoints with stagger
          <div className="waypoint-list">
            {hasWaypoints && waypoints!
              .filter((waypoint) => waypoint.getUrl(handle, collection, rkey, did) !== null)
              .map((waypoint, index) => (
                <div
                  key={waypoint.id}
                  className="waypoint-item"
                  style={{
                    animationDelay: `${index * 50}ms`,
                  }}
                >
                  {renderWaypointCard(waypoint)}
                </div>
              ))}

            {/* Render subcategories if they exist */}
            {hasSubcategories && (
              <div className="subcategories" style={{ marginTop: hasWaypoints ? '1rem' : '0' }}>
                {subcategories.map((subcat) => (
                  <CategoryCard
                    key={subcat.category.id}
                    category={subcat.category}
                    waypoints={subcat.waypoints}
                    isExpanded={subcat.isExpanded}
                    onToggle={subcat.onToggle}
                    handle={handle}
                    collection={collection}
                    rkey={rkey}
                    did={did}
                    copiedId={copiedId}
                    onCopy={onCopy}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

