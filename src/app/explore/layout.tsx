'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AtprotoSessionProvider } from '@/components/explore/AtprotoSessionProvider';
import Header from '@/components/Header';
import SessionBadge from '@/components/explore/SessionBadge';

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return (
    <AtprotoSessionProvider>
      <div style={{ padding: '2rem 2rem 0' }}>
        <Header />
      </div>
      <div
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '2rem 2rem 6rem',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            marginBottom: '1.5rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Link
            href="/explore"
            style={{
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontFamily: 'var(--font-serif)',
              fontSize: '1rem',
              letterSpacing: '0.04em',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>aturi · </span>
            explore the atmosphere
          </Link>
          <SessionBadge />
        </div>
        {children}
      </div>
    </AtprotoSessionProvider>
  );
}
