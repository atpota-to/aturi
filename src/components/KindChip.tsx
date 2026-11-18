'use client';

import { inputKind } from '@/lib/inputKind';

/**
 * Names what a search field's text looks like ("Handle", "DID", "at:// URI",
 * "URL", "PDS") at the field's right end. Keyed by kind, so each new reading
 * rises in on its own (motion.css, "Search fields"). The slot is a polite
 * live region and only its text changes, so a screen reader hears the kind
 * once when it changes, not on every keystroke.
 */
export default function KindChip({ value }: { value: string }) {
  const kind = inputKind(value);
  return (
    <span className="fn-kind-slot" aria-live="polite">
      {kind && (
        <span key={kind} className="fn-kind-chip">
          {kind}
        </span>
      )}
    </span>
  );
}
