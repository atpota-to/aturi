'use client';

import { Leaf, Settings } from 'lucide-react';
import { AnisotaLogo, BlueskySVG, DeerSVG } from '@/utils/waypointIcons';

const ROWS: { icon: React.ReactNode; name: string; host: string; featured?: boolean }[] = [
  { icon: <AnisotaLogo />, name: 'Anisota', host: 'anisota.net', featured: true },
  { icon: <BlueskySVG />, name: 'Bluesky', host: 'bsky.app' },
  { icon: <DeerSVG />, name: 'Deer', host: 'deer.social' },
];

/**
 * Hero visual for /extension: a browser window on a Bluesky post with the
 * extension popup open over it. Static, decorative mock in the Field
 * Notes popup's shape (aturi header, Open in / Inspect tabs, the post it
 * found, suggested clients, the auto-redirect switch).
 */
export default function ExtensionHeroVisual() {
  return (
    <div className="fl-browser" aria-hidden>
      <div className="fl-browser-bar">
        <span className="fl-browser-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="fl-browser-url fl-ellipsis">
          <span className="fl-faint">bsky.app</span>/profile/dame.is/post/3lq9c2fhz3k2v
        </span>
        <span className="fl-browser-leaf">
          <Leaf size={13} />
        </span>
      </div>
      <div className="fl-browser-page">
        <span className="fl-browser-line" data-w="40" />
        <span className="fl-browser-line" data-w="90" />
        <span className="fl-browser-line" data-w="75" />
        <span className="fl-browser-line" data-w="60" />
        <span className="fl-browser-line" data-w="85" />
      </div>
      <div className="fl-popup">
        <div className="fl-popup-head">
          <span className="fl-popup-brand">
            <Leaf size={14} /> aturi
          </span>
          <Settings size={13} className="fl-faint" />
        </div>
        <div className="fl-mock-tabs">
          <span className="fl-mock-tab" data-active="">
            Open in
          </span>
          <span className="fl-mock-tab">
            Inspect <span className="fl-count">3</span>
          </span>
        </div>
        <div className="fl-mock-body">
          <div className="fl-popup-context">
            <span className="fl-popup-avatar">d</span>
            <span className="fl-mock-row-text">
              <span className="fl-mock-name">Post by dame</span>
              <span className="fl-mock-sub">@dame.is · on bsky.app</span>
            </span>
          </div>
          <span className="fl-mock-label">Suggested</span>
          {ROWS.map((r) => (
            <div key={r.name} className="fl-mock-row" data-featured={r.featured ? '' : undefined}>
              <span className="fl-mock-icon">{r.icon}</span>
              <span className="fl-mock-row-text">
                <span className="fl-mock-name">{r.name}</span>
                <span className="fl-mock-sub">{r.host}</span>
              </span>
              {r.featured && <span className="fl-chip" data-on="">Default</span>}
            </div>
          ))}
        </div>
        <div className="fl-mock-foot">
          <span>Auto-redirect</span>
          <span className="fl-switch" data-on="" />
        </div>
      </div>
    </div>
  );
}
