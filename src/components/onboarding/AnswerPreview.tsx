'use client';

import { CornerDownRight } from 'lucide-react';
import { WAYPOINT_DESTINATIONS } from '@/utils/waypoints';
import type { SetupQuestion } from '@/utils/onboardingQuestions';

/** Stand-in when nobody's signed in, so the shape of the URL is still real. */
const SAMPLE_HANDLE = 'alice.bsky.social';

type Props = {
  question: SetupQuestion;
  /** The chosen waypoint id, or null while the question is unanswered. */
  selectedId: string | null;
  /** The signed-in user's handle, when there is one. */
  handle?: string | null;
  did?: string | null;
};

/**
 * The consequence of the answer, spelled out as the URL it produces.
 *
 * The rest of the step describes what will happen; this shows it. A person
 * who has never heard of Blacksky learns more from
 * `blackskyweb.xyz/profile/…/post/…` than from any sentence about defaults,
 * and seeing the link built from a real record makes it obvious that the
 * setting does something concrete rather than expressing a mood.
 */
export default function AnswerPreview({ question, selectedId, handle, did }: Props) {
  if (!selectedId) return null;
  const waypoint = WAYPOINT_DESTINATIONS[selectedId];
  if (!waypoint) return null;

  const actor = handle || SAMPLE_HANDLE;
  const url = waypoint.getUrl(
    actor,
    question.example.collection,
    question.example.rkey,
    did || undefined,
  );
  if (!url) return null;

  return (
    <p className="answer-preview">
      <CornerDownRight size={13} aria-hidden />
      <span>
        A shared {question.noun === 'everything else' ? 'record' : question.noun.replace(/s$/, '')}{' '}
        link will open{' '}
        <code>{url.replace(/^https?:\/\//, '')}</code>
      </span>
    </p>
  );
}
