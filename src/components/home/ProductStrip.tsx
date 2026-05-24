'use client';

import type { ReactNode } from 'react';

type Props = {
  /** Left or top slot — typically the marketing copy. */
  copy: ReactNode;
  /** Right or bottom slot — typically the live or static demo. */
  demo: ReactNode;
  /**
   * When true, the demo sits on the left and the copy on the right
   * (visual rhythm alternation). Mobile always stacks demo above copy
   * regardless of this flag, for consistency.
   */
  flip?: boolean;
  /**
   * Tag for accessibility — gives the strip an aria-label and serves
   * as a stable id-hint for in-page anchors if we add them later.
   */
  label: string;
};

/**
 * Generic two-column homepage strip used to anchor each product. Desktop
 * splits 12fr / 12fr (copy / demo); mobile collapses to a single column
 * with the demo above the copy.
 */
export default function ProductStrip({ copy, demo, flip, label }: Props) {
  return (
    <section
      aria-label={label}
      className="home-product-strip"
      data-flip={flip ? '' : undefined}
    >
      <div className="home-product-strip-demo">{demo}</div>
      <div className="home-product-strip-copy">{copy}</div>
    </section>
  );
}
