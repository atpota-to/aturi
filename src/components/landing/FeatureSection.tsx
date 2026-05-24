'use client';

import type { ReactNode } from 'react';

type Props = {
  badge: { icon: ReactNode; label: string };
  title: string;
  body: ReactNode;
  visual: ReactNode;
  /** When true, the visual sits on the left instead of the right. */
  flip?: boolean;
};

/**
 * Two-column feature row used on the product landing pages. Mirrors
 * ProductStrip from the homepage but lives outside the
 * `home-product-strip` flow so landing pages can stack many of them
 * without forking the homepage styles.
 */
export default function FeatureSection({ badge, title, body, visual, flip }: Props) {
  return (
    <section className="landing-feature" data-flip={flip ? '' : undefined}>
      <div className="landing-feature-visual">{visual}</div>
      <div className="landing-feature-copy">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.25rem 0.625rem',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-serif)',
            marginBottom: '0.875rem',
            lineHeight: 1,
          }}
        >
          {badge.icon}
          {badge.label}
        </span>
        <h2
          style={{
            fontSize: '1.75rem',
            fontWeight: 300,
            color: 'var(--text-primary)',
            margin: '0 0 0.875rem',
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1rem',
            lineHeight: 1.65,
          }}
          className="landing-feature-body"
        >
          {body}
        </div>
      </div>
    </section>
  );
}
