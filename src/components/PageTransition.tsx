'use client';

import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Route-level crossfade. Keyed on pathname so navigations trigger a fresh
 * mount of the children subtree.
 *
 * Tuned for subtlety:
 *
 *   - opacity-only (no y-slide) — slides drag the eye and amplify the
 *     "content jumped" feeling, especially on touch where you've already
 *     committed motion via the tap.
 *   - 220ms — long enough to read as intentional, short enough not to feel
 *     like a transition you're waiting through.
 *   - `mode="popLayout"` — incoming page is rendered alongside the outgoing
 *     one during the crossfade, so the layout doesn't collapse to zero
 *     height (which was making the footer ride up between pages).
 *
 * `reducedMotion="user"` makes every descendant motion component (FadeIn,
 * StaggeredChildren, the header h1/p/nav) respect the OS-level
 * prefers-reduced-motion setting — Framer auto-disables transforms while
 * keeping opacity transitions, matching the CSS-side guard in globals.css.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.22,
            ease: 'easeOut',
          }}
          // Hold the page area open while routing so the footer can't ride
          // up into the viewport mid-transition. Just under one screen so
          // short pages still look balanced.
          style={{ minHeight: '70dvh' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
