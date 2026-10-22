/**
 * ProfilePreviewSkeleton Component
 * Loading state for ProfilePreview with organic shimmer animation
 */

import { Skeleton, SkeletonCircle, SkeletonText } from './SkeletonLoader';

export default function ProfilePreviewSkeleton() {
  return (
    <div
      className="skeleton-container"
      style={{
        marginBottom: '2rem',
        padding: 0,
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {/* Banner skeleton */}
      <Skeleton
        height="200px"
        style={{
          background: 'linear-gradient(135deg, var(--accent-moss) 0%, var(--accent-forest) 100%)',
          opacity: 0.3,
        }}
        animate={false}
      />

      <div style={{ padding: '1.5rem' }}>
        {/* Avatar and Name Section */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'flex-start', 
            gap: '1rem', 
            marginTop: '-4rem', 
            marginBottom: '1rem' 
          }}
        >
          <SkeletonCircle 
            size="96px"
            style={{
              border: '4px solid var(--bg-secondary)',
            }}
          />
          
          <div style={{ flex: 1, minWidth: 0, paddingTop: '3.5rem' }}>
            {/* Display name */}
            <Skeleton height="1.5rem" width="200px" style={{ marginBottom: '0.5rem' }} />
            {/* Handle */}
            <Skeleton height="1rem" width="150px" />
          </div>
        </div>

        {/* Description skeleton */}
        <div style={{ marginBottom: '1.5rem' }}>
          <SkeletonText lines={3} lastLineWidth="75%" />
        </div>

        {/* Stats skeleton */}
        <div 
          style={{
            paddingTop: '1rem',
            borderTop: '1px solid var(--border-medium)',
          }}
        >
          <div 
            style={{ 
              display: 'flex', 
              gap: '2rem',
              marginBottom: '1rem',
              flexWrap: 'wrap',
            }}
          >
            {/* Stat items */}
            {[1, 2, 3].map((i) => (
              <div 
                key={i}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem' 
                }}
              >
                <Skeleton width="18px" height="18px" />
                <Skeleton width="100px" height="1rem" />
              </div>
            ))}
          </div>
          
          {/* Join date skeleton */}
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem' 
            }}
          >
            <Skeleton width="18px" height="18px" />
            <Skeleton width="120px" height="0.875rem" />
          </div>
        </div>
      </div>
    </div>
  );
}

