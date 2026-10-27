'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AUTO_REDIRECT_LATE_WINDOW_MS,
  breadcrumbSuppresses,
  hasStayParam,
  isBackForwardNavigation,
  readBreadcrumb,
  resolveAutoRedirect,
  writeBreadcrumb,
  type AutoRedirectContext,
  type AutoRedirectTarget,
} from '@/utils/autoRedirect';
import { COMPAT_FAMILIES, WAYPOINT_DESTINATIONS_DATA } from '@/utils/waypoints.data';
import { usePreferences } from './PreferencesProvider';
import { AUTO_REDIRECT_ARMING, AUTO_REDIRECT_ATTR } from '@/lib/autoRedirectShim';

/**
 * The React half of auto-redirect, and the page's way back into view.
 *
 * The inline script in `AutoRedirect` handles the common case before paint.
 * This covers everything it can't: custom waypoints, whose URL templates the
 * server never sees, and a preference that arrives after the page has already
 * rendered — a signed-in visitor's PDS record landing on a browser that had no
 * local copy. It is also what clears `data-autoredirect` when no redirect is
 * happening, so the content becomes visible again.
 *
 * Everything here is written on the assumption that hiding the page is
 * dangerous: the attribute is cleared on every path that isn't an imminent
 * navigation, including thrown errors, and the script arms a failsafe timer
 * besides.
 */
export default function AutoRedirectGate(props: AutoRedirectContext) {
  const { type, handle, did, collection, rkey } = props;
  const { prefs, loading } = usePreferences();
  const [suppressed, setSuppressed] = useState<AutoRedirectTarget | null>(null);

  const settledRef = useRef(false);
  const interactedRef = useRef(false);
  const mountedAtRef = useRef(0);

  // Any sign of life means the visitor is reading this page, not waiting to be
  // sent elsewhere. Capture phase and `once` so a single cheap listener per
  // event beats the gate's own late pass.
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const onInteract = () => {
      interactedRef.current = true;
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) {
      window.addEventListener(name, onInteract, {
        once: true,
        passive: true,
        capture: true,
      });
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, onInteract, { capture: true });
      }
    };
  }, []);

  useEffect(() => {
    if (settledRef.current) return;
    // Preferences settle twice for a signed-in visitor: once from
    // localStorage, then again when the PDS record lands. Acting on the first
    // pass is the fast path; the second is why this effect stays live.
    if (loading) return;

    try {
      const target = resolveAutoRedirect(prefs, { type, handle, did, collection, rkey },
        window.location.host);

      if (!target) {
        unhide();
        // Don't latch: a preference may still arrive from the PDS. The window
        // and the interaction flag are what stop this from firing forever.
        const elapsed = Date.now() - mountedAtRef.current;
        if (interactedRef.current || elapsed > AUTO_REDIRECT_LATE_WINDOW_MS) {
          settledRef.current = true;
        }
        return;
      }

      const reason = suppressionReason();
      if (reason) {
        settledRef.current = true;
        unhide();
        // Terminal, and unavoidable in an effect: whether a redirect is
        // suppressed depends on `location`, `performance` and sessionStorage,
        // none of which can be read during render. `settledRef` above makes it
        // a single transition, not a cascade.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSuppressed(target);
        return;
      }

      settledRef.current = true;
      // Re-arm rather than assume: on the late path the script either never
      // ran or already gave up, and hiding the page for the moment before the
      // browser navigates is the difference between a clean handoff and a
      // flash of a page nobody asked to see.
      document.documentElement.setAttribute(AUTO_REDIRECT_ATTR, AUTO_REDIRECT_ARMING);
      writeBreadcrumb(window.location.pathname, Date.now());
      window.location.replace(target.url);
    } catch {
      // A bug in resolution must not cost the visitor the page.
      settledRef.current = true;
      unhide();
    }
  }, [prefs, loading, type, handle, did, collection, rkey]);

  if (!suppressed) return null;

  return <SuppressedNotice target={suppressed} customNames={prefs.customWaypoints} />;
}

function unhide(): void {
  try {
    document.documentElement.removeAttribute(AUTO_REDIRECT_ATTR);
  } catch {
    // Nothing to do — the script's failsafe timer covers this.
  }
}

/**
 * Why we're not redirecting despite a live preference, or null to go ahead.
 * Interaction is handled separately, by the caller — this covers the three
 * signals that live on the page load itself.
 */
function suppressionReason(): string | null {
  if (hasStayParam(window.location.search)) return 'stay';
  if (
    isBackForwardNavigation(
      performance.getEntriesByType('navigation') as ReadonlyArray<{ type?: string }>,
    )
  ) {
    return 'back';
  }
  if (breadcrumbSuppresses(readBreadcrumb(), window.location.pathname, Date.now())) {
    return 'breadcrumb';
  }
  return null;
}

/**
 * Shown when a redirect was configured but held back. Without it the setting
 * is invisible from the only page it affects — someone who turned this on
 * months ago and hit the back button would have no way to connect what they're
 * seeing to a preference, or to find the switch again.
 */
function SuppressedNotice({
  target,
  customNames,
}: {
  target: AutoRedirectTarget;
  customNames: { id: string; name: string }[];
}) {
  const name =
    WAYPOINT_DESTINATIONS_DATA[target.waypointId]?.name ??
    customNames.find((c) => c.id === target.waypointId)?.name ??
    'your preferred client';
  const family = COMPAT_FAMILIES[target.family]?.name ?? target.family;

  return (
    <div
      className="content-fade-in"
      style={{
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        padding: '1rem 1.25rem',
        marginBottom: '1.5rem',
        color: 'var(--text-secondary)',
        fontSize: '0.9375rem',
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>
        Auto-redirect is on for {family}.
      </strong>{' '}
      We didn&rsquo;t send you to {name} this time.{' '}
      <a href={target.url} rel="noopener noreferrer">
        Open in {name}
      </a>{' '}
      or{' '}
      <Link href="/account#redirects">change the setting</Link>.
    </div>
  );
}
