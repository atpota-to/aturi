'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Paired with the `max-width: 560px` block in globals.css that collapses the
 * chrome bar's button labels. Past this width the bar stops trying to fit a
 * toolbar on one line and hands the extra controls to a panel instead, so the
 * JS and the CSS have to agree on where "narrow" starts.
 */
const NARROW_QUERY = '(max-width: 560px)';

/**
 * True on phone-width viewports. Subscribed rather than measured on resize,
 * so it only re-renders when the answer actually changes.
 *
 * The server snapshot is `false`: there's no viewport to ask during SSR, and
 * assuming "roomy" means the markup matches the wider layout until hydration
 * corrects it — which is the right way round, since the panel this gates only
 * exists once selection mode is on and that can't happen before hydration.
 */
export function useIsNarrow(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(NARROW_QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}
