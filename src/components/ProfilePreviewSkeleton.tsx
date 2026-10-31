/**
 * ProfilePreviewSkeleton Component
 * Loading state for ProfilePreview, wearing the card's own classes (link.css)
 * from the banner down to the explorer strip, with the account's words as
 * bars.
 */

import { SkeletonCircle, SkeletonLine } from './SkeletonLoader';

export default function ProfilePreviewSkeleton() {
  return (
    <section aria-hidden className="card fn-lp-preview fn-lp-profile">
      {/* Most accounts have a banner, so its band is held: for one without,
          the card gets shorter when it lands rather than pushing the page. */}
      <div className="fn-skel profile-preview-banner" style={{ borderRadius: 0 }} />

      <div className="fn-lp-profile-body">
        <div className="fn-lp-profile-id">
          <SkeletonCircle size="48px" />
          <div className="fn-lp-profile-names">
            <SkeletonLine className="fn-lp-profile-name" width="8.5rem" height="0.85rem" />
            <SkeletonLine className="fn-lp-handle" width="7rem" height="0.6rem" />
          </div>
        </div>

        <div className="fn-lp-profile-bio">
          <SkeletonLine width="100%" />
          <SkeletonLine width="64%" />
        </div>

        <div className="fn-lp-profile-stats">
          <SkeletonLine width="15rem" />
        </div>

        <div className="fn-lp-preview-foot">
          <SkeletonLine width="10rem" style={{ minHeight: '24px' }} />
        </div>
      </div>
    </section>
  );
}
