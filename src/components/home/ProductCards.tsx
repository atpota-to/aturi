'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, Compass, Leaf, Link2 } from 'lucide-react';
import {
  WAYPOINT_DESTINATIONS,
  getWaypointCount,
  getWaypointsForType,
} from '@/utils/waypoints';

const DEMO_HANDLE = 'aturi.to';
const UNIVERSAL_LINK_HREF = `/profile/${DEMO_HANDLE}`;

/** Waypoints shown in the extension popup sketch, first one as the default. */
const POPUP_WAYPOINT_IDS = ['anisota', 'bluesky', 'reddwarf'];
/** How many client chips the universal-link sketch shows before "+N". */
const LINK_CHIP_COUNT = 5;

/** Sample repo tree for the explorer sketch: [namespace, records, state]. */
const TREE_ROWS: Array<{ ns: string; count?: number; state: 'closed' | 'open' | 'child' }> = [
  { ns: 'net.anisota', count: 37, state: 'closed' },
  { ns: 'is.dame', count: 23, state: 'closed' },
  { ns: 'app.bsky', count: 18, state: 'open' },
  { ns: 'feed.post', state: 'child' },
  { ns: 'sh.tangled', count: 11, state: 'closed' },
];

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

type Product = {
  id: string;
  kicker: string;
  title: string;
  copy: string;
  /** One-line version for the phone rows. */
  short: string;
  icon: ReactNode;
  href: string;
  linkLabel: string;
  /** Dynamic routes skip prefetch (AGENTS.md rule 7). */
  dynamic?: boolean;
  aside?: ReactNode;
  visual: ReactNode;
};

/**
 * The three products, as calm cards with a small sketch on top of each:
 * a row of three on desktop, the sketch beside the text on tablets, and a
 * list of tappable rows on phones (two renderings, toggled in home.css,
 * since a row and a card share nothing but their link).
 *
 * The sketches are pictures, hidden from assistive tech; the waypoint
 * names and marks in them come from the live catalog so they never
 * advertise a client aturi no longer lists.
 */
export default function ProductCards() {
  const waypointCount = getWaypointCount();
  const products: Product[] = [
    {
      id: 'ext',
      kicker: 'Browser extension',
      title: 'Jump between clients in one click, or zero',
      copy:
        'Click the leaf in your toolbar to open what you’re reading in another app, or let auto-redirect send links to your favorite client. The Inspect tab shows the record, PDS, DID and backlinks behind any page.',
      short: 'Jump between clients in a click. For Chrome and Firefox on desktop.',
      icon: <Leaf size={19} />,
      href: '/extension',
      linkLabel: 'How the extension works',
      aside: <span className="fn-home-card-aside">{waypointCount} curated clients</span>,
      visual: <PopupSketch />,
    },
    {
      id: 'exp',
      kicker: 'Atmosphere Explorer',
      title: 'Browse through any account’s data',
      copy:
        'Read every collection, record, and backlink on any PDS, with identity history and audit logs one tab away. Sign in to edit your own records and sync your preferences.',
      short: 'Browse any account’s collections, records, and backlinks.',
      icon: <Compass size={19} />,
      href: '/explore',
      linkLabel: 'Start exploring',
      visual: <TreeSketch />,
    },
    {
      id: 'links',
      kicker: 'Universal links',
      title: 'One link, every client',
      copy:
        'Share an aturi.to link and whoever opens it picks the app they like to read in. No lock-in, no login.',
      short: 'Share one link; readers open it in the app they like.',
      icon: <Link2 size={19} />,
      href: UNIVERSAL_LINK_HREF,
      linkLabel: 'See a universal link page',
      dynamic: true,
      visual: <LinkSketch />,
    },
  ];

  return (
    <>
      <div className="fn-home-products">
        {products.map((p) => (
          <section key={p.id} className="fn-card fn-home-product" aria-labelledby={`fn-home-${p.id}`}>
            <span className="fn-home-kicker">{p.kicker}</span>
            <h2 id={`fn-home-${p.id}`}>{p.title}</h2>
            <p>{p.copy}</p>
            <div className="fn-home-sketch" aria-hidden>
              {p.visual}
            </div>
            <div className="fn-home-product-foot">
              <Link
                href={p.href}
                prefetch={p.dynamic ? false : undefined}
                className="fn-home-textlink"
              >
                {p.linkLabel} <ChevronRight size={14} aria-hidden />
              </Link>
              {p.aside}
            </div>
          </section>
        ))}
      </div>

      {/* Phone layout: explorer first, matching the phone mockup's order. */}
      <nav aria-label="What aturi does" className="fn-home-rows">
        {[products[1], products[2], products[0]].map((p) => (
          <Link
            key={p.id}
            href={p.href}
            prefetch={p.dynamic ? false : undefined}
            className="fn-home-row"
          >
            <span className="fn-home-icon-tile" aria-hidden>
              {p.icon}
            </span>
            <span className="fn-home-row-text">
              <span className="fn-home-row-title">{p.kicker}</span>
              <span className="fn-home-row-desc">{p.short}</span>
            </span>
            <ChevronRight size={16} aria-hidden className="fn-home-row-chevron" />
          </Link>
        ))}
      </nav>
    </>
  );
}

function PopupSketch() {
  return (
    <div className="fn-sketch-popup">
      <div className="fn-sketch-popup-head">
        <span className="fn-sketch-brand">
          <Leaf size={14} />
          aturi
        </span>
        <span className="fn-mono">app.bsky.feed.post</span>
      </div>
      {POPUP_WAYPOINT_IDS.map((id, i) => {
        const w = WAYPOINT_DESTINATIONS[id];
        if (!w) return null;
        return (
          <div key={id} className="fn-sketch-popup-row" data-default={i === 0 ? '' : undefined}>
            <span className="fn-sketch-mark">{w.icon}</span>
            <span className="fn-sketch-popup-name">{w.name}</span>
            {i === 0 ? (
              <span className="fn-pill">Default</span>
            ) : (
              <span className="fn-mono">{hostOf(w.getUrl(DEMO_HANDLE))}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TreeSketch() {
  return (
    <div className="fn-sketch-tree">
      <span className="fn-mono fn-sketch-tree-path">pds.atpota.to / @dame.is</span>
      {TREE_ROWS.map((row) => (
        <span key={row.ns} className="fn-sketch-tree-row" data-state={row.state}>
          <ChevronRight size={11} strokeWidth={2.4} className="fn-sketch-tree-chev" />
          <span className="fn-sketch-tree-ns">{row.ns}</span>
          {row.count !== undefined && <span className="fn-sketch-tree-count">{row.count}</span>}
        </span>
      ))}
    </div>
  );
}

function LinkSketch() {
  const clients = getWaypointsForType('profile');
  const shown = clients.slice(0, LINK_CHIP_COUNT);
  const rest = clients.length - shown.length;
  return (
    <div className="fn-sketch-link">
      <span className="fn-sketch-link-url fn-mono">
        <Link2 size={13} />
        aturi.to/dame.is
      </span>
      <span className="fn-sketch-link-title">Open dame&rsquo;s profile in&hellip;</span>
      <div className="fn-sketch-link-chips">
        {shown.map((w, i) => (
          <span key={w.id} className="fn-sketch-chip" data-active={i === 0 ? '' : undefined}>
            {w.name}
          </span>
        ))}
        {rest > 0 && <span className="fn-sketch-chip" data-more="">+{rest}</span>}
      </div>
    </div>
  );
}
