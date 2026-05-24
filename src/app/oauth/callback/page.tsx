'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getOauthClient } from '@/lib/oauth/client';

/**
 * OAuth callback page. The BrowserOAuthClient.init() call reads the URL
 * params left by the upstream OAuth server, finalizes the PKCE/DPoP
 * exchange, and resolves with the new session.
 */
export default function OAuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getOauthClient();
        const result = await client.init();
        if (cancelled) return;
        if (result && 'session' in result && result.session) {
          const did = result.session.sub;
          router.replace(`/explore/${did}`);
        } else {
          router.replace('/explore');
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
      <div
        style={{
          maxWidth: '480px',
          textAlign: 'center',
        }}
      >
        {error ? (
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
              {error}
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
