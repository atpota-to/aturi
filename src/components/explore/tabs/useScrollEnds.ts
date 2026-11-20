'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Marks a row that scrolls sideways with the ends that have more past
 * them, as `data-more="start" | "end" | "both"`, for the CSS to fade those
 * edges. A fade at an end the row has already reached would only hide a
 * pill, and no fade at the start once scrolled would hide that there is
 * anything back there. A row that fits, or that doesn't scroll sideways
 * at the panel's current width, carries no mark.
 *
 * `key` re-measures when the row's contents change without its box
 * changing size.
 */
export function useScrollEnds(ref: RefObject<HTMLElement | null>, key?: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = max > 1 && el.scrollLeft < max - 1;
      const more = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, key]);
}
