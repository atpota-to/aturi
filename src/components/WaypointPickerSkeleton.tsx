/**
 * WaypointPickerSkeleton Component
 * Loading state for the top of <WaypointPicker> on the universal link pages:
 * the "Open … in" heading and its line, then the two recommended rows. Shown
 * under the preview card's skeleton while the page streams, so the picker
 * arrives into space already held for it instead of pushing in below.
 */

import { Skeleton, SkeletonLine } from './SkeletonLoader';

export default function WaypointPickerSkeleton() {
  return (
    <div aria-hidden className="fn-lp-picker">
      <div className="fn-lp-head">
        {/* The classes take the h1's and the line's type (link.css), phone
            sizes included, without an empty heading in the outline. */}
        <SkeletonLine width="min(19rem, 80%)" height="1.1rem" className="fn-lp-head-title" />
        <SkeletonLine width="min(15rem, 65%)" className="fn-lp-head-sub" />
      </div>

      <div className="fn-lp-recommended">
        {/* The first recommendation is the filled one. */}
        <Skeleton height="56px" style={{ borderRadius: 'var(--radius-card)' }} />
        <div className="fn-lp-hero">
          <span className="fn-lp-hero-link">
            <Skeleton width="20px" height="20px" shape="circle" />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton width="5.5rem" height="0.7rem" />
              <Skeleton width="4.5rem" height="0.5rem" />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
