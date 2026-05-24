'use client';

import { Check, ChevronRight } from 'lucide-react';
import {
  BlueskySVG,
  DeerSVG,
  LeafletSVG,
  TangledSVG,
  GrainSVG,
} from '@/utils/waypointIcons';

const ROWS: { collection: string; label: string; icon: React.ReactNode; client: string }[] = [
  {
    collection: 'app.bsky.feed.post',
    label: 'Posts',
    icon: <DeerSVG />,
    client: 'Deer',
  },
  {
    collection: 'pub.leaflet.document',
    label: 'Documents',
    icon: <LeafletSVG />,
    client: 'Leaflet',
  },
  {
    collection: 'sh.tangled.repo',
    label: 'Repositories',
    icon: <TangledSVG />,
    client: 'Tangled',
  },
  {
    collection: 'social.grain.gallery',
    label: 'Photo galleries',
    icon: <GrainSVG />,
    client: 'Grain',
  },
  {
    collection: 'app.bsky.actor.profile',
    label: 'Profiles',
    icon: <BlueskySVG />,
    client: 'Bluesky',
  },
];

/**
 * Static visual of the per-lexicon auto-redirect preferences screen.
 * Communicates that the extension can be told "every time you land
 * on X, send me to Y" — one of the features that doesn't fit in the
 * popup mock on its own.
 */
export default function AutoRedirectVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        maxWidth: '420px',
        width: '100%',
        margin: '0 auto',
        transform: 'rotate(0.3deg)',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
          }}
        >
          Auto-redirect
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.65rem',
            color: 'var(--text-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-serif)',
          }}
        >
          <Check size={12} /> On
        </div>
      </div>
      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {ROWS.map((r) => (
          <div
            key={r.collection}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 10px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.collection}
              </div>
            </div>
            <ChevronRight size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--text-accent)',
                fontSize: '0.75rem',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-serif)',
              }}
            >
              {/* Wrapper class + CSS in globals.css forces the inner
                  waypoint SVG (intrinsic 24x24) to fill this 16x16 box
                  so it lines up vertically with the client name. */}
              <span className="landing-button-icon" aria-hidden>
                {r.icon}
              </span>
              {r.client}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
