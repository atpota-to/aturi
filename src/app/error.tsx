'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';

/**
 * Global error boundary for the app segment. Without this file an
 * unhandled server or render error shows Next's unstyled default screen —
 * this keeps failures inside the site's frame with a retry affordance,
 * mirroring the tone (and the .fn-lp-notfound styles) of NotFoundPanel.
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
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      <Header compact />
      <div className="fn-c-error-wrap">
        <section className="fn-lp-notfound">
          <div className="fn-lp-notfound-eyebrow fn-c-error-pill">Something broke</div>
          <h1 className="fn-lp-notfound-title">Turbulence in the Atmosphere.</h1>
          <p className="fn-lp-notfound-body">
            Something went wrong rendering this page. It&apos;s usually transient (an
            upstream PDS or API hiccup), so trying again often works.
            {error.digest ? (
              <span className="fn-c-error-ref">
                Error reference: <code>{error.digest}</code>
              </span>
            ) : null}
          </p>
          <div className="fn-lp-notfound-actions">
            <button type="button" onClick={() => reset()} className="fn-c-btn fn-c-btn-primary">
              <RotateCcw size={15} aria-hidden />
              Try again
            </button>
            <Link href="/" className="fn-c-btn">
              <ArrowLeft size={15} aria-hidden />
              Back home
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
