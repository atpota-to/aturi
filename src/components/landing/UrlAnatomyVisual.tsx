'use client';

import { Link2 } from 'lucide-react';

type Part = {
  text: string;
  label: string;
  hint: string;
  /** Colour token used for the label dot + underline. */
  accent: string;
  /** Text colour for the segment, when the accent is a fill colour too
   *  dark to read as text in dark mode. Defaults to the accent. */
  fg?: string;
};

const PARTS: Part[] = [
  {
    text: 'aturi.to',
    label: 'Domain',
    hint: 'The universal link host. Aliases for atpota.to are also supported.',
    accent: 'var(--text-tertiary)',
  },
  {
    text: '/profile',
    label: 'Mount',
    hint: 'The canonical mount point. Bare paths without /profile/ resolve too, for backwards compatibility.',
    accent: 'var(--text-secondary)',
  },
  {
    text: '/aturi.to',
    label: 'Handle or DID',
    hint: 'Resolved to a PDS via the standard atproto identity chain.',
    accent: 'var(--text-accent)',
  },
  {
    text: '/app.bsky.feed.post',
    label: 'Collection',
    hint: 'The lexicon NSID of the record being linked.',
    // The dot and underline too: the moss fill nearly vanishes on the dark
    // strip, and the lifted tone is the same moss in light mode.
    accent: 'var(--fl-anatomy-fill-fg)',
  },
  {
    text: '/3lq9c2fhz3k2v',
    label: 'Record key',
    hint: 'The TID assigned by the PDS when the record was written.',
    accent: 'var(--text-primary)',
  },
];

/**
 * Annotated breakdown of an aturi.to URL. Used on the /universal-links
 * landing page to teach the structure of the URL pattern at a glance —
 * which segments are required, what each one means, and why the same
 * pattern works for every lexicon.
 */
export default function UrlAnatomyVisual() {
  return (
    <div className="fl-mock fl-anatomy" data-size="l">
      {/* The URL itself, with each segment underlined in its own tone. */}
      <div className="fl-anatomy-url" aria-label="aturi.to URL anatomy">
        <Link2 size={14} className="fl-accent" aria-hidden />
        {PARTS.map((p) => (
          <span
            key={p.label}
            className="fl-anatomy-seg"
            style={{ '--part': p.accent, '--part-fg': p.fg ?? p.accent } as React.CSSProperties}
          >
            {p.text}
          </span>
        ))}
      </div>

      {/* Annotation rows */}
      <dl className="fl-anatomy-list">
        {PARTS.map((p) => (
          <div
            key={p.label}
            className="fl-anatomy-item"
            style={{ '--part': p.accent } as React.CSSProperties}
          >
            <dt>
              <span className="fl-anatomy-dot" aria-hidden />
              {p.label}
            </dt>
            <dd>{p.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
