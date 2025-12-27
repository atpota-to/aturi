/**
 * PostPreviewSkeleton Component
 * Loading state for PostPreview with organic shimmer animation
 */

import { Skeleton, SkeletonCircle, SkeletonText, SkeletonImage } from './SkeletonLoader';

interface PostPreviewSkeletonProps {
  withImage?: boolean;
  withExternalLink?: boolean;
}

export default function PostPreviewSkeleton({ 
  withImage = false,
  withExternalLink = false,
}: PostPreviewSkeletonProps) {
  return (
    <div
      className="skeleton-container"
      style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {/* Author Info skeleton */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem', 
          marginBottom: '1rem' 
        }}
      >
        <SkeletonCircle size="48px" />
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <Skeleton height="1rem" width="180px" style={{ marginBottom: '0.375rem' }} />
          <Skeleton height="0.875rem" width="140px" />
        </div>
      </div>

      {/* Post content skeleton */}
      <div style={{ marginBottom: '1rem' }}>
        <SkeletonText lines={3} lastLineWidth="80%" />
      </div>

      {/* Optional image embed */}
      {withImage && (
        <div style={{ marginBottom: '1rem' }}>
          <SkeletonImage height="300px" />
        </div>
      )}

      {/* Optional external link embed */}
      {withExternalLink && (
        <div 
          style={{ 
            marginBottom: '1rem',
            border: '1px solid var(--border-medium)',
            overflow: 'hidden',
          }}
        >
          <SkeletonImage height="200px" />
          <div style={{ padding: '1rem' }}>
            <Skeleton height="1rem" width="80%" style={{ marginBottom: '0.5rem' }} />
            <Skeleton height="0.875rem" width="100%" style={{ marginBottom: '0.25rem' }} />
            <Skeleton height="0.875rem" width="60%" style={{ marginBottom: '0.5rem' }} />
            <Skeleton height="0.75rem" width="120px" />
          </div>
        </div>
      )}

      {/* Post metadata skeleton */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-medium)',
        }}
      >
        {/* Stat icons */}
        {[1, 2, 3, 4].map((i) => (
          <div 
            key={i}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.375rem' 
            }}
          >
            <Skeleton width="16px" height="16px" />
            <Skeleton width="24px" height="0.875rem" />
          </div>
        ))}
        
        {/* Date skeleton */}
        <div style={{ marginLeft: 'auto' }}>
          <Skeleton width="100px" height="0.75rem" />
        </div>
      </div>
    </div>
  );
}

