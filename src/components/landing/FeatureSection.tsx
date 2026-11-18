'use client';

import type { ReactNode } from 'react';

type Props = {
  badge: { icon: ReactNode; label: string };
  title: string;
  body: ReactNode;
  visual: ReactNode;
  /** When true, the visual sits on the right instead of the left. */
  flip?: boolean;
};

/**
 * Two-column feature row used on the product landing pages: a kicker,
 * heading and copy beside a mock of the feature. Styles live in
 * src/styles/fieldnotes/landing.css (.fl-feature).
 */
export default function FeatureSection({ badge, title, body, visual, flip }: Props) {
  return (
    <section className="fl-feature" data-flip={flip ? '' : undefined}>
      <div className="fl-feature-visual">{visual}</div>
      <div className="fl-feature-copy">
        <span className="fl-kicker">
          {badge.icon}
          {badge.label}
        </span>
        <h2 className="fl-h2">{title}</h2>
        <div className="fl-body">{body}</div>
      </div>
    </section>
  );
}
