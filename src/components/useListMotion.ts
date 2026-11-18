'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate, MOTION } from '@/lib/motion';

/**
 * Motion for a ranked list whose rows carry `data-key`:
 *
 *   - Arrival: the first time the list appears (it replaces a skeleton),
 *     its rows land one by one, top to bottom, each rising 4px.
 *   - Re-rank: after that, when the rows change, a row that moved glides
 *     from its old place to its new one, and a row that is new fades in.
 *     Positions are offsets within the list, so a card growing above it
 *     never reads as every row moving.
 *
 * Runs after every commit and measures a handful of rows; nothing animates
 * unless a row actually moved. The list must be positioned (it is the rows'
 * offset parent).
 */
export function useListMotion(ref: RefObject<HTMLElement | null>) {
  const last = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) {
      last.current = null;
      return;
    }
    const rows = Array.from(list.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.key,
    );
    const now = new Map(rows.map((row) => [row.dataset.key!, row.offsetTop]));
    const before = last.current;
    last.current = now;

    if (!before) {
      rows.forEach((row, i) =>
        animate(
          row,
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: MOTION.panel, delay: Math.min(i, 10) * 70 },
        ),
      );
      return;
    }

    rows.forEach((row) => {
      const from = before.get(row.dataset.key!);
      const to = now.get(row.dataset.key!)!;
      if (from === undefined) {
        animate(row, [{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.panel, delay: 80 });
      } else if (Math.abs(from - to) > 1) {
        animate(row, [{ transform: `translateY(${from - to}px)` }, { transform: 'none' }], {
          duration: 340,
        });
      }
    });
  });
}
