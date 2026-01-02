'use client';

import { useState } from 'react';
import { ExternalLink, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
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
  onWaypointClick: (url: string, e: React.MouseEvent) => void;
  subcategories?: Array<{
    category: WaypointCategory;
    waypoints: Waypoint[];
    isExpanded: boolean;
    onToggle: () => void;
  }>;
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
  onWaypointClick,
  subcategories,
}: CategoryCardProps) {
  // Safety check: if no waypoints, don't render anything
  if (!waypoints || waypoints.length === 0) {
    return null;
  }
  
  const defaultWaypoint = waypoints.find(w => w.id === category.defaultWaypointId) || waypoints[0];
  
  // Additional safety check: ensure default waypoint is actually compatible
  const compatibleDefaultWaypoint = defaultWaypoint?.getUrl?.(handle, collection, rkey, did) 
    ? defaultWaypoint 
    : waypoints.find(w => w.getUrl(handle, collection, rkey, did) !== null);
  
  const hasMultiple = waypoints.length > 1;
  const hasSubcategories = subcategories && subcategories.length > 0;

  const renderWaypointCard = (waypoint: Waypoint, index: number) => {
    const url = waypoint.getUrl(handle, collection, rkey, did);
    if (!url) return null;
    
    const isCopied = copiedId === waypoint.id;
    
    // Organic rotation for each button
    const rotations = [0.3, -0.2, 0.4, -0.3, 0.2, -0.1, 0.35, -0.25];
    const rotation = rotations[index % rotations.length];

    return (
      <div
        key={waypoint.id}
        className="waypoint-button"
        onClick={(e) => onWaypointClick(url, e)}
        style={{ 
          cursor: 'pointer', 
          transform: `rotate(${rotation}deg)`,
          // @ts-ignore - CSS custom property
          '--button-rotation': `rotate(${rotation}deg)`
        }}
      >
        <div className="waypoint-icon">{waypoint.icon}</div>
        <div className="waypoint-content">
          <div className="waypoint-name">{waypoint.name}</div>
          <div className="waypoint-description">
            {waypoint.description}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={(e) => onCopy(url, waypoint.id, e)}
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
  };

  if (!hasMultiple) {
    // Single waypoint - render it directly without category wrapper
    return renderWaypointCard(waypoints[0], 0);
  }

  return (
    <div className="category-section">
      {/* Category Header */}
      <div className="category-header" onClick={onToggle}>
        <div className="category-title">
          <h3>{category.name}</h3>
          {category.description && (
            <p className="category-description">{category.description}</p>
          )}
        </div>
        <div className="category-controls">
          {!isExpanded && (
            <span className="expand-indicator">
              +{waypoints.length - 1} more
            </span>
          )}
          <button
            className="expand-button"
            aria-label={isExpanded ? 'Collapse category' : 'Expand category'}
            aria-expanded={isExpanded}
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
            {renderWaypointCard(compatibleDefaultWaypoint, 0)}
          </div>
        )}
        {isExpanded && (
          // Expanded: Show all waypoints with stagger
          <div className="waypoint-list">
            {waypoints.map((waypoint, index) => (
              <div
                key={waypoint.id}
                className="waypoint-item"
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                {renderWaypointCard(waypoint, index)}
              </div>
            ))}

            {/* Render subcategories if they exist */}
            {hasSubcategories && (
              <div className="subcategories" style={{ marginTop: '1rem' }}>
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
                    onWaypointClick={onWaypointClick}
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

