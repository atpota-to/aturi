'use client';

import { useState, useMemo, useEffect } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { 
  getCategorizedWaypoints, 
  getFeaturedWaypoint,
  getWaypointsForType,
  type WaypointType 
} from '@/utils/waypoints';
import ShareButton from './ShareButton';
import CategoryCard from './CategoryCard';

type WaypointPickerProps = {
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  displayName?: string;
  did?: string;
};

export default function WaypointPicker({
  type,
  handle,
  collection,
  rkey,
  displayName,
  did,
}: WaypointPickerProps) {
  const display = displayName || `@${handle}`;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Get categorized waypoints and featured waypoint
  const categorizedWaypoints = useMemo(() => getCategorizedWaypoints(type), [type]);
  const featuredWaypoint = useMemo(() => getFeaturedWaypoint(type, collection), [type, collection]);
  const availableWaypoints = useMemo(() => getWaypointsForType(type), [type]);

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

  const renderFeaturedWaypoint = () => {
    if (!featuredWaypoint) return null;
    
    const url = featuredWaypoint.getUrl(handle, collection, rkey, did);
    if (!url) return null;

    const isCopied = copiedId === featuredWaypoint.id;

    return (
      <div className="featured-section">
        <h2 style={{ 
          fontSize: '0.875rem', 
          textTransform: 'uppercase', 
          letterSpacing: '0.1em',
          color: 'var(--text-tertiary)',
          marginBottom: '0.75rem',
          fontWeight: 500,
        }}>
          Recommended
        </h2>
        <div
          className="waypoint-button featured-waypoint"
          onClick={(e) => handleWaypointClick(url, e)}
          style={{ 
            cursor: 'pointer',
          }}
        >
          <div className="waypoint-icon">{featuredWaypoint.icon}</div>
          <div className="waypoint-content">
            <div className="waypoint-name">{featuredWaypoint.name}</div>
            <div className="waypoint-description">
              {featuredWaypoint.description}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={(e) => handleCopy(url, featuredWaypoint.id, e)}
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
              aria-label={`Open in ${featuredWaypoint.name}`}
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
      </div>
    );
  };

  return (
    <div id="waypoint-picker">
      {/* Header */}
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Choose where to view
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
          {getContextText()}
        </p>
      </header>

      {/* Waypoint Options */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {availableWaypoints.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>
              No waypoints available for this content type yet.
            </p>
          </div>
        ) : (
          <>
            {/* Featured Waypoint */}
            {renderFeaturedWaypoint()}

            {/* Divider */}
            {featuredWaypoint && categorizedWaypoints.length > 0 && (
              <div style={{
                height: '1px',
                background: 'var(--border-subtle)',
                margin: '1rem 0',
              }} />
            )}

            {/* Other Waypoints Header */}
            {featuredWaypoint && categorizedWaypoints.length > 0 && (
              <h2 style={{ 
                fontSize: '0.875rem', 
                textTransform: 'uppercase', 
                letterSpacing: '0.1em',
                color: 'var(--text-tertiary)',
                marginBottom: '-0.5rem',
                fontWeight: 500,
              }}>
                More Options
              </h2>
            )}

            {/* Categorized Waypoints */}
            {categorizedWaypoints.map(({ category, waypoints }) => {
              // Prepare subcategories data if they exist
              const subcategoriesData = category.subcategories?.map(subcat => {
                const subcatWaypoints = availableWaypoints.filter(w => w.category === subcat.id);
                return {
                  category: subcat,
                  waypoints: subcatWaypoints,
                  isExpanded: expandedCategories.has(subcat.id),
                  onToggle: () => toggleCategory(subcat.id),
                };
              }).filter(sub => sub.waypoints.length > 0);

              return (
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
                />
              );
            })}
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
          Universal links for the ATmosphere.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Share ATProto content with anyone, let them choose where to view it.
        </p>
        <ShareButton
          url={typeof window !== 'undefined' ? window.location.href : ''}
          label="Share this waypoint page"
        />
      </div>
    </div>
  );
}
