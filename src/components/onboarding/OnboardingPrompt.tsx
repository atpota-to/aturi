'use client';

import Link from 'next/link';
import { Compass, X } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { markOnboardingDismissed, shouldOfferOnboarding } from '@/utils/preferences';
import { answerFor, setupEntryHash, setupQuestions } from '@/utils/onboardingQuestions';

/**
 * Invitation into the guided setup. Renders nothing once the user has either
 * finished the flow or waved it away, and because that state lives in the
 * synced preferences record, finishing on one device retires the invitation
 * everywhere rather than on that browser alone.
 *
 * The pitch depends on how far along they are. Someone with no rules at all
 * gets told what the setup is for; someone who answered two questions and
 * wandered off gets told what is left, and the link drops them on it rather
 * than back at the introduction.
 *
 * Deliberately one quiet row either way. A first-time visitor who arrived
 * from someone else's shared link is trying to read that link, not configure
 * an app.
 */
export default function OnboardingPrompt({ compact = false }: { compact?: boolean }) {
  const { prefs, update, loading } = usePreferences();

  // Wait for prefs to settle: rendering on the first tick would flash the
  // invitation at people who finished setup months ago.
  if (loading || !shouldOfferOnboarding(prefs)) return null;

  const questions = setupQuestions();
  const remaining = questions.filter((q) => !answerFor(prefs, q)).length;
  const started = remaining < questions.length;

  return (
    <div role="status" className={`onboarding-prompt ${compact ? 'is-compact' : ''}`}>
      <span className="onboarding-prompt-icon" aria-hidden>
        <Compass size={16} />
      </span>

      <span className="onboarding-prompt-text">
        {started ? (
          <>
            Setup is part done.{' '}
            <strong>
              {remaining} question{remaining === 1 ? '' : 's'} left
            </strong>{' '}
            before every kind of link opens where you want it.
          </>
        ) : (
          <>
            Shared links open in whichever client Aturi lists first.{' '}
            <strong>Answer {questions.length} questions</strong> and
            they&apos;ll open in yours.
          </>
        )}
      </span>

      <span className="onboarding-prompt-actions">
        <Link
          href={`/welcome#${setupEntryHash(prefs)}`}
          className="onboarding-prompt-cta"
        >
          {started ? 'Pick up' : 'Set up'}
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
