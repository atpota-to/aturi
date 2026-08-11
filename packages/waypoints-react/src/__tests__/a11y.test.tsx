// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { WaypointPicker } from '../WaypointPicker';

/*
 * Regression guard for the picker's structural accessibility.
 *
 * The defect this exists for: rows were `role="button"` divs, each wrapping a
 * real <button> and a real <a> — axe's `nested-interactive` rule, Serious. It
 * shipped for two releases because `tsc --noEmit` was the only gate on this
 * package, and a type checker cannot see an ARIA role.
 *
 * Scope is deliberately structural. jsdom does no layout, so the rules that
 * need real geometry or painted color cannot produce a trustworthy verdict
 * here; `color-contrast` in particular is disabled rather than left to report
 * `incomplete`. Contrast is checked by eye and by the token values in
 * styles.css, not by this suite.
 */

afterEach(cleanup);

const DISABLED_RULES = {
  // Needs layout + painted pixels, which jsdom does not provide.
  'color-contrast': { enabled: false },
  // Both are about the surrounding document, not the embedded widget.
  region: { enabled: false },
  'page-has-heading-one': { enabled: false },
};

type Violation = {
  id: string;
  impact: string | null | undefined;
  nodes: { html: string }[];
};

async function seriousViolations(node: Element): Promise<Violation[]> {
  const results = await axe.run(node, { rules: DISABLED_RULES });
  return results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  ) as Violation[];
}

/** Readable failure output: axe's raw result object is unusable in a diff. */
function summarize(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.html?.slice(0, 120)}`,
    )
    .join('\n');
}

describe('axe', () => {
  it('reports no serious or critical violations for a profile picker', async () => {
    const { container } = render(
      <WaypointPicker type="profile" handle="alice.example.com" />,
    );
    const violations = await seriousViolations(container);
    expect(summarize(violations)).toBe('');
  }, 30_000);

  it('reports no serious or critical violations for a record picker', async () => {
    const { container } = render(
      <WaypointPicker
        type="record"
        handle="alice.example.com"
        collection="app.bsky.feed.post"
        rkey="3k1abcdefgh"
      />,
    );
    const violations = await seriousViolations(container);
    expect(summarize(violations)).toBe('');
  }, 30_000);

  it('reports no serious or critical violations with onSelect supplied', async () => {
    // The onSelect path swaps the row's primary action for a button; it needs
    // the same audit as the default anchor path.
    const { container } = render(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        onSelect={() => {}}
      />,
    );
    const violations = await seriousViolations(container);
    expect(summarize(violations)).toBe('');
  }, 30_000);

  it('gives each row an accessible name that is just the destination', async () => {
    // The run-on name — "BlueskyView profile on bsky.appOpen in Bluesky" —
    // came from putting the description and both controls inside the element
    // that carried the role. The description belongs in aria-describedby.
    const { container } = render(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        waypointIds={['bluesky']}
        showRecommended={false}
      />,
    );
    const row = container.querySelector('[data-aturi-wp="button"]');
    expect(row).toBeTruthy();

    // The row container must not be the named control itself — that is what
    // swept the description and both child controls into one name.
    expect(row!.getAttribute('role')).toBe(null);

    // Exactly one control in the row is named for the destination, and its
    // name is the destination and nothing else.
    const names = [...row!.querySelectorAll<HTMLElement>('a[href], button')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
    );
    expect(names).toContain('Bluesky');
    expect(names.filter((n) => n === 'Bluesky')).toHaveLength(1);
  });
});
