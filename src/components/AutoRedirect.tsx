import { buildAutoRedirectCandidates, type AutoRedirectContext } from '@/utils/autoRedirect';
import { buildAutoRedirectScript } from '@/lib/autoRedirectShim';
import { getSiteUrl } from '@/lib/config';

/**
 * The pre-paint half of auto-redirect for one universal-link page.
 *
 * Render this as early in a waypoint page's markup as possible — the inline
 * script only beats the picker to the screen if the parser reaches it first,
 * which on the profile and record routes means outside the Suspense boundary.
 * It emits two things: the script, carrying every built-in destination that can
 * open this record (resolved here through the catalog's real `getUrl`), and the
 * shim the visitor sees while the browser navigates, present in the initial
 * HTML so it needs no JavaScript to appear.
 *
 * Always pair it with `<AutoRedirectGate>` inside the page's content
 * container. The gate handles custom waypoints and late-arriving preferences,
 * un-hides the page when nothing is happening, and is where the "we didn't
 * redirect you" notice belongs — which is why the two are placed separately
 * rather than nested. If the gate is ever missing, the script's failsafe timer
 * still returns the page after `AUTO_REDIRECT_FAILSAFE_MS`.
 *
 * Nothing here is visible, and nothing occupies layout, unless a redirect is
 * actually pending.
 */
export default function AutoRedirect(props: AutoRedirectContext) {
  const candidates = buildAutoRedirectCandidates(props, selfHost());

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: buildAutoRedirectScript(candidates) }} />
      <div className="autoredirect-shim" role="status" aria-live="polite">
        Opening in your preferred client…
      </div>
    </>
  );
}

/**
 * The host this deployment answers on, so a waypoint pointing back at us is
 * never a redirect target. Must agree with the browser's `location.host` — the
 * gate filters candidates the same way, and a mismatch would let the script
 * redirect somewhere the gate would have refused.
 */
function selfHost(): string | undefined {
  try {
    return new URL(getSiteUrl()).host;
  } catch {
    return undefined;
  }
}
