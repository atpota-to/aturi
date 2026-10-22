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
  { icon: <MarginSVG />, name: '+18 more', host: 'full picker' },
];

/**
 * Section visual for the extension landing's "Every app that renders
 * the record" pitch. Renders the popup's app picker as a flat panel
 * (no browser frame) so it reads as distinct from the hero composite.
 * Two-column body emphasizes breadth: a real range of clients at a
 * glance rather than the popup's compact 3-row list.
 */
export default function ClientGalleryVisual() {
  return (
    <div className="fl-mock">
      {/* AT URI strip: names the lexicon the picker is filtering for */}
      <div className="fl-mock-bar">
        <span className="fl-ellipsis">
          <span className="fl-accent">at://</span>aturi.to/app.bsky.feed.post/3lq9…
        </span>
      </div>

      <div className="fl-mock-body">
        <span className="fl-mock-label" data-accent="">
          <Star size={11} /> Recommended for posts
        </span>
        <Row {...RECOMMENDED} featured />
      </div>

      <div className="fl-mock-body">
        <span className="fl-mock-label">Or open in any of these</span>
        {/* minmax(0, 1fr) tracks so a long host can't widen one column */}
        <div className="fl-mock-grid2">
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
    <div className="fl-mock-row" data-featured={featured ? '' : undefined}>
      <span className="fl-mock-icon" aria-hidden>
        {icon}
      </span>
      <span className="fl-mock-row-text">
        <span className="fl-mock-name">{name}</span>
        <span className="fl-mock-sub">{desc}</span>
      </span>
    </div>
  );
}
