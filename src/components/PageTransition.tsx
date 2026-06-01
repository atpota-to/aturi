'use client';

import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useSyncExternalStore } from 'react';
import {
  getReduceMotionServerSnapshot,
  getReduceMotionSnapshot,
  subscribeReduceMotion,
} from '@/lib/a11y';

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
 * The `reducedMotion` config makes every descendant motion component
 * (FadeIn, StaggeredChildren, the header h1/p/nav) respect the reduce-motion
 * choice — Framer auto-disables transforms while keeping opacity
 * transitions, matching the CSS-side guard in globals.css. We read the live
 * `data-reduce-motion` attribute (seeded from the OS preference, overridable
 * by the in-app toggle) rather than `"user"` so the toggle controls Framer
 * too. Framer animations are JS-driven and only start after hydration, by
 * which point useSyncExternalStore has read the real attribute the init
 * script set before paint — so there's no pre-hydration motion flash.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const reduceMotion = useSyncExternalStore(
    subscribeReduceMotion,
    getReduceMotionSnapshot,
    getReduceMotionServerSnapshot,
  );

  // Reset scroll on route change. Next.js does this automatically, but
  // AnimatePresence mode="popLayout" keeps the outgoing page mounted
  // during the crossfade, which races the built-in scroll restoration
  // and leaves the new page scrolled to wherever the old one was. Hash
  // navigations are passed through so in-page anchors still work.
  //
  // `behavior: 'instant'` is required: globals.css sets
  // `scroll-behavior: smooth` on <html> for in-page anchor scrolling,
  // and the default form would inherit that — turning the scroll-to-top
  // into an animated tween that races the page-transition layout shift
  // and lands the user partway up the new page instead of at 0.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
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
