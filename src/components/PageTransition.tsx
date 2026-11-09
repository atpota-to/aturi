'use client';

import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getReduceMotionServerSnapshot,
  getReduceMotionSnapshot,
  subscribeReduceMotion,
} from '@/lib/a11y';
import { animate, MOTION } from '@/lib/motion';
import { parseExplorerPath } from '@/lib/explorerView';
import { useExplorerView } from './explore/workbench/useExplorerView';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Bars pinned to the viewport from inside the page. A block that holds one is
 * left still: a transform on it would pin the bar to the block while it
 * moves.
 */
const FIXED_INSIDE = '.explore-chrome-bar, .fn-lp-scroll, .settings-header';

/**
 * The new page's first few blocks: whatever follows the header, opened up
 * while it is a single wrapper (the explorer's container, a page's root
 * div), and only those that start on screen.
 */
function settleBlocks(page: HTMLElement): HTMLElement[] {
  const header = page.querySelector('.fn-header');
  let blocks: Element[] = [];
  if (header) {
    for (let el = header.nextElementSibling; el; el = el.nextElementSibling) blocks.push(el);
  } else {
    blocks = Array.from(page.querySelector('main')?.children ?? []);
  }
  for (let depth = 0; depth < 3 && blocks.length === 1; depth++) {
    blocks = Array.from(blocks[0].children);
  }
  // Measured from the page's own top: the window still holds the last
  // page's scroll until the reset below runs.
  const top = page.getBoundingClientRect().top;
  return blocks
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter(
      (el) =>
        el.offsetHeight > 0 &&
        el.getBoundingClientRect().top - top < window.innerHeight &&
        !el.matches(FIXED_INSIDE) &&
        !el.querySelector(FIXED_INSIDE) &&
        getComputedStyle(el).position !== 'fixed',
    )
    .slice(0, 5);
}

/**
 * Route-level crossfade. Keyed on pathname so navigations trigger a fresh
 * mount of the children subtree.
 *
 * One kind of move keeps the key it has: around one account's repository in
 * the explorer's workbench and Files views (ExplorerShell). Those rewrite
 * the address with the History API instead of navigating, precisely so the
 * shell stays mounted with the records it has fetched; a fresh mount here
 * would undo that. The key starts as the pathname either way, so the server
 * and the first client render agree whatever view the visitor has chosen.
 *
 * Tuned for subtlety:
 *
 *   - opacity-only on the page itself (no y-slide) — sliding the whole
 *     page drags the eye and amplifies the "content jumped" feeling,
 *     especially on touch where you've already committed motion via the
 *     tap. Instead the new page's first few blocks settle: each rises 6px
 *     as it fades in, 40ms after the one above (settleBlocks). The header
 *     stays still, so the bar never seems to move.
 *   - 200ms — long enough to read as intentional, short enough not to feel
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
  const explorerView = useExplorerView();
  // The key follows the pathname, except across a move inside the explorer
  // shell (see above), where it holds. Worked out while rendering, from the
  // pathname the key was last decided for, so it is right in the same
  // render the pathname changes in rather than one commit late.
  const [keyed, setKeyed] = useState({ path: pathname, key: pathname });
  let pageKey = keyed.key;
  if (keyed.path !== pathname) {
    const from = parseExplorerPath(keyed.path);
    const to = parseExplorerPath(pathname);
    const insideShell = explorerView !== 'classic' && !!from && !!to && from.repo === to.repo;
    if (!insideShell) pageKey = pathname;
    setKeyed({ path: pathname, key: pageKey });
  }
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

  // Settle the incoming page's blocks. Not on the first load (the page is
  // already there), and before paint, so no block shows at rest for a frame
  // before it drops back to start its rise.
  const settledPath = useRef(pathname);
  useLayoutEffect(() => {
    if (settledPath.current === pathname) return;
    settledPath.current = pathname;
    const page = document.querySelector<HTMLElement>(
      `[data-page-key="${CSS.escape(pathname ?? '')}"]`,
    );
    if (!page) return;
    settleBlocks(page).forEach((el, i) =>
      animate(
        el,
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: MOTION.arrive, delay: 60 + i * 40 },
      ),
    );
  }, [pathname]);

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={pageKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.2,
            ease: 'easeOut',
          }}
          data-page-key={pageKey ?? ''}
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
