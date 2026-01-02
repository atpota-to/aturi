'use client';

import { useState, useMemo, useEffect } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { 
  getCategorizedWaypoints, 
  getRecommendedWaypoints,
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
  const { waypoints: recommendedWaypoints, label: recommendedLabel } = useMemo(
    () => getRecommendedWaypoints(type, collection), 
    [type, collection]
  );
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
                    {waypoint.description}
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
            {/* Recommended Waypoints */}
            {renderRecommendedWaypoints()}

            {/* More Options Section */}
            {categorizedWaypoints.length > 0 && (
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
                </div>
              </div>
            )}
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
