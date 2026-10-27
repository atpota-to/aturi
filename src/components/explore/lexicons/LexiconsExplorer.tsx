'use client';

import { useEffect, useState } from 'react';
import AppearIn from '../AppearIn';
import TrendingLexicons from '../TrendingLexicons';
import LexiconSearchBox from './LexiconSearchBox';
import BrowseAllLexicons from './BrowseAllLexicons';
import NewLexicons from './NewLexicons';
import { fetchMeta } from '@/utils/ufos/client';

/**
 * The dedicated lexicons explorer (`/explore/lexicons`). Composes the
 * lexicon search box, the existing trending strip, the new-lexicons list,
 * and the full-catalog browser, with a freshness footnote from the UFOs
 * `/meta` endpoint.
 */
export default function LexiconsExplorer() {
  return (
    <div className="fn-lexicons">
      <AppearIn rise>
        <header className="fn-lexicons-intro" aria-labelledby="fn-lexicons-title">
          <div>
            <span className="fn-kicker">Lexicon trends</span>
            <h1 id="fn-lexicons-title">Every lexicon in the Atmosphere</h1>
            <p>
              Search any collection NSID, watch what&rsquo;s trending, and browse the
              full catalog of record types seen across the AT Protocol firehose.
            </p>
          </div>
          <div>
            <LexiconSearchBox />
          </div>
        </header>
      </AppearIn>

      <div className="fn-lexicons-grid">
        <TrendingLexicons showExploreAllLink={false} />
        <NewLexicons />
      </div>

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
    <p className="fn-freshness">{label}</p>
  );
}
