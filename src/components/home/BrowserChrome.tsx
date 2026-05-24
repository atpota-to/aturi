'use client';

import type { ReactNode } from 'react';
import { Leaf } from 'lucide-react';

/**
 * Minimal browser-chrome backdrop for the homepage's extension strip.
 * Renders:
 *
 *   - Traffic-light window controls
 *   - URL bar with a sample bsky.app post URL
 *   - An extension toolbar strip with a few extension icons. The leaf
 *     (Aturi) is rendered as \"pressed\" — communicates that the popup
 *     hanging below is opened from that toolbar button.
 *
 * The popup itself is composed in by the caller via `children`, so the
 * caller controls the popup content + positioning. This component just
 * paints the frame.
 */
export default function BrowserChrome({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '520px',
        margin: '0 auto',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        // Slight rotation so the chrome reads as a depth surface, not a UI.
        transform: 'rotate(0.6deg)',
        transition: 'transform 0.4s ease',
        overflow: 'visible',
      }}
    >
      {/* Window controls strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.5rem 0.875rem',
          borderBottom: '1px solid var(--border-subtle)',
          background:
            'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
        }}
      >
        <TrafficLight color="#ff5f57" />
        <TrafficLight color="#febc2e" />
        <TrafficLight color="#28c840" />

        {/* URL bar */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.3rem 0.625rem',
            marginLeft: '0.5rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
          aria-hidden
        >
          <span style={{ color: 'var(--text-tertiary)' }}>bsky.app</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            /profile/aturi.to/post/3lq…
          </span>
        </div>

        {/* Extension toolbar — just the Aturi leaf as the active /
            pressed extension. Real browser extension bars often have a
            row of extensions, but rendering atmosphere-client logos
            here would misrepresent them as browser extensions (they're
            web apps, not extensions), so we keep this to just our own. */}
        <div style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden>
          <ExtensionIcon active>
            <Leaf size={14} />
          </ExtensionIcon>
        </div>
      </div>

      {/* Empty content area that fades into the page — the popup floats
          over the top-right corner so it visually anchors to the leaf
          icon in the toolbar above. On narrow viewports we drop the
          absolute positioning (see CSS in globals.css) so the popup
          stacks under the chrome instead of overflowing out the
          bottom into the next section. */}
      <div
        className="browser-chrome-content"
        style={{
          position: 'relative',
          minHeight: '20rem',
          padding: '1rem 1rem 1.25rem',
          background:
            'radial-gradient(circle at 80% 0%, var(--glow-subtle) 0%, transparent 60%)',
        }}
      >
        {/* Faint placeholder content lines so the "page" doesn't read as
            an empty void behind the popup. Hidden on mobile, where the
            popup stacks inline and the placeholder would just be dead
            space above it. */}
        <div className="browser-chrome-fake-content" aria-hidden style={{ opacity: 0.35 }}>
          <FakeLine width="42%" />
          <FakeLine width="68%" />
          <FakeLine width="55%" />
          <FakeLine width="72%" />
          <FakeLine width="34%" />
          <FakeLine width="60%" />
        </div>
        {/* Popup container — anchored to the right edge so it visually
            tucks under the extension icon at the top-right corner.
            On mobile the matching CSS class makes this static so the
            popup stacks under the chrome and the parent grows to fit. */}
        <div
          className="browser-chrome-popup"
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '-1.25rem',
            // Lift above the page content so the popup pops out.
            zIndex: 2,
            maxWidth: '95%',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function TrafficLight({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        background: color,
        borderRadius: '50%',
        flexShrink: 0,
        opacity: 0.85,
      }}
      aria-hidden
    />
  );
}

function ExtensionIcon({
  children,
  active,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <span
      style={{
        width: 22,
        height: 22,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'var(--bg-tertiary)' : 'transparent',
        border: `1px solid ${active ? 'var(--text-accent)' : 'transparent'}`,
        color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
        boxShadow: active ? '0 0 14px var(--glow-subtle)' : undefined,
      }}
    >
      {children}
    </span>
  );
}

function FakeLine({ width }: { width: string }) {
  return (
    <div
      style={{
        width,
        height: '0.55rem',
        marginBottom: '0.5rem',
        background: 'var(--bg-tertiary)',
        opacity: 0.45,
      }}
    />
  );
}
