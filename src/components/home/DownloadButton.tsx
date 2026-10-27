'use client';

import { Chrome, Download } from 'lucide-react';
import {
  BROWSER_LABELS,
  EXTENSION_URLS,
  SUPPORTED_BROWSERS,
  useDetectedBrowser,
  type Browser,
} from '@/utils/browserDetect';

type Props = {
  /** Primary moss-fill (used in the hero) vs outlined (used elsewhere). */
  variant?: 'primary' | 'outline';
  /**
   * When true, render the secondary "Also for / Available for" browser
   * fallback line below the button. The hero shows it; the Extension
   * strip skips it (it's redundant alongside the strip's own copy).
   */
  showFallback?: boolean;
  /** Cross-axis alignment of the button + fallback within the container. */
  align?: 'center' | 'start';
  /**
   * Override the button text. Defaults to the browser-detected
   * "Download for ${browser}" / "Download the Extension" copy.
   */
  label?: string;
};

/**
 * Browser-detected "Download for ${browser}" CTA. Extracted from
 * HomeHero so the Extension strip can reuse the same button + detection
 * logic without duplicating the JSX or the user-agent sniffing.
 */
export default function DownloadButton({
  variant = 'primary',
  showFallback = false,
  align = 'center',
  label: labelOverride,
}: Props) {
  const browser = useDetectedBrowser();

  const detected: Browser = browser ?? 'chrome';
  const isSupported = SUPPORTED_BROWSERS.includes(detected);
  const primaryUrl = EXTENSION_URLS[detected] ?? EXTENSION_URLS.chrome!;
  const primaryLabel = BROWSER_LABELS[detected];
  const showFallbackLinks = !isSupported;
  const label =
    labelOverride ??
    (browser === null
      ? 'Download the Extension'
      : showFallbackLinks
        ? 'Download the Extension'
        : `Download for ${primaryLabel}`);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        alignItems: align === 'center' ? 'center' : 'flex-start',
      }}
    >
      <a
        href={primaryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="fn-dl-button"
        data-variant={variant}
      >
        {detected === 'firefox' ? <Download size={16} /> : <Chrome size={16} />}
        <span>{label}</span>
      </a>
      {showFallback &&
        (showFallbackLinks ? (
          <FallbackList prefix="Available for" browsers={SUPPORTED_BROWSERS} />
        ) : (
          <FallbackList
            prefix="Also for"
            browsers={SUPPORTED_BROWSERS.filter((b) => b !== detected)}
          />
        ))}
    </div>
  );
}

function FallbackList({
  prefix,
  browsers,
  justify,
}: {
  prefix: string;
  browsers: Browser[];
  justify?: 'start' | 'center';
}) {
  if (browsers.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: justify === 'center' ? 'center' : 'flex-start',
        fontSize: '0.8125rem',
        color: 'var(--text-tertiary)',
      }}
    >
      <span>{prefix}</span>
      {browsers.map((b, idx) => (
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
          {idx < browsers.length - 1 ? <span style={{ opacity: 0.5 }}>·</span> : null}
        </span>
      ))}
    </div>
  );
}

/**
 * Standalone "Also for X / Available for X" fallback row. Renders the
 * same browser-detected list DownloadButton can show inline, but as
 * its own element so callers (e.g. HomeHero) can position it relative
 * to the whole CTA row instead of just the download column.
 */
export function BrowserFallbackList({
  justify = 'start',
}: {
  justify?: 'start' | 'center';
} = {}) {
  const browser = useDetectedBrowser();

  const detected: Browser = browser ?? 'chrome';
  const isSupported = SUPPORTED_BROWSERS.includes(detected);
  if (!isSupported) {
    return (
      <FallbackList prefix="Available for" browsers={SUPPORTED_BROWSERS} justify={justify} />
    );
  }
  return (
    <FallbackList
      prefix="Also for"
      browsers={SUPPORTED_BROWSERS.filter((b) => b !== detected)}
      justify={justify}
    />
  );
}

/**
 * One download button per supported browser, behind a single caption:
 * the hero's "Get the browser extension for [Chrome] [Firefox]" row.
 *
 * Detection still decides the emphasis: the visitor's own browser comes
 * first and takes the moss outline, so a Firefox visitor sees Firefox
 * leading. On an unsupported browser (Safari, Edge) nothing is
 * emphasised and the caption says the extension is available for the
 * listed ones instead.
 */
export function ExtensionBrowserLinks() {
  const browser = useDetectedBrowser();
  const isSupported = browser !== null && SUPPORTED_BROWSERS.includes(browser);
  const ordered = isSupported
    ? [browser, ...SUPPORTED_BROWSERS.filter((b) => b !== browser)]
    : SUPPORTED_BROWSERS;

  return (
    <div className="fn-home-browsers">
      <span>
        {browser !== null && !isSupported
          ? 'The browser extension is available for'
          : 'Get the browser extension for'}
      </span>
      {ordered.map((b) => (
        <a
          key={b}
          href={EXTENSION_URLS[b]!}
          target="_blank"
          rel="noopener noreferrer"
          className="fn-dl-button"
          data-variant="outline"
          data-detected={isSupported && b === browser ? '' : undefined}
        >
          <Download size={15} aria-hidden />
          {BROWSER_LABELS[b]}
        </a>
      ))}
    </div>
  );
}
