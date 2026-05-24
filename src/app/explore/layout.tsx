'use client';

import type { ReactNode } from 'react';
import { AtprotoSessionProvider } from '@/components/explore/AtprotoSessionProvider';
import Header from '@/components/Header';
import SessionBadge from '@/components/explore/SessionBadge';

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return (
    <AtprotoSessionProvider>
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
        <Header compact />
        <SessionStrip />
        {children}
      </div>
    </AtprotoSessionProvider>
  );
}

/**
 * Thin one-line strip beneath the compact header. Only renders when the
 * user is signed in (SessionBadge handles the empty case internally).
 */
function SessionStrip() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: '-1rem',
        marginBottom: '1.5rem',
      }}
    >
      <SessionBadge />
    </div>
  );
}
