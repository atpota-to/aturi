'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Chrome, Download, Telescope } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  BROWSER_LABELS,
  EXTENSION_URLS,
  SUPPORTED_BROWSERS,
  detectBrowser,
  type Browser,
} from '@/utils/browserDetect';

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
  const [browser, setBrowser] = useState<Browser | null>(null);

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  // Mirror DownloadCTA's defaults so the button is meaningful pre-hydration.
  const detected: Browser = browser ?? 'chrome';
  const isSupported = SUPPORTED_BROWSERS.includes(detected);
  const primaryUrl = EXTENSION_URLS[detected] ?? EXTENSION_URLS.chrome!;
  const primaryLabel = BROWSER_LABELS[detected];
  const showFallbackLinks = !isSupported;
  const downloadButtonLabel =
    browser === null
      ? 'Download the Extension'
      : showFallbackLinks
        ? 'Download the Extension'
        : `Download for ${primaryLabel}`;

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
          fontSize: '2.75rem',
          fontWeight: 300,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
          marginBottom: '0.875rem',
          lineHeight: 1.15,
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
          Tour the Atmosphere
        </span>
      </h1>
      <p
        style={{
          fontSize: '1.125rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          maxWidth: '36rem',
          margin: '0 auto 1.75rem',
        }}
      >
        Switch between apps, share universal links, and walk any account&rsquo;s
        raw PDS data.
      </p>

      {/* CTA row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
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
          <span>Explore the Atmosphere</span>
          <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
        </Link>
        <a
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="generate-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '0.875rem 1.5rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-forest)',
            fontSize: '1.0125rem',
            fontWeight: 400,
            textDecoration: 'none',
            transition: 'all 0.3s ease',
            letterSpacing: '0.01em',
          }}
        >
          {detected === 'firefox' ? <Download size={18} /> : <Chrome size={18} />}
          <span>{downloadButtonLabel}</span>
        </a>
      </div>

      {/* Browser fallback line — same logic as the old DownloadCTA. */}
      {showFallbackLinks ? (
        <FallbackList prefix="Available for" browsers={SUPPORTED_BROWSERS} />
      ) : (
        <FallbackList
          prefix="Also for"
          browsers={SUPPORTED_BROWSERS.filter((b) => b !== detected)}
        />
      )}
    </motion.section>
  );
}

function FallbackList({
  prefix,
  browsers,
}: {
  prefix: string;
  browsers: Browser[];
}) {
  if (browsers.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '0.5rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '0.8125rem',
        color: 'var(--text-tertiary)',
      }}
    >
      <span>{prefix}</span>
      {browsers.map((b, idx) => (
        <span
          key={b}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <a
            href={EXTENSION_URLS[b]!}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ padding: '0.2rem 0.4rem' }}
          >
            {BROWSER_LABELS[b]}
          </a>
          {idx < browsers.length - 1 ? (
            <span style={{ opacity: 0.5 }}>·</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
