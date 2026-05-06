'use client';

import { useEffect, useState } from 'react';
import { Download, Chrome } from 'lucide-react';
import { motion } from 'framer-motion';
import { detectBrowser, EXTENSION_URLS, BROWSER_LABELS, type Browser } from '@/utils/browserDetect';

interface DownloadCTAProps {
  variant?: 'hero' | 'compact';
}

export default function DownloadCTA({ variant = 'hero' }: DownloadCTAProps) {
  const [browser, setBrowser] = useState<Browser | null>(null);

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  // Default to Chrome label/URL during SSR or while detecting, so the button is
  // immediately useful even before hydration completes.
  const detected: Browser = browser ?? 'chrome';
  const primaryUrl = EXTENSION_URLS[detected] ?? EXTENSION_URLS.chrome!;
  const primaryLabel = BROWSER_LABELS[detected];

  if (variant === 'compact') {
    return (
      <a
        href={primaryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="nav-link"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontWeight: 400,
        }}
      >
        <Download size={14} />
        <span>get extension</span>
      </a>
    );
  }

  const showFallbackLinks = browser === 'safari' || browser === 'other';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.35, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
      style={{
        maxWidth: '700px',
        margin: '0 auto 2rem',
        padding: '0 2rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <a
        href={primaryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="generate-button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '1rem 1.75rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-primary)',
          border: '1px solid var(--accent-forest)',
          fontSize: '1.05rem',
          fontWeight: 400,
          textDecoration: 'none',
          transition: 'all 0.3s ease',
          letterSpacing: '0.01em',
        }}
      >
        {detected === 'firefox' ? <Download size={20} /> : <Chrome size={20} />}
        <span>
          {browser === null
            ? 'Download the extension'
            : showFallbackLinks
              ? 'Download the extension'
              : `Download for ${primaryLabel}`}
        </span>
      </a>

      {showFallbackLinks ? (
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Available for</span>
          <a
            href={EXTENSION_URLS.chrome!}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            Chrome
          </a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a
            href={EXTENSION_URLS.firefox!}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            Firefox
          </a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a
            href={EXTENSION_URLS.edge!}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            Edge
          </a>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Also for</span>
          {(['chrome', 'firefox', 'edge'] as const)
            .filter((b) => b !== detected)
            .map((b, idx, arr) => (
              <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <a
                  href={EXTENSION_URLS[b]!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-link"
                  style={{ padding: '0.2rem 0.4rem' }}
                >
                  {BROWSER_LABELS[b]}
                </a>
                {idx < arr.length - 1 ? <span style={{ opacity: 0.5 }}>·</span> : null}
              </span>
            ))}
        </div>
      )}
    </motion.div>
  );
}
