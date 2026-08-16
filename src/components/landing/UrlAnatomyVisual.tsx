'use client';

import { Link2 } from 'lucide-react';

type Part = {
  text: string;
  label: string;
  hint: string;
  /** Color token used for the label + underline. */
  accent: string;
};

const PARTS: Part[] = [
  {
    text: 'aturi.to',
    label: 'Domain',
    hint: 'The universal link host.',
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
    accent: 'var(--accent-moss)',
  },
  {
    text: '/3lq9c2fhz3k2v',
    label: 'Record key',
    hint: 'Unique within the collection; usually a timestamp-ordered TID.',
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
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        // Capped so this reads as a figure under the copy rather than a
        // full-bleed block. Without it the flex item sizes to its content
        // and fills the 800px container, which would leave the page's quiet
        // section drawn wider than its loud one.
        maxWidth: '600px',
        width: '100%',
      }}
    >
      {/* The URL itself, with each segment underlined in its own color. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '1rem',
          flexWrap: 'wrap',
          rowGap: '0.5rem',
        }}
        aria-label="aturi.to URL anatomy"
      >
        <Link2 size={14} style={{ color: 'var(--text-accent)', flexShrink: 0 }} aria-hidden />
        {PARTS.map((p) => (
          <span
            key={p.label}
            style={{
              color: p.accent,
              borderBottom: `2px solid ${p.accent}`,
              paddingBottom: '2px',
              fontWeight: p.label === 'Domain' ? 400 : 500,
            }}
          >
            {p.text}
          </span>
        ))}
      </div>

      {/* Annotation rows */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
          gap: '0.875rem',
        }}
      >
        {PARTS.map((p) => (
          <div key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: p.accent,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  background: p.accent,
                  borderRadius: '50%',
                }}
                aria-hidden
              />
              {p.label}
            </div>
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              {p.hint}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
