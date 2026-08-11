'use client';

import Link from 'next/link';
import { Compass, X } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { markOnboardingDismissed, shouldOfferOnboarding } from '@/utils/preferences';
import { setupQuestions } from '@/utils/onboardingQuestions';

/**
 * Invitation into the guided setup. Renders nothing once the user has either
 * finished the flow or waved it away — and because that state lives in the
 * synced preferences record, finishing setup on one device retires the
 * invitation everywhere rather than on that browser alone.
 *
 * Deliberately one quiet row. Setup is optional, and a first-time visitor who
 * arrived from someone else's shared link is trying to read that link, not
 * configure an app.
 */
export default function OnboardingPrompt({ compact = false }: { compact?: boolean }) {
  const { prefs, update, loading } = usePreferences();

  // Wait for prefs to settle: rendering on the first tick would flash the
  // invitation at people who finished setup months ago.
  if (loading || !shouldOfferOnboarding(prefs)) return null;

  return (
    <div role="status" className={`onboarding-prompt ${compact ? 'is-compact' : ''}`}>
      <span className="onboarding-prompt-icon" aria-hidden>
        <Compass size={16} />
      </span>

      <span className="onboarding-prompt-text">
        Shared links open in whichever client Aturi lists first.{' '}
        <strong>Answer {setupQuestions().length} questions</strong> and they
        open in the apps you use.
      </span>

      <span className="onboarding-prompt-actions">
        <Link href="/welcome" className="onboarding-prompt-cta">
          Set up
        </Link>
        <button
          type="button"
          onClick={() => update(markOnboardingDismissed)}
          aria-label="Dismiss setup invitation"
          title="No thanks"
          className="onboarding-prompt-dismiss"
        >
          <X size={15} />
        </button>
      </span>
    </div>
  );
}
