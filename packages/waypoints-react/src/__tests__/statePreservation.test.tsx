// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaypointPicker } from '../WaypointPicker';
import { useWaypoints } from '../useWaypoints';

/*
 * Regression guard for expand/collapse state surviving a parent re-render.
 *
 * The defect this exists for: `useWaypoints` memoized on the identity of its
 * array props, so an inline `hiddenIds={['tangled']}` — exactly the shape the
 * README's prop table invites — produced a fresh `categories` array every
 * render. The picker seeded `expanded` from that array through an effect, so
 * any unrelated setState in the parent silently reopened every category the
 * user had collapsed.
 *
 * The arrays below are inline ON PURPOSE. Hoisting them to module scope is the
 * workaround that hides the bug, so doing it here would make the test vacuous.
 */

afterEach(cleanup);

/** Parent with its own state, so a re-render can be forced from outside. */
function Harness({ label }: { label: string }) {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        {label} {tick}
      </button>
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        hiddenIds={['tangled']}
        waypointIds={[
          'bluesky',
          'deer',
          'blacksky',
          'tangled',
          'pdsls',
          'atptools',
        ]}
        customWaypoints={[
          {
            id: 'test-custom',
            name: 'Test Custom',
            getUrl: (handle) => `https://example.test/${handle}`,
          },
        ]}
      />
    </div>
  );
}

function firstCategoryHeader(container: HTMLElement): HTMLButtonElement {
  const header = container.querySelector<HTMLButtonElement>(
    '[data-aturi-wp="category-header"]',
  );
  if (!header) throw new Error('no category header rendered');
  return header;
}

// SKIPPED: this is audit finding rank 5, which was not in the approved fix
// scope (high-severity findings + quick wins). The bug is real and verified —
// useWaypoints keys its memo on the identity of the `hiddenIds` /
// `waypointIds` / `customWaypoints` arrays, so an inline array literal (the
// shape every README example uses) invalidates it on every render, and
// WaypointPicker then re-seeds `expanded` from the derived default, silently
// re-opening categories the user collapsed. These assertions are correct and
// should start passing once the hook keys on primitives and the picker seeds
// its expansion state once. Remove `.skip` then.
describe.skip('expand/collapse state', () => {
  it('survives an unrelated parent re-render with inline array props', async () => {
    const user = userEvent.setup();
    const { container, getByRole } = render(<Harness label="rerender" />);

    const header = firstCategoryHeader(container);
    expect(header.getAttribute('aria-expanded')).toBe('true');

    await user.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    // Nothing about the picker's target changed — only the parent's own state.
    await user.click(getByRole('button', { name: /rerender/ }));
    await user.click(getByRole('button', { name: /rerender/ }));

    expect(
      firstCategoryHeader(container).getAttribute('aria-expanded'),
      'a collapsed category reopened itself on an unrelated parent render',
    ).toBe('false');
  });

  it('re-seeds expansion when the target actually changes', async () => {
    // The other half of the contract: state is sticky per target, not frozen
    // forever. Switching to a different record must recompute which categories
    // open, or the picker shows stale expansion for the new content.
    const user = userEvent.setup();

    function TargetSwitcher() {
      const [type, setType] = useState<'profile' | 'record'>('profile');
      return (
        <div>
          <button type="button" onClick={() => setType('record')}>
            switch
          </button>
          <WaypointPicker
            type={type}
            handle="alice.example.com"
            collection="app.bsky.feed.post"
            rkey="3k1abcdefgh"
            hiddenIds={['tangled']}
          />
        </div>
      );
    }

    const { container, getByRole } = render(<TargetSwitcher />);
    const header = firstCategoryHeader(container);
    await user.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    await user.click(getByRole('button', { name: 'switch' }));
    expect(firstCategoryHeader(container).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('returns a stable result object for equal primitive inputs', async () => {
    // The identity of the hook's return value is what every downstream memo,
    // effect and `React.memo` boundary keys off. Four renders with identical
    // inputs produced four distinct objects.
    const seen: unknown[] = [];

    function HookHarness() {
      const [tick, setTick] = useState(0);
      const result = useWaypoints({
        type: 'profile',
        handle: 'alice.example.com',
        hiddenIds: ['tangled'],
      });
      seen.push(result);
      return (
        <button type="button" onClick={() => setTick((t) => t + 1)}>
          tick {tick}
        </button>
      );
    }

    const user = userEvent.setup();
    const { getByRole } = render(<HookHarness />);
    await user.click(getByRole('button', { name: /tick/ }));
    await user.click(getByRole('button', { name: /tick/ }));

    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(1);
  });
});
