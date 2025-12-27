/**
 * PageSkeleton Component
 * General-purpose page loading skeleton for any page layout
 */

import { Skeleton, SkeletonText } from './SkeletonLoader';

interface PageSkeletonProps {
  /**
   * Show a header section (title + subtitle)
   */
  showHeader?: boolean;
  /**
   * Number of content sections to show
   */
  sections?: number;
  /**
   * Show a card-style container
   */
  showCard?: boolean;
}

export default function PageSkeleton({
  showHeader = true,
  sections = 2,
  showCard = false,
}: PageSkeletonProps) {
  const content = (
    <>
      {/* Header Section */}
      {showHeader && (
        <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
          <Skeleton
            height="2.5rem"
            width="300px"
            style={{ margin: '0 auto 1rem' }}
          />
          <Skeleton
            height="1.25rem"
            width="450px"
            style={{ margin: '0 auto' }}
          />
        </div>
      )}

      {/* Content Sections */}
      {Array.from({ length: sections }).map((_, i) => (
        <div
          key={i}
          className="skeleton-container"
          style={{
            marginBottom: '2rem',
            padding: showCard ? '1.5rem' : 0,
            background: showCard ? 'var(--bg-secondary)' : 'transparent',
            border: showCard ? '1px solid var(--border-medium)' : 'none',
          }}
        >
          {/* Section title */}
          <Skeleton
            height="1.5rem"
            width="200px"
            style={{ marginBottom: '1rem' }}
          />

          {/* Section content */}
          <SkeletonText lines={4} lastLineWidth="75%" />

          {/* Optional additional elements */}
          {i === 0 && (
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginTop: '1.5rem',
              }}
            >
              <Skeleton height="2.5rem" width="120px" />
              <Skeleton height="2.5rem" width="120px" />
            </div>
          )}
        </div>
      ))}
    </>
  );

  return content;
}

/**
 * Simple page skeleton - just a centered loading message replacement
 */
export function SimplePageSkeleton() {
  return (
    <div
      className="skeleton-container"
      style={{
        padding: '4rem 2rem',
        textAlign: 'center',
      }}
    >
      <Skeleton
        height="1.5rem"
        width="200px"
        style={{ margin: '0 auto' }}
      />
    </div>
  );
}

/**
 * Card list skeleton - for pages with multiple cards
 */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton-container"
          style={{
            padding: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <Skeleton width="24px" height="24px" />
            <Skeleton height="1.25rem" width="180px" />
          </div>
          <SkeletonText lines={2} lastLineWidth="60%" />
        </div>
      ))}
    </div>
  );
}

