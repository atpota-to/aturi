'use client';

import Link from 'next/link';
import { Telescope } from 'lucide-react';
import AppearIn from './AppearIn';
import SearchBox from './SearchBox';
import JetstreamFeed from './JetstreamFeed';
import CrossLinkCards from '@/components/landing/CrossLinkCards';

const SUGGESTIONS = ['aturi.to', 'bsky.app', 'dame.is', 'jay.bsky.team'];

export default function ExploreLanding() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      <AppearIn rise>
      <header>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.25rem 0.625rem',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-serif)',
            marginBottom: '1.25rem',
          }}
        >
          <Telescope size={12} /> Atmosphere data explorer
        </div>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 300,
            marginBottom: '0.75rem',
            color: 'var(--text-primary)',
          }}
        >
          Browse through any repository.
        </h1>
        <p
          style={{
            fontSize: '1.05rem',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            maxWidth: '38rem',
            marginBottom: '2rem',
          }}
        >
          Every account on the Atmosphere keeps its records in a public PDS.
          Browse collections, inspect identity history, follow backlinks, and
          edit your own records — all without leaving the browser.
        </p>
        <SearchBox />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Try:</span>
          {SUGGESTIONS.map((s) => (
            <Link
              key={s}
              href={`/explore/${s}`}
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-accent)',
                padding: '0.125rem 0.5rem',
                border: '1px solid var(--border-subtle)',
                textDecoration: 'none',
              }}
            >
              {s}
            </Link>
          ))}
        </div>
      </header>
      </AppearIn>

      <AppearIn delay={0.08}>
        <JetstreamFeed />
      </AppearIn>

      <AppearIn delay={0.16}>
        <CrossLinkCards current="explore" />
      </AppearIn>
    </div>
  );
}
