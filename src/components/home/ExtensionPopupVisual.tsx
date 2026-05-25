'use client';

import { Leaf, MoreHorizontal, Settings } from 'lucide-react';
import {
  AnisotaLogo,
  AturiSVG,
  BlueskySVG,
  DeerSVG,
  LeafletSVG,
  TangledSVG,
} from '@/utils/waypointIcons';

/**
 * Static pure-CSS mock of the browser extension's popup. No real
 * interactivity — communicates what the extension looks like to a
 * visitor who hasn't installed it. Mirrors the actual popup's
 * structure (leaf header, source URI strip, "Recommended" row, a
 * few sample waypoint rows) so the visual is recognizable to
 * existing users too.
 */
export default function ExtensionPopupVisual() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '380px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        // Subtle isometric tilt so the mock reads as a popup floating
        // off the page rather than a flat card.
        transform: 'rotate(-1deg)',
        transition: 'transform 0.4s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background:
            'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '1.05rem',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          <Leaf
            size={16}
            style={{ color: 'var(--text-accent)' }}
            aria-hidden
          />
          <span>Aturi</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
          }}
        >
          <span style={{ letterSpacing: '0.02em' }}>app.bsky.feed.post</span>
          <button
            type="button"
            aria-label="Settings"
            tabIndex={-1}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 4px',
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'default',
            }}
          >
            <Settings size={11} aria-hidden />
          </button>
        </div>
      </div>

      {/* Source URI */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: 'var(--text-tertiary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>at://</span>
        aturi.to / app.bsky.feed.post / 3lq9…
      </div>

      {/* Recommended row */}
      <Section title="Recommended for posts">
        <Row
          icon={<AnisotaLogo />}
          name="Anisota"
          desc="View post on anisota.net"
        />
      </Section>

      {/* Atmosphere row */}
      <Section title="Bluesky clients">
        <Row
          icon={<BlueskySVG />}
          name="Bluesky"
          desc="View post on bsky.app"
        />
        <Row
          icon={<DeerSVG />}
          name="Deer"
          desc="View post on deer.social"
        />
        <Row
          icon={<LeafletSVG />}
          name="Leaflet"
          desc="View document on leaflet.pub"
        />
        <Row
          icon={<TangledSVG />}
          name="Tangled"
          desc="View on tangled.org"
        />
      </Section>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px 12px',
          borderTop: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          color: 'var(--text-tertiary)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              color: 'var(--text-accent)',
            }}
          >
            <AturiSVG />
          </span>
          <span>Copy universal link</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <MoreHorizontal size={12} aria-hidden />
        </span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px' }}>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '8px',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {children}
      </div>
    </div>
  );
}

function Row({
  icon,
  name,
  desc,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 8px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
          {name}
        </div>
        <div
          style={{
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}
