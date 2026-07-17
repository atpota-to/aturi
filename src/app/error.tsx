'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';

/**
 * Global error boundary for the app segment. Without this file an
 * unhandled server or render error shows Next's unstyled default screen —
 * this keeps failures inside the site's frame with a retry affordance,
 * mirroring the tone of NotFoundPanel.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled route error:', error);
  }, [error]);

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="container-narrow" style={{ padding: '2rem 2rem 0' }}>
        <Header compact />
      </div>
      <div className="container-narrow" style={{ padding: '0 2rem 4rem' }}>
        <section style={{ maxWidth: '40rem', margin: '3rem auto 4rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.3rem 0.7rem',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-tertiary)',
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Something broke
          </div>
          <h1
            style={{
              margin: '1.25rem 0 0.75rem',
              fontSize: '2rem',
              lineHeight: 1.2,
              color: 'var(--text-primary)',
            }}
          >
            Turbulence in the Atmosphere.
          </h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 2rem' }}>
            Something went wrong rendering this page. It&apos;s usually transient (an
            upstream PDS or API hiccup), so trying again often works.
            {error.digest ? (
              <span style={{ display: 'block', marginTop: '0.5rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                Error reference: {error.digest}
              </span>
            ) : null}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => reset()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.1rem',
                border: '1px solid var(--border-medium, var(--border-subtle))',
                background: 'var(--bg-elevated, var(--bg-tertiary))',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <RotateCcw size={16} aria-hidden />
              Try again
            </button>
            <Link
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.1rem',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
              }}
            >
              <ArrowLeft size={16} aria-hidden />
              Back home
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
