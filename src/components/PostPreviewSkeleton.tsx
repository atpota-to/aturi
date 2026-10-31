/**
 * PostPreviewSkeleton Component
 * Loading state for PostPreview. It wears the post card's own classes
 * (globals.css, "Post preview"), so the frame, padding and gaps are the
 * card's at every width and only the words and counts are bars.
 */

import { Skeleton, SkeletonCircle, SkeletonImage, SkeletonLine } from './SkeletonLoader';

interface PostPreviewSkeletonProps {
  withImage?: boolean;
  /** The tinted cross-link strip across the card's foot. */
  withFoot?: boolean;
}

export default function PostPreviewSkeleton({
  withImage = false,
  withFoot = true,
}: PostPreviewSkeletonProps) {
  return (
    <div aria-hidden className="card post-preview fn-post">
      {/* Author: 40px avatar, the name over the mono handle and date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <SkeletonCircle size="40px" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
          <SkeletonLine className="fn-post-name" width="7.5rem" height="0.75rem" style={{ fontSize: '15px' }} />
          <SkeletonLine className="fn-post-meta" width="11rem" height="0.55rem" />
        </div>
      </div>

      <div className="fn-post-text">
        <SkeletonLine width="100%" height="0.7rem" />
        <SkeletonLine width="94%" height="0.7rem" />
        <SkeletonLine width="58%" height="0.7rem" />
      </div>

      {withImage && <SkeletonImage height="300px" />}

      {/* The four labelled counts */}
      <div className="fn-post-footer">
        <span className="fn-post-counts">
          {['3.25rem', '4.5rem', '4rem', '3.75rem'].map((width) => (
            <span key={width} className="fn-post-count">
              <Skeleton width="15px" height="15px" shape="circle" />
              <SkeletonLine width={width} height="0.6rem" />
            </span>
          ))}
        </span>
      </div>

      {withFoot && (
        <div className="fn-post-foot">
          <SkeletonLine width="11rem" height="0.6rem" style={{ minHeight: '24px' }} />
        </div>
      )}
    </div>
  );
}
