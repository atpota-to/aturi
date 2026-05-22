'use client';

import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  // `reducedMotion="user"` makes every descendant motion component (FadeIn,
  // StaggeredChildren, the header h1/p/nav) respect the OS-level
  // prefers-reduced-motion setting — Framer auto-disables transforms while
  // keeping opacity transitions, matching the CSS-side guard in globals.css.
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{
            duration: 0.4,
            ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number], // Organic bounce easing
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}

