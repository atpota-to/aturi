'use client';

import { Lock } from 'lucide-react';

type Part = {
  text: string;
  label: string;
  hint: string;
  /** Color token used for the label + underline. */
  accent: string;
  /** Text colour for the segment, when the accent is a fill colour too
   *  dark to read as text in dark mode. Defaults to the accent. */
  fg?: string;
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
    fg: 'var(--fl-anatomy-fill-fg)',
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
    <div className="fl-mock fl-anatomy" data-size="l">
      {/* The address itself, with each segment underlined in its own tone. */}
      <div className="fl-anatomy-url" aria-label="Space AT URI anatomy">
        <Lock size={14} className="fl-accent" aria-hidden />
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
