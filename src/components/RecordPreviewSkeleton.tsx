/**
 * RecordPreviewSkeleton Component
 * Loading state for generic RecordPreview
 */

import { Skeleton, SkeletonText } from './SkeletonLoader';

export default function RecordPreviewSkeleton() {
  return (
    <div
      className="skeleton-container"
      style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        transform: 'rotate(0.2deg)',
      }}
    >
      {/* Record Type Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-medium)',
        }}
      >
        <div>
          <Skeleton height="0.875rem" width="80px" style={{ marginBottom: '0.375rem' }} />
          <Skeleton height="1rem" width="150px" />
        </div>
        <div style={{ textAlign: 'right' }}>
          <Skeleton height="0.875rem" width="60px" style={{ marginBottom: '0.375rem' }} />
          <Skeleton height="0.875rem" width="120px" />
        </div>
      </div>

      {/* Record Fields skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton height="0.75rem" width="100px" style={{ marginBottom: '0.5rem' }} />
            <SkeletonText lines={i === 3 ? 4 : 2} lastLineWidth={i === 2 ? '90%' : '70%'} />
          </div>
        ))}
      </div>

      {/* URI skeleton */}
      <div
        style={{
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-medium)',
        }}
      >
        <Skeleton height="0.75rem" width="60px" style={{ marginBottom: '0.5rem' }} />
        <Skeleton height="0.875rem" width="100%" />
      </div>
    </div>
  );
}

