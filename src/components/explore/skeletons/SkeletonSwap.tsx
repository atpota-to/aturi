'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Cross-fades a loading skeleton into the content it was standing in for.
 *
 * Both layers share one grid cell. While `loading` the caller passes no
 * children, so the cell is sized by the skeleton; when the data lands the
 * content mounts underneath and fades itself in (every explore block already
 * does that through <AppearIn>) while the skeleton dissolves off the top. The
 * result reads as the placeholder resolving into the real thing rather than as
 * a hard cut through an empty page.
 *
 * Both layers are transparent. They do overlap for the length of the fade, but
 * the content underneath is fading up from zero over its own 360ms at the same
 * time, so what you see is a dissolve rather than two stacked pages. An opaque
 * backdrop would fix the overlap and cost more than it saves: the page behind
 * carries a gradient, so a flat fill reads as a seam for the whole load.
 *
 * Reduced motion is handled globally — <MotionConfig> in PageTransition sets
 * `reducedMotion: 'always'`, which leaves the opacity fade (harmless) and drops
 * everything that moves.
 */
export default function SkeletonSwap({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'grid' }}>
      <div style={{ gridArea: '1 / 1', minWidth: 0 }}>{children}</div>
      <AnimatePresence initial={false}>
        {loading && (
          <motion.div
            key="skeleton"
            aria-hidden
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            style={{
              gridArea: '1 / 1',
              minWidth: 0,
              zIndex: 1,
              // Never intercept a click: while exiting it sits on top of live
              // content, and it has nothing of its own to interact with.
              pointerEvents: 'none',
            }}
          >
            {skeleton}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
