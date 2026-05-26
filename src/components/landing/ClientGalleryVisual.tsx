'use client';

import { Star } from 'lucide-react';
import {
  AnisotaLogo,
  BlueskySVG,
  BluepySVG,
  DeerSVG,
  LeafletSVG,
  PdslsSVG,
  TangledSVG,
  GrainSVG,
  MarginSVG,
} from '@/utils/waypointIcons';

const RECOMMENDED = {
  name: 'Anisota',
  desc: 'View post on anisota.net',
  icon: <AnisotaLogo />,
};

const COLUMN_A: { icon: React.ReactNode; name: string; host: string }[] = [
  { icon: <BlueskySVG />, name: 'Bluesky', host: 'bsky.app' },
  { icon: <DeerSVG />, name: 'Deer', host: 'deer.social' },
  { icon: <BluepySVG />, name: 'Bluepy', host: 'bluepy.dev' },
  { icon: <LeafletSVG />, name: 'Leaflet', host: 'leaflet.pub' },
];

const COLUMN_B: { icon: React.ReactNode; name: string; host: string }[] = [
  { icon: <TangledSVG />, name: 'Tangled', host: 'tangled.org' },
  { icon: <GrainSVG />, name: 'Grain', host: 'grain.social' },
  { icon: <PdslsSVG />, name: 'PDSls', host: 'pdsls.dev' },
  { icon: <MarginSVG />, name: '+18 more', host: 'browse the full picker' },
];

/**
 * Section visual for the extension landing's "Every app that renders
 * the record" pitch. Renders the popup's app picker as an oversized,
 * flat panel (no browser-chrome frame) so it reads as a distinct
 * visualization from the hero's BrowserChrome+popup composite, and
 * doesn't float off the bottom of its container into the next
 * section the way the absolutely-positioned hero popup can.
 *
 * Two-column body emphasizes breadth — the visitor sees a real range
 * of clients at a glance rather than the popup's compact 3-row list.
 */
export default function ClientGalleryVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        maxWidth: '460px',
        width: '100%',
        margin: '0 auto',
        transform: 'rotate(-0.4deg)',
      }}
    >
      {/* AT URI strip — names the lexicon the picker is filtering for */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>at://</span>
          aturi.to / app.bsky.feed.post / 3lq9…
        </span>
      </div>

      {/* Recommended */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.65rem',
            color: 'var(--text-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-serif)',
            marginBottom: '0.5rem',
          }}
        >
          <Star size={11} /> Recommended for posts
        </div>
        <Row {...RECOMMENDED} featured />
      </div>

      {/* Two-column gallery */}
      <div style={{ padding: '12px 14px' }}>
        <div
          style={{
            fontSize: '0.65rem',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-serif)',
            marginBottom: '0.5rem',
          }}
        >
          Or open in any of these
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px',
          }}
        >
          {[...COLUMN_A, ...COLUMN_B].map((c) => (
            <Row key={`${c.name}-${c.host}`} icon={c.icon} name={c.name} desc={c.host} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  name,
  desc,
  featured,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
  featured?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        background: featured ? 'var(--bg-tertiary)' : 'transparent',
        border: `1px solid ${featured ? 'var(--text-accent)' : 'var(--border-subtle)'}`,
      }}
    >
      <span className="landing-button-icon" aria-hidden style={{ width: 22, height: 22 }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: '0.68rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}
