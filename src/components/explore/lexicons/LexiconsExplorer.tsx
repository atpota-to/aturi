'use client';

import { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import AppearIn from '../AppearIn';
import TrendingLexicons from '../TrendingLexicons';
import LexiconSearchBox from './LexiconSearchBox';
import BrowseAllLexicons from './BrowseAllLexicons';
import { fetchMeta } from '@/utils/ufos/client';

/**
 * The dedicated lexicons explorer (`/explore/lexicons`). Composes the
 * lexicon search box, the existing trending strip, and the full-catalog
 * browser, with a freshness footnote from the UFOs `/meta` endpoint.
 */
export default function LexiconsExplorer() {
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
            <Boxes size={12} /> Lexicon trends
          </div>
          <h1
            style={{
              fontSize: '2.5rem',
              fontWeight: 300,
              marginBottom: '0.75rem',
              color: 'var(--text-primary)',
            }}
          >
            Every lexicon in the Atmosphere.
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
            Search any collection NSID, watch what&rsquo;s trending, and browse the
            full catalog of record types seen across the AT Protocol firehose.
          </p>
          <LexiconSearchBox />
        </header>
      </AppearIn>

      <TrendingLexicons showExploreAllLink={false} />

      <AppearIn delay={0.08}>
        <BrowseAllLexicons />
      </AppearIn>

      <Freshness />
    </div>
  );
}

/** Subtle "data current as of …" line from /meta's jetstream cursor. */
function Freshness() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMeta().then((meta) => {
      if (cancelled || !meta) return;
      const consumer = meta.consumer as
        | { jetstream?: { latest_cursor?: number } }
        | undefined;
      const cursorUs = consumer?.jetstream?.latest_cursor;
      if (typeof cursorUs !== 'number') return;
      const agoSec = Math.max(0, Math.round((Date.now() - cursorUs / 1000) / 1000));
      const rel =
        agoSec < 90
          ? `${agoSec}s`
          : agoSec < 5400
            ? `${Math.round(agoSec / 60)}m`
            : `${Math.round(agoSec / 3600)}h`;
      setLabel(`Firehose data current as of ${rel} ago`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!label) return null;
  return (
    <p
      className="explore-small-caps"
      style={{ margin: 0, textAlign: 'center', color: 'var(--text-tertiary)' }}
    >
      {label}
    </p>
  );
}
