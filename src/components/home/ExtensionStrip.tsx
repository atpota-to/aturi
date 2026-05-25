'use client';

import { MousePointerClick, Repeat } from 'lucide-react';
import { getWaypointCount } from '@/utils/waypoints';
import ProductStrip from './ProductStrip';
import BrowserChrome from './BrowserChrome';
import ExtensionPopupVisual from './ExtensionPopupVisual';
import DownloadButton from './DownloadButton';

/**
 * Strip 2 — Browser extension. Demo is a static visual of the popup
 * (no live extension chrome possible from the web page); copy + the
 * shared DownloadButton on the other side.
 */
export default function ExtensionStrip() {
  const waypointCount = getWaypointCount();
  return (
    <ProductStrip
      flip
      label="Browser extension"
      copy={
        <>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.2rem 0.6rem',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-tertiary)',
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: '1rem',
              lineHeight: 1,
            }}
          >
            <MousePointerClick size={12} aria-hidden />
            Browser extension
          </span>
          <h2>Jump between Atmosphere clients in one click</h2>
          <p>
            Land on a Bluesky post and want to read it in Anisota? Click the
            leaf in your toolbar — the popup detects the AT URI on the page and
            offers every app that can render it.
          </p>
          <p>
            Pick a favorite once and let auto-redirect handle it. Open
            <em> any</em> Atmosphere link straight into the client you actually
            use. The Inspect tab also surfaces the underlying record, PDS, DID,
            and backlinks for whatever&rsquo;s on screen.
          </p>
          <p
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              color: 'var(--text-accent)',
              fontFamily: 'var(--font-mono)',
              marginBottom: '1.25rem',
            }}
          >
            <Repeat size={14} />
            {waypointCount} curated Atmosphere clients
          </p>
          <DownloadButton variant="primary" align="start" />
        </>
      }
      demo={
        <BrowserChrome>
          <ExtensionPopupVisual />
        </BrowserChrome>
      }
    />
  );
}
