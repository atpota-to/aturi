'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sizes a dashboard to the window: from where it starts, under the site
 * header, to the window's foot, less the phone's bottom toolbar
 * (--explore-chrome-h, which ExploreChromeBar measures and which is 0 where
 * the bar isn't drawn). So the page itself never scrolls; only the lists and
 * the panels inside do.
 *
 * The start is written to `property` on the element, for its stylesheet to
 * subtract from the window's height. It is summed from offsetTop, which
 * leaves out the transform the page transition settles the page in with, and
 * read again when the header changes height (a larger text size) or the
 * window does. The stylesheet carries a fallback for the first paint.
 */
export function useFillViewport(ref: RefObject<HTMLElement | null>, property: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      let top = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        top += node.offsetTop;
      }
      el.style.setProperty(property, `${top}px`);
    };
    measure();
    const header =
      el.closest('[data-page-key]')?.querySelector('.fn-header') ?? document.querySelector('.fn-header');
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, property]);
}
