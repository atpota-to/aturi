'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Leaf, Telescope } from 'lucide-react';
import Header from '@/components/Header';
import SearchBox from '@/components/explore/SearchBox';

/**
 * Global 404 page. Next.js falls back to its plain-text default when this
 * file is absent; this version mirrors the site's hero treatment so a
 * mistyped URL doesn't read as a regression to a different product.
 *
 * Bias toward "give the visitor a way out": leaf-anchored eyebrow, big
 * serif headline, two-line explainer, the explorer's SearchBox (so a
 * fat-fingered handle is one re-keystroke away from working), and a Home
 * button next to a /explore link.
 */
export default function NotFound() {
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="container-narrow" style={{ padding: '2rem 2rem 0' }}>
        <Header compact />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        style={{
          maxWidth: '40rem',
          margin: '3rem auto 4rem',
          padding: '0 2rem',
        }}
      >
        {/* Eyebrow */}
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
          404 · Not found
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
            Lost in the Atmosphere.
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
          The path you tried didn&rsquo;t resolve. Search for a handle, DID, or
          AT URI to keep looking — or head home.
        </p>

        {/* Search */}
        <div style={{ marginBottom: '1.25rem' }}>
          <SearchBox />
        </div>

        {/* Quick actions */}
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
    </div>
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
