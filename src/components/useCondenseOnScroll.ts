'use client';

import { useEffect, useState } from 'react';

/** Above this scroll depth the toolbar always stays full. */
const CONDENSE_AFTER_PX = 80;

/**
 * How far the page has to travel in one direction before it counts as a
 * decision to read on (condense) or to go back (expand). Anything shorter is
 * the jitter of a finger resting on the glass or a momentum scroll settling.
 */
const INTENT_PX = 12;

/**
 * Within this distance of the end of the page the toolbar stays full, so the
 * last rows and the footer's links are never sitting under a bar that has
 * just changed size. The bar's height reservation on the footer is also
 * measured at full size, and this is where that reservation matters.
 */
const END_SLACK_PX = 120;

/**
 * Whether the phone toolbar should be in its slim state: true while the
 * reader is scrolling down through a page, false as soon as they scroll back
 * up, return to the top, or reach the end. The same deal Safari's own bottom
 * bar offers, and on iOS the two shrink together.
 *
 * `enabled` is the caller's veto: off on wider screens, and off while the bar
 * is in use (a field focused, the menu or a panel open, selection mode on),
 * since shrinking a control out from under someone using it is worse than
 * covering a little more of the page.
 */
export function useCondenseOnScroll(enabled: boolean): boolean {
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;

    let lastY = window.scrollY;
    // Signed distance travelled since the scroll last changed direction.
    let travel = 0;
    let current = false;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      if (dy === 0) return;
      travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;

      const nearTop = y < CONDENSE_AFTER_PX;
      const nearEnd =
        y + window.innerHeight >= document.documentElement.scrollHeight - END_SLACK_PX;

      let next = current;
      if (nearTop || nearEnd) next = false;
      else if (travel > INTENT_PX) next = true;
      else if (travel < -INTENT_PX) next = false;

      if (next !== current) {
        current = next;
        setCondensed(next);
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      // Vetoed or torn down: start full the next time it's allowed, rather
      // than slimming the moment someone finishes typing in the field.
      setCondensed(false);
    };
  }, [enabled]);

  return enabled && condensed;
}
