/**
 * Script-side motion helpers.
 *
 * CSS transitions and keyframes are neutralised for reduced motion by the
 * `[data-reduce-motion='true']` block in globals.css. Effects driven from
 * script (Web Animations, requestAnimationFrame tweens, timers that cycle
 * text) never see that rule, so they ask `motionAllowed()` first and settle
 * straight onto their end state when it says no.
 *
 * The curve and durations mirror the --ease-soft / --motion-* tokens in
 * globals.css so CSS- and script-driven motion move alike.
 */

import { getReduceMotionSnapshot } from '@/lib/a11y';

export const EASE_SOFT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const MOTION = {
  press: 120,
  quick: 180,
  panel: 240,
  arrive: 360,
} as const;

export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  return !getReduceMotionSnapshot();
}

/**
 * `element.animate` that does nothing when motion is off or the browser has
 * no Web Animations support. Defaults to `fill: 'backwards'`, so a delayed
 * entrance holds its first frame while it waits and then hands the element
 * back to its own styles: nothing is left pinned once it finishes.
 */
export function animate(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!el || !motionAllowed() || typeof (el as HTMLElement).animate !== 'function') return null;
  return (el as HTMLElement).animate(keyframes, {
    easing: EASE_SOFT,
    fill: 'backwards',
    ...options,
  });
}

/**
 * A branch that has just opened (a collection-tree group): it grows from
 * nothing to its own height while its first rows drift down into place,
 * 18ms apart. The stagger stops after eight rows so a long namespace opens
 * as fast as a short one.
 */
export function unfoldIn(el: HTMLElement, rowSelector = '.fx-row') {
  if (!motionAllowed()) return;
  const height = el.scrollHeight;
  const previousOverflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const grow = animate(el, [{ height: '0px' }, { height: `${height}px` }], {
    duration: MOTION.panel,
  });
  if (grow) {
    const restore = () => {
      el.style.overflow = previousOverflow;
    };
    grow.onfinish = restore;
    grow.oncancel = restore;
  } else {
    el.style.overflow = previousOverflow;
  }
  Array.from(el.querySelectorAll(rowSelector))
    .slice(0, 8)
    .forEach((row, i) =>
      animate(
        row,
        [
          { opacity: 0, transform: 'translateY(-3px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 200, delay: 40 + i * 18 },
      ),
    );
}

/**
 * Restarts a one-shot CSS animation keyed on an attribute (`data-blip` on a
 * live dot, `data-fresh` on a timestamp): off, a reflow, then on again, so
 * it plays from the start even if the last one hadn't finished.
 */
export function replay(el: Element | null | undefined, attribute: string) {
  if (!el || !motionAllowed()) return;
  el.removeAttribute(attribute);
  void (el as HTMLElement).offsetWidth;
  el.setAttribute(attribute, '');
}
