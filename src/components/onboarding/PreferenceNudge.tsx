'use client';

import { Check, X } from 'lucide-react';
import type { Waypoint } from '@/utils/waypoints';
import type { SetupQuestion } from '@/utils/onboardingQuestions';

type Props = {
  question: SetupQuestion;
  waypoint: Waypoint;
  /** True when a different client is already the answer for this question. */
  replacing: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * The offer that appears after someone opens a record in a client: make that
 * client the default for this kind of record.
 *
 * This is the moment the whole preference system is trying to reach, and it
 * costs one click rather than six steps. The guided setup asks the same
 * question in the abstract, before the user has any reason to care; this asks
 * it about a choice they have just made on purpose.
 */
export default function PreferenceNudge({
  question,
  waypoint,
  replacing,
  onAccept,
  onDecline,
}: Props) {
  return (
    <div role="status" className="preference-nudge">
      <span className="preference-nudge-icon" aria-hidden>
        {waypoint.icon}
      </span>

      <span className="preference-nudge-text">
        Opened in <strong>{waypoint.name}</strong>.{' '}
        {replacing
          ? `You keep choosing it over ${replacing} for ${question.noun}. Switch?`
          : `Open ${question.noun} there from now on?`}
      </span>

      <span className="preference-nudge-actions">
        <button type="button" className="preference-nudge-accept" onClick={onAccept}>
          <Check size={14} aria-hidden />
          {replacing ? 'Switch' : 'Yes'}
        </button>
        <button
          type="button"
          className="preference-nudge-decline"
          onClick={onDecline}
          aria-label="Don't ask about this again"
          title="Don't ask again"
        >
          <X size={15} />
        </button>
      </span>
    </div>
  );
}
