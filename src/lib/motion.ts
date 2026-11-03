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
