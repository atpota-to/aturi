'use client';

import { useEffect, useState } from 'react';

// The sticky nav occludes roughly this much of the top of the viewport, and
// the chrome bar roughly this much of the bottom. An element hidden behind
// either is "not on screen" as far as the visitor is concerned, so both edges
// are inset before asking whether it's visible.
const NAV_OCCLUSION_PX = 96;
const CHROME_OCCLUSION_PX = 64;

/**
 * True while the watched element is out of the usable viewport — scrolled off
 * either edge, or sitting behind the sticky nav / bottom chrome bar.
 *
 * The explorer uses this to decide when the chrome bar should carry a copy of
 * an in-page control: exactly when you can't see the real one, so the same
 * button never appears twice at once. Both edges matter here (unlike the
 * top-anchored breadcrumb, which only cares about scrolling up past it)
 * because the record page lets the visitor order its sections — the control
 * being mirrored can sit anywhere down the page.
 *
 * The bottom inset is a constant rather than the chrome bar's measured height
 * so that revealing a control — which grows the bar — can't feed back into
 * this and flip the answer.
 *
 * Takes the node itself rather than a ref, so callers hold it in state via a
 * callback ref (`ref={setNode}`) and the observer re-attaches whenever the
 * watched element actually appears or goes away — which it does here, since
 * the controls being mirrored only render once you're signed in as the owner.
 */
export function useOffscreen(node: HTMLElement | null): boolean {
  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    // Nothing being watched means nothing to mirror — stay quiet rather than
    // claiming an absent control is off screen.
    if (!node) {
      setOffscreen(false);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry.isIntersecting),
      { rootMargin: `-${NAV_OCCLUSION_PX}px 0px -${CHROME_OCCLUSION_PX}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return offscreen;
}
