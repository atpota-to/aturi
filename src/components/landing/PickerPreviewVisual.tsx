'use client';

import { ChevronRight, Star } from 'lucide-react';
import {
  BlueskySVG,
  DeerSVG,
  LeafletSVG,
  TangledSVG,
  PdslsSVG,
} from '@/utils/waypointIcons';

const ROWS: { icon: React.ReactNode; name: string; desc: string; featured?: boolean }[] = [
  {
    icon: <DeerSVG />,
    name: 'Deer',
    desc: 'View post on deer.social',
    featured: true,
  },
  {
    icon: <BlueskySVG />,
    name: 'Bluesky',
    desc: 'View post on bsky.app',
  },
  {
    icon: <LeafletSVG />,
    name: 'Leaflet',
    desc: 'View document on leaflet.pub',
  },
  {
    icon: <TangledSVG />,
    name: 'Tangled',
    desc: 'View on tangled.org',
  },
  {
    icon: <PdslsSVG />,
    name: 'PDSls',
    desc: 'View raw record on pdsls.dev',
  },
];

/**
 * Static mock of the universal link picker page (the page a visitor
 * actually lands on when they follow an aturi.to link). Shown on the
 * /universal-links landing page so people who haven't used one yet
 * can see what they'll be sharing before they click "see a live
 * example".
 */
export default function PickerPreviewVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        maxWidth: '420px',
        width: '100%',
        margin: '0 auto',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        transform: 'rotate(0.4deg)',
      }}
    >
      {/* Pretend ProfilePreview header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background:
              'linear-gradient(135deg, var(--accent-moss), var(--accent-forest))',
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1rem',
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            Aturi
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
            }}
          >
            @aturi.to
          </div>
        </div>
      </div>

      {/* Recommended */}
      <div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.65rem',
            fontWeight: 600,
            color: 'var(--text-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '0.5rem',
          }}
        >
          <Star size={11} /> Recommended for posts
        </div>
        <Row {...ROWS[0]} />
      </div>

      {/* Other clients */}
      <div>
        <div
          style={{
            fontSize: '0.65rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '0.5rem',
          }}
        >
          Open in another client
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ROWS.slice(1).map((r) => (
            <Row key={r.name} {...r} />
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
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
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
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {desc}
        </div>
      </div>
      <ChevronRight size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
    </div>
  );
}
