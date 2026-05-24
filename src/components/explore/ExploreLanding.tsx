'use client';

import Link from 'next/link';
import { Compass, Download, Telescope } from 'lucide-react';
import AppearIn from './AppearIn';
import SearchBox from './SearchBox';
import JetstreamFeed from './JetstreamFeed';

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
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
          gap: '1rem',
        }}
      >
        <CrossLinkCard
          icon={<Compass size={18} />}
          title="Universal links"
          body="Share aturi.to/handle/collection/rkey with anyone — they pick the Atmosphere app to open it in."
          href="/"
        />
        <CrossLinkCard
          icon={<Download size={18} />}
          title="Browser extension"
          body="Inspect AT URIs on any page and fast-travel between Atmosphere apps."
          href="/extension"
        />
      </section>
      </AppearIn>
    </div>
  );
}

function CrossLinkCard({
  icon,
  title,
  body,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '1.25rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        textDecoration: 'none',
        transition: 'border-color 0.2s ease, background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text-accent)';
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-medium)';
        e.currentTarget.style.background = 'var(--bg-secondary)';
      }}
    >
      <span style={{ color: 'var(--text-accent)' }}>{icon}</span>
      <h3 style={{ fontSize: '1rem', fontWeight: 400, margin: 0 }}>{title}</h3>
      <p
        style={{
          margin: 0,
          fontSize: '0.875rem',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
        }}
      >
        {body}
      </p>
    </Link>
  );
}
