/**
 * ProfilePreviewSkeleton Component
 * Loading state for ProfilePreview, shaped like the card it stands in for
 */

import { Skeleton, SkeletonCircle, SkeletonText } from './SkeletonLoader';

export default function ProfilePreviewSkeleton() {
  return (
    <div className="skeleton-container card fn-lp-preview fn-lp-profile">
      <div className="fn-lp-profile-body">
        <div className="fn-lp-profile-id">
          <SkeletonCircle size="48px" />
          <div className="fn-lp-profile-names">
            {/* Display name */}
            <Skeleton height="1.0625rem" width="140px" style={{ marginBottom: '0.375rem' }} />
            {/* Handle */}
            <Skeleton height="0.8125rem" width="110px" />
          </div>
        </div>

        {/* Description */}
        <SkeletonText lines={2} lastLineWidth="70%" />

        {/* Stats line */}
        <Skeleton height="0.8125rem" width="220px" />
      </div>
    </div>
  );
}
