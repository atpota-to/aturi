'use client';

import { Lock } from 'lucide-react';

type Part = {
  text: string;
  label: string;
  hint: string;
  /** Color token used for the label + underline. */
  accent: string;
};

const PARTS: Part[] = [
  {
    text: 'at://did:plc:52lt…',
    label: 'Authority',
    hint: 'The DID the space is anchored on. Whoever holds it decides who is a member.',
    accent: 'var(--text-accent)',
  },
  {
    text: '/space',
    label: 'Mount',
    hint: 'A literal segment. It sets a space address apart from a repo collection.',
    accent: 'var(--text-secondary)',
  },
  {
    text: '/my.bulletin.board',
    label: 'Space type',
    hint: 'An NSID naming the kind of space, defined by the app that creates them.',
    accent: 'var(--accent-moss)',
  },
  {
    text: '/self',
    label: 'Space key',
    hint: 'Tells spaces of the same type under one authority apart.',
    accent: 'var(--text-primary)',
  },
  {
    text: '/…',
    label: 'Deeper levels',
    hint: 'Author, collection, and record key narrow the address to one member, one record type, one record.',
    accent: 'var(--text-tertiary)',
  },
];

/**
 * Annotated breakdown of a space AT URI, the sibling of UrlAnatomyVisual on
 * the universal-links page. Used on /explore/spaces to show how a space
 * address is put together and that it extends past the space root down to a
 * single record.
 */
export default function SpaceUriAnatomyVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        transform: 'rotate(-0.3deg)',
      }}
    >
      {/* The address itself, with each segment underlined in its own color. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem',
          flexWrap: 'wrap',
          rowGap: '0.5rem',
        }}
        aria-label="Space AT URI anatomy"
      >
        <Lock size={14} style={{ color: 'var(--text-accent)', flexShrink: 0 }} aria-hidden />
        {PARTS.map((p) => (
          <span
            key={p.label}
            style={{
              color: p.accent,
              borderBottom: `2px solid ${p.accent}`,
              paddingBottom: '2px',
              fontWeight: p.label === 'Authority' ? 400 : 500,
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
