'use client';

import { ChevronRight, Leaf, Star } from 'lucide-react';
import {
  AnisotaLogo,
  BlueskySVG,
  DeerSVG,
  LeafletSVG,
  TangledSVG,
  PdslsSVG,
} from '@/utils/waypointIcons';

const ROWS: { icon: React.ReactNode; name: string; desc: string; featured?: boolean }[] = [
  {
    icon: <AnisotaLogo />,
    name: 'Anisota',
    desc: 'View post on anisota.net',
    featured: true,
  },
  {
    icon: <BlueskySVG />,
    name: 'Bluesky',
    desc: 'View post on bsky.app',
  },
  {
    icon: <DeerSVG />,
    name: 'Deer',
    desc: 'View post on deer.social',
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
    <div className="fl-mock" data-size="s">
      {/* Pretend ProfilePreview header */}
      <div className="fl-mock-head fl-picker-head">
        <span className="fl-picker-avatar" aria-hidden>
          <Leaf size={18} strokeWidth={2.2} />
        </span>
        <span className="fl-mock-row-text">
          <span className="fl-picker-name">Aturi</span>
          <span className="fl-mock-sub">@aturi.to</span>
        </span>
      </div>

      <div className="fl-mock-body">
        <span className="fl-mock-label" data-accent="">
          <Star size={11} /> Recommended for posts
        </span>
        <Row {...ROWS[0]} />
      </div>

      <div className="fl-mock-body">
        <span className="fl-mock-label">Open in another client</span>
        {ROWS.slice(1).map((r) => (
          <Row key={r.name} {...r} />
        ))}
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
    <div className="fl-mock-row" data-featured={featured ? '' : undefined}>
      <span className="fl-mock-icon">{icon}</span>
      <span className="fl-mock-row-text">
        <span className="fl-mock-name">{name}</span>
        <span className="fl-mock-desc">{desc}</span>
      </span>
      <ChevronRight size={14} className="fl-mock-chev" />
    </div>
  );
}
