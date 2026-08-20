'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Seconds to delay before the animation starts. Use to stagger sibling blocks. */
  delay?: number;
  /** When true, slides up slightly while fading in. Off by default for tighter feel. */
  rise?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** DOM id on the wrapper — used to make a block a scroll target. */
  id?: string;
};

/**
 * Mount-triggered fade-in for above-the-fold explore page blocks. Unlike the
 * site-wide `<FadeIn>` (which is viewport-keyed via `whileInView` and only
 * fires when scrolled into view), this one animates immediately on mount,
 * so the user doesn't catch a flash of invisible content before the
 * IntersectionObserver fires on first paint.
 *
 * Defaults to a 360ms opacity-only fade. Pass `rise` to add a 6px slide-up
 * for the first block in a sequence.
 */
export default function AppearIn({
  children,
  delay = 0,
  rise = false,
  className,
  style,
  id,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: rise ? 6 : 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.36,
        delay,
        ease: 'easeOut',
      }}
      className={className}
      style={style}
      id={id}
    >
      {children}
    </motion.div>
  );
}
