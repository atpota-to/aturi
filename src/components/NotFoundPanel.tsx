'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Leaf, Telescope } from 'lucide-react';
import SearchBox from '@/components/explore/SearchBox';

type Props = {
  /** Small uppercase chip text. Defaults to "404 · NOT FOUND". */
  eyebrow?: string;
  /** Big gradient-serif headline. */
  headline?: string;
  /** Body copy under the headline. */
  body?: string;
  /**
   * Optional pre-filled value for the inline explorer SearchBox — useful
   * on resolve-error pages where the visitor is likely about to retry
   * what they just typed.
   */
  initialQuery?: string;
};

/**
 * Shared "we couldn't find what you asked for" panel. Used by the global
 * Next.js not-found route AND by client-side resolve-error states inside
 * the explorer (handle didn't resolve, record didn't load, etc.) so every
 * dead end gets the same recovery affordance: the explorer SearchBox
 * inline, plus Home + Explore buttons.
 */
export default function NotFoundPanel({
  eyebrow = '404 · Not found',
  headline = 'Lost in the Atmosphere.',
  body = "The path you tried didn't resolve. Search for a handle, DID, or AT URI to keep looking, or head home.",
  initialQuery,
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      style={{
        // Constrains text width but lets the parent layout handle the
        // horizontal gutter — the explore routes are already inside a
        // container-narrow with its own 2rem of side padding, and adding
        // more here doubled the inset. The standalone /not-found route
        // wraps this in its own padded container.
        maxWidth: '40rem',
        margin: '3rem auto 4rem',
      }}
    >
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
          fontFamily: 'var(--font-serif)',
          marginBottom: '1.25rem',
          transform: 'rotate(-0.4deg)',
        }}
      >
        <Leaf size={11} aria-hidden style={{ color: 'var(--text-accent)' }} />
        {eyebrow}
      </div>

      <h1
        style={{
          fontSize: '2.75rem',
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--text-primary)',
          marginBottom: '0.75rem',
          lineHeight: 1.05,
        }}
      >
        <span
          style={{
            background:
              'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {headline}
        </span>
      </h1>

      <p
        style={{
          fontSize: '1.0625rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: '1.5rem',
        }}
      >
        {body}
      </p>

      <div style={{ marginBottom: '1.25rem' }}>
        <SearchBox initial={initialQuery} />
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.625rem',
        }}
      >
        <Link href="/" style={primaryBtn}>
          <ArrowLeft size={14} aria-hidden /> Home
        </Link>
        <Link href="/explore" style={ghostBtn}>
          <Telescope size={14} aria-hidden /> Explore
        </Link>
      </div>
    </motion.section>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.55rem 1rem',
  background: 'var(--accent-moss)',
  color: 'var(--text-on-accent)',
  border: '1px solid var(--accent-moss)',
  fontFamily: 'var(--font-serif)',
  fontSize: '0.875rem',
  textDecoration: 'none',
};

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.55rem 1rem',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-medium)',
  fontFamily: 'var(--font-serif)',
  fontSize: '0.875rem',
  textDecoration: 'none',
};
