'use client';

import Link from 'next/link';
import { Compass, Download, Leaf, Telescope } from 'lucide-react';

type ProductKey = 'universal-links' | 'extension' | 'explore';

type Card = {
  key: ProductKey;
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    key: 'universal-links',
    href: '/links',
    icon: <Compass size={18} />,
    title: 'Universal links',
    body: 'Share aturi.to/handle/collection/rkey. Visitors choose which Atmosphere app opens it.',
  },
  {
    key: 'extension',
    href: '/extension',
    icon: <Download size={18} />,
    title: 'Browser extension',
    body: 'Inspect AT URIs on any page and jump between Atmosphere apps.',
  },
  {
    key: 'explore',
    href: '/explore',
    icon: <Telescope size={18} />,
    title: 'Atmosphere Explorer',
    body: "Browse any account's PDS records, identity history, and backlinks.",
  },
];

/**
 * Bottom-of-page "explore the rest of aturi" cards. Pass `current` to
 * hide the card for the page you're already on so we don't link a page
 * to itself.
 */
export default function CrossLinkCards({ current }: { current?: ProductKey }) {
  const cards = CARDS.filter((c) => c.key !== current);
  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
      aria-label="Other Aturi tools"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: 'var(--text-accent)',
            fontSize: '0.75rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-serif)',
            lineHeight: 1,
          }}
        >
          <Leaf size={14} aria-hidden /> More from Aturi
        </span>
        <h2
          style={{
            fontSize: '1.625rem',
            fontWeight: 300,
            color: 'var(--text-primary)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          See the rest of the toolkit
        </h2>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(16rem, 1fr))`,
          gap: '1rem',
        }}
      >
        {cards.map((c) => (
          <CrossLinkCard key={c.key} icon={c.icon} title={c.title} body={c.body} href={c.href} />
        ))}
      </div>
    </section>
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
