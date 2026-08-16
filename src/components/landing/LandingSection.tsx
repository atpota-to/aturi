import type { ReactNode } from 'react';

type Props = {
  /**
   * Rendered as the section's h2. Names what the section holds; it is
   * the section's accessible name, which is why there is no `id` or
   * `aria-label` prop.
   */
  title: string;
  /**
   * The only hierarchy control on a marketing page. `loud` is the
   * two-column row with the visual at full column width; `quiet` is one
   * column with the copy first and the visual, if any, as a compact row
   * beneath it. One `loud` section per page at most — when every section
   * is loud the page reads as a list of equally-important claims.
   */
  tone?: 'loud' | 'quiet';
  /**
   * Omit entirely for a plain-text section. Passing this is what makes
   * the section count against the page's visual budget.
   */
  visual?: ReactNode;
  /** `loud` only: moves the visual to the left column. Ignored when quiet. */
  flip?: boolean;
  /** One <p>, optionally followed by one link or button. */
  children: ReactNode;
};

/**
 * The single section shape used by home, /links, /extension and /explore.
 * It replaces FeatureSection and ProductStrip, which drew the same thing
 * with different gaps, heading sizes and mobile ordering, so the homepage
 * and the landing pages stop being two systems.
 *
 * Copy comes first in the DOM, so screen readers and every mobile
 * viewport get heading, then sentence, then picture. That is a change
 * from ProductStrip, which stacked the demo above the copy on mobile.
 * On desktop `flip` puts the visual back on the left via `order: -1`.
 *
 * Font sizes live in `.landing-section-*` in globals.css rather than
 * inline, so a new section cannot invent its own heading weight. There
 * is no badge prop: badges are hero-only, and the hero is hand-built on
 * each page rather than being a LandingSection.
 */
export default function LandingSection({ title, tone = 'quiet', visual, flip, children }: Props) {
  return (
    <section
      className="landing-section"
      data-tone={tone}
      data-flip={flip && tone === 'loud' ? '' : undefined}
    >
      <div className="landing-section-copy">
        <h2 className="landing-section-title">{title}</h2>
        <div className="landing-section-body">{children}</div>
      </div>
      {visual ? <div className="landing-section-visual">{visual}</div> : null}
    </section>
  );
}
