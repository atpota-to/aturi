'use client';

import { Fragment } from 'react';
import { parseBinding, stepTokens, type Platform } from '@/lib/keybindings';

/**
 * Renders a binding string as styled `<kbd>` chips — one chip per key, a thin
 * `+` between keys in the same step, and the word "then" between the steps of
 * a chord (`g` then `h`). Styling lives in globals.css under `.kbd` / `.kbd-*`.
 */
export default function Kbd({
  binding,
  platform,
}: {
  binding: string;
  platform: Platform;
}) {
  // Each chip also carries the key's own name (`mod`, `k`) as data-key, so
  // it presses down while that key is held (KeyChipPress).
  const steps = parseBinding(binding).map((step) => ({
    names: step.split('+'),
    tokens: stepTokens(step, platform),
  }));
  if (steps.length === 0) return null;
  return (
    <span className="kbd-combo">
      {steps.map(({ names, tokens }, si) => (
        <Fragment key={si}>
          {si > 0 && <span className="kbd-then">then</span>}
          <span className="kbd-step">
            {tokens.map((tok, ti) => (
              <Fragment key={ti}>
                {ti > 0 && <span className="kbd-plus">+</span>}
                <kbd className="kbd" data-key={names[ti]}>
                  {tok}
                </kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Render every effective binding for a command, separated by "or". Falls back
 * to a muted "Not set" when the command is unbound.
 */
export function KbdList({
  bindings,
  platform,
}: {
  bindings: string[];
  platform: Platform;
}) {
  if (bindings.length === 0) {
    return <span className="kbd-unset">Not set</span>;
  }
  return (
    <span className="kbd-list">
      {bindings.map((b, i) => (
        <Fragment key={b}>
          {i > 0 && <span className="kbd-or">or</span>}
          <Kbd binding={b} platform={platform} />
        </Fragment>
      ))}
    </span>
  );
}
