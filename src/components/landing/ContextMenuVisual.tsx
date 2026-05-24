'use client';

import { Copy, ExternalLink, Search, Telescope } from 'lucide-react';
import { Leaf } from 'lucide-react';

/**
 * Static visual of the right-click context menu the extension adds
 * to AT URIs found on any web page. Shows that the extension's
 * inspect/jump capabilities are available without ever opening the
 * popup — they're folded into the browser's native chrome.
 */
export default function ContextMenuVisual() {
  return (
    <div
      style={{
        position: 'relative',
        maxWidth: '420px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      {/* Snippet of page content showing a selected AT URI */}
      <div
        style={{
          padding: '14px 16px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          transform: 'rotate(-0.4deg)',
        }}
      >
        Source record:{' '}
        <span
          style={{
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            padding: '1px 4px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
          }}
        >
          at://did:plc:gq4…23tj/app.bsky.feed.post/3lq9c2fhz3k2v
        </span>
      </div>

      {/* Floating context menu */}
      <div
        style={{
          position: 'absolute',
          top: '60%',
          left: '14%',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-medium)',
          boxShadow: 'var(--shadow-overlay)',
          minWidth: '230px',
          padding: '4px 0',
          transform: 'rotate(0.4deg)',
          zIndex: 2,
        }}
      >
        <MenuRow icon={<Copy size={13} />}>Copy</MenuRow>
        <MenuRow icon={<Search size={13} />}>Search the web</MenuRow>
        <Divider />
        <MenuRow icon={<Leaf size={13} />} accent>
          Open with Aturi
        </MenuRow>
        <MenuRow icon={<ExternalLink size={13} />}>Open in recommended app</MenuRow>
        <MenuRow icon={<Telescope size={13} />}>Inspect on aturi.to</MenuRow>
      </div>
    </div>
  );
}

function MenuRow({
  icon,
  children,
  accent,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 14px',
        fontSize: '0.82rem',
        color: accent ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: accent ? 'var(--bg-tertiary)' : 'transparent',
        fontFamily: 'var(--font-serif)',
      }}
    >
      <span
        style={{
          color: accent ? 'var(--text-accent)' : 'var(--text-tertiary)',
          display: 'inline-flex',
        }}
      >
        {icon}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        margin: '4px 0',
        height: '1px',
        background: 'var(--border-subtle)',
      }}
    />
  );
}
