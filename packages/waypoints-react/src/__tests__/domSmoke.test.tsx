// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaypointPicker } from '../WaypointPicker';

/*
 * Baseline that the DOM harness itself works: if this file fails, the jsdom
 * environment or the React 19 / testing-library wiring broke, not the picker.
 */

afterEach(cleanup);

describe('picker in a DOM', () => {
  it('mounts and renders rows', () => {
    const { container } = render(
      <WaypointPicker type="profile" handle="alice.example.com" />,
    );
    expect(
      container.querySelectorAll('[data-aturi-wp="button"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Open profile for @alice\.example\.com/),
    ).toBeTruthy();
  });

  it('collapses a category when its disclosure is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WaypointPicker type="profile" handle="alice.example.com" />,
    );
    const header = container.querySelector<HTMLButtonElement>(
      '[data-aturi-wp="category-header"]',
    );
    expect(header).toBeTruthy();
    expect(header!.getAttribute('aria-expanded')).toBe('true');
    await user.click(header!);
    expect(header!.getAttribute('aria-expanded')).toBe('false');
  });
});
