// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaypointPicker } from '../WaypointPicker';

/*
 * Regression guard for keyboard operation of a row.
 *
 * The defect this exists for: the row was a `role="button"` div with no
 * tabIndex and no key handler, so the documented `onSelect` prop was reachable
 * by pointer only. A keyboard user tabbed straight past the row's primary
 * action into the copy/open controls and silently got un-overridden navigation
 * instead of the consumer's intended behavior.
 *
 * The assertions are deliberately structural rather than selector-coupled:
 * "the first focusable thing inside a row is that row's primary action" is the
 * contract, whatever attribute the implementation hangs it on.
 */

afterEach(cleanup);

/** Tab forward until focus lands inside `scope`, or give up. */
async function tabInto(
  user: ReturnType<typeof userEvent.setup>,
  scope: Element,
  maxTabs = 40,
): Promise<HTMLElement | null> {
  for (let i = 0; i < maxTabs; i += 1) {
    await user.tab();
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && scope.contains(active)) {
      return active;
    }
  }
  return null;
}

/** Accessible name, near enough for a control whose label is text or aria-label. */
function name(el: HTMLElement): string {
  return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
}

function firstRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>('[data-aturi-wp="button"]');
  if (!row) throw new Error('no waypoint row rendered');
  return row;
}

describe('keyboard', () => {
  it('reaches a row by Tab and lands on its primary action first', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        waypointIds={['bluesky']}
        showRecommended={false}
      />,
    );

    const row = firstRow(container);
    const focused = await tabInto(user, row);

    expect(focused, 'no element inside the row is reachable by Tab').not.toBe(
      null,
    );
    // The primary action comes before the copy control in focus order —
    // otherwise the first thing a keyboard user hits is "Copy link".
    expect(focused!.getAttribute('data-aturi-wp')).not.toBe('copy');
    expect(name(focused!)).toBe('Bluesky');
  });

  it('activates onSelect with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        waypointIds={['bluesky']}
        showRecommended={false}
        onSelect={onSelect}
      />,
    );

    const row = firstRow(container);
    const focused = await tabInto(user, row);
    expect(focused).not.toBe(null);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: 'bluesky' });
  });

  it('makes the default primary action a real link to the destination', async () => {
    // With no onSelect the row must be an anchor, not a scripted click target:
    // that is what makes Enter, middle-click, "open in new tab" and the
    // context menu work without the component reimplementing any of them.
    const user = userEvent.setup();
    const { container } = render(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        waypointIds={['bluesky']}
        showRecommended={false}
      />,
    );

    const row = firstRow(container);
    const focused = await tabInto(user, row);
    expect(focused).not.toBe(null);
    expect(focused!.tagName).toBe('A');
    expect(focused!.getAttribute('href')).toContain('alice.example.com');
  });

  it('does not put a nested interactive role on the row container', async () => {
    const { container } = render(
      <WaypointPicker type="profile" handle="alice.example.com" />,
    );
    const rows = container.querySelectorAll('[data-aturi-wp="button"]');
    expect(rows.length).toBeGreaterThan(0);
    const withRole = [...rows].filter((r) => r.hasAttribute('role'));
    expect(withRole).toEqual([]);
  });
});
