'use client';

import Link from 'next/link';
import { Code2 } from 'lucide-react';
import { motion } from 'framer-motion';
import SearchBox from './explore/SearchBox';
import DownloadButton, { BrowserFallbackList } from './home/DownloadButton';

/**
 * Homepage hero: tagline + a full-width Explore search bar (the same one
 * that leads the /explore page), followed by two CTAs (Download +
 * Integrate) and the download's browser-detected fallback list.
 *
 * The search bar puts the explorer's core action right under the tagline
 * so visitors can jump straight to any repo, while the CTA row anchors the
 * two product entry points: the extension (download) and the developer
 * packages (integrate → docs).
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

      {/* Full-width Explore search bar — the same component that leads the
          /explore page. Left-aligned text inside a centered hero, so the
          typeahead/recommendations dropdown reads naturally. */}
      <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
        <SearchBox />
      </div>

      {/* CTA row — align to the top so the Integrate link doesn't stretch
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
        {/* showFallback omitted — the fallback list lives below the CTA
            row so it can center relative to both buttons. */}
        <DownloadButton variant="primary" label="Download" />
        <Link
          href="/docs"
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
          <Code2 size={18} style={{ color: 'var(--text-accent)' }} />
          <span>Integrate</span>
        </Link>
      </div>

      {/* Browser-detected "Also for X" line, centered under the row. */}
      <BrowserFallbackList justify="center" />
    </motion.section>
  );
}
