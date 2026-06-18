'use client';

import Link from 'next/link';
import { ArrowRight, Telescope } from 'lucide-react';
import { motion } from 'framer-motion';
import DownloadButton, { BrowserFallbackList } from './home/DownloadButton';

/**
 * Homepage hero: tagline + description + two side-by-side CTAs, plus the
 * download CTA's browser-detected fallback list below.
 *
 * Used in place of the bare <DownloadCTA /> after we swapped the homepage's
 * full-hero Header for the compact nav card. The CTA row anchors users on
 * the two product entry points: the explorer (a website experience) and
 * the extension (download).
 */
export default function HomeHero() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      style={{
        maxWidth: '760px',
        margin: '2.5rem auto 3rem',
        padding: '0 2rem',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: '2.25rem',
          fontWeight: 300,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
          marginBottom: '1.75rem',
          lineHeight: 1.2,
          maxWidth: '38rem',
          marginLeft: 'auto',
          marginRight: 'auto',
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
          Jump between clients, share universal links, browse any PDS
        </span>
      </h1>

      {/* CTA row — align to the top so the Explore link doesn't stretch
          to match the Download column's full height (button + fallback
          line). Each button keeps its natural size. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: '0.75rem',
          marginBottom: '0.875rem',
        }}
      >
        <Link
          href="/explore"
          className="generate-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '0.875rem 1.5rem',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--text-accent)',
            fontSize: '1.0125rem',
            fontWeight: 400,
            textDecoration: 'none',
            transition: 'all 0.3s ease',
            letterSpacing: '0.01em',
          }}
        >
          <Telescope size={18} style={{ color: 'var(--text-accent)' }} />
          <span>Explore</span>
          <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
        </Link>
        {/* showFallback omitted — the fallback list lives below the CTA
            row so it can center relative to both buttons. */}
        <DownloadButton variant="primary" label="Download" />
      </div>

      {/* Browser-detected "Also for X" line, centered under the row. */}
      <BrowserFallbackList justify="center" />
    </motion.section>
  );
}
