'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { takeReturnPath } from '@/lib/oauth/returnTo';

/**
 * OAuth callback page.
 *
 * `BrowserOAuthClient.init()` is owned by `<AtprotoSessionProvider>` —
 * since the provider lives in the root layout, it's already running and
 * will pick up the `?code=…` params from this URL on mount. We just
 * subscribe to its session state and navigate when it resolves.
 *
 * Calling `init()` here too (the old behavior) caused a race: whichever
 * call consumed the URL params first won, leaving the other site stuck
 * with `session = null` and no way to retry without a full reload — that
 * was the "signed in but nav says Sign in" bug.
 */
export default function OAuthCallback() {
  const router = useRouter();
  const { did, loading, error } = useAtprotoSession();
  const [timedOut, setTimedOut] = useState(false);
  // takeReturnPath() clears the stored value, so capture it once via a
  // lazy initial state — re-running it on every render would yield null
  // after the first call.
  const [returnTo] = useState(() => takeReturnPath());

  // Navigate when the provider's init() resolves with a session.
  useEffect(() => {
    if (loading || !did) return;
    router.replace(returnTo || '/account');
  }, [loading, did, router, returnTo]);

  // If init resolves with no session and no error, the URL was probably
  // visited directly — surface a recoverable error after a beat.
  useEffect(() => {
    if (loading || did || error) return;
    const t = setTimeout(() => setTimedOut(true), 2500);
    return () => clearTimeout(t);
  }, [loading, did, error]);

  const message =
    error?.message ??
    (timedOut ? 'No active session — was this callback URL visited directly?' : null);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: '480px', textAlign: 'center' }}>
        {message ? (
          <>
            <h1
              style={{
                fontSize: '1.5rem',
                marginBottom: '1rem',
                color: 'var(--danger)',
              }}
            >
              Sign-in failed
            </h1>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                wordBreak: 'break-word',
              }}
            >
              {message}
            </p>
            <p style={{ marginTop: '1.5rem' }}>
              <Link href="/explore" style={{ color: 'var(--text-accent)' }}>
                Back to the explorer
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1
              style={{
                fontSize: '1.5rem',
                marginBottom: '0.75rem',
                fontWeight: 300,
              }}
            >
              Signing you in…
            </h1>
            <p style={{ color: 'var(--text-tertiary)' }}>One moment.</p>
          </>
        )}
      </div>
    </div>
  );
}
