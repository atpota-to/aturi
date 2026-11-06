'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate, MOTION } from '@/lib/motion';

/**
 * Fades an element's contents in whenever `key` changes, but not on first
 * mount (the page transition already brings the page in). For a panel whose
 * contents swap in place, like a folder tab's sheet.
 *
 * A layout effect, so the new contents never paint at full strength for a
 * frame before the fade starts.
 */
export function useFadeOnChange(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  duration: number = MOTION.quick - 20,
) {
  const shown = useRef(key);
  useLayoutEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    animate(ref.current, [{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }, [key, ref, duration]);
}
