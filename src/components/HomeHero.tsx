'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import SearchBox from './explore/SearchBox';
import DownloadButton, { BrowserFallbackList } from './home/DownloadButton';

/**
 * Homepage hero: one headline, the Explore search bar (the same component
 * that leads /explore), and a single primary CTA.
 *
 * The search bar puts the explorer's core action directly under the
 * headline so visitors can jump straight to any repo. Download is the only
 * button; Integrate is a text link, because the developer packages are a
 * much narrower audience than the extension and a second bordered button
 * made them look like an even split.
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
        padding: '0 var(--page-edge)',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--type-display)',
          fontWeight: 300,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
          marginBottom: '1.75rem',
          lineHeight: 1.15,
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
          Open any atproto record in the client you use
        </span>
      </h1>

      {/* Full-width Explore search bar. Left-aligned text inside a centered
          hero, so the typeahead/recommendations dropdown reads naturally. */}
      <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
        <SearchBox />
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.25rem',
          marginBottom: '0.875rem',
        }}
      >
        {/* showFallback omitted — the fallback list lives below the CTA
            row so it can center relative to the whole row. The label is left
            to the component's browser detection rather than overridden to a
            bare "Download": this is the first thing on the page, and a verb
            with no object doesn't name what it fetches. */}
        <DownloadButton variant="primary" />
        <Link href="/docs" style={{ fontSize: 'var(--type-small)' }}>
          Integrate
        </Link>
      </div>

      {/* Browser-detected "Also for X" line, centered under the row. */}
      <BrowserFallbackList justify="center" />
    </motion.section>
  );
}
