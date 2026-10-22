'use client';

import { ArrowRight } from 'lucide-react';
import {
  AnisotaLogo,
  BlueskySVG,
  LeafletSVG,
  TangledSVG,
  GrainSVG,
} from '@/utils/waypointIcons';

const ROWS: { collection: string; label: string; icon: React.ReactNode; client: string }[] = [
  {
    collection: 'app.bsky.feed.post',
    label: 'Posts',
    icon: <AnisotaLogo />,
    client: 'Anisota',
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
 * on X, send me to Y", one of the features that doesn't fit in the
 * popup mock on its own.
 */
export default function AutoRedirectVisual() {
  return (
    <div className="fl-mock" data-size="s">
      <div className="fl-mock-head">
        <span className="fl-mock-head-title">Auto-redirect</span>
        <span className="fl-switch-label">
          On <span className="fl-switch" data-on="" />
        </span>
      </div>
      <div className="fl-mock-body">
        {ROWS.map((r) => (
          <div key={r.collection} className="fl-mock-row">
            <span className="fl-mock-row-text">
              <span className="fl-mock-name">{r.label}</span>
              <span className="fl-mock-sub">{r.collection}</span>
            </span>
            <ArrowRight size={13} className="fl-redirect-arrow" />
            <span className="fl-chip">
              <span className="fl-mock-icon" data-size="s" aria-hidden>
                {r.icon}
              </span>
              {r.client}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
