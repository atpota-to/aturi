'use client';

import { Check, ExternalLink, Minus } from 'lucide-react';
import type { Waypoint } from '@/utils/waypoints';
import { waypointBlurb, waypointDomain } from '@/utils/onboardingQuestions';

type Props = {
  /** Unique within the page; becomes the radio group's `name`. */
  name: string;
  /** Accessible name for the group: the question being answered. */
  label: string;
  options: Waypoint[];
  /** Currently chosen waypoint id, or null for "no preference". */
  selectedId: string | null;
  onSelect: (waypointId: string | null) => void;
  /**
   * When known, each option gets a preview link pointed at this account, so
   * the choice can be made by looking at a real page instead of a name.
   */
  previewHandle?: string | null;
  previewDid?: string | null;
};

/**
 * The apps that can open one kind of record, as a radio group.
 *
 * Built on real `<input type="radio">` elements inside `<label>`s rather than
 * ARIA-annotated buttons: that buys arrow-key navigation, a single tab stop
 * for the whole group, and form semantics for free. It also lets each row
 * carry a genuine `<a>` for the preview link, since the HTML spec skips a
 * label's activation behavior for events targeted at interactive descendants,
 * so following the link can't also change the answer.
 */
export default function ClientChoice({
  name,
  label,
  options,
  selectedId,
  onSelect,
  previewHandle,
  previewDid,
}: Props) {
  return (
    <fieldset className="client-choice-set">
      <legend className="sr-only">{label}</legend>
      <div className="client-choice">
        {options.map((waypoint) => (
          <Option
            key={waypoint.id}
            name={name}
            waypoint={waypoint}
            selected={selectedId === waypoint.id}
            onSelect={() => onSelect(waypoint.id)}
            previewHandle={previewHandle}
            previewDid={previewDid}
          />
        ))}

        {/* An undo, not a tenth option. An unanswered question and an explicit
            "no preference" produce the same thing (no rule), so offering both
            as radios would put a checkmark on a question nobody answered. The
            row appears once there is an answer to take back; before that, the
            step's own Skip button is the way past. */}
        {selectedId !== null && (
          <button type="button" className="client-option is-clear" onClick={() => onSelect(null)}>
            <span className="client-option-icon" aria-hidden>
              <Minus size={18} />
            </span>
            <span className="client-option-body">
              <span className="client-option-name">Clear this answer</span>
              <span className="client-option-blurb">
                Hand the question back to Aturi&apos;s own recommendations.
              </span>
            </span>
          </button>
        )}
      </div>
    </fieldset>
  );
}

function Option({
  name,
  waypoint,
  selected,
  onSelect,
  previewHandle,
  previewDid,
}: {
  name: string;
  waypoint: Waypoint;
  selected: boolean;
  onSelect: () => void;
  previewHandle?: string | null;
  previewDid?: string | null;
}) {
  const domain = waypointDomain(waypoint);
  // Preview against the signed-in account's own profile: the quickest way to
  // judge a reader you have never opened. Only offered when we know who to
  // point it at, and only for waypoints that build a profile URL at all
  // (Offprint and pckt are record-only, so they get no preview).
  const previewUrl =
    previewHandle || previewDid
      ? waypoint.getUrl(
          previewHandle || previewDid || '',
          undefined,
          undefined,
          previewDid || undefined,
        )
      : null;

  return (
    <label className={`client-option ${selected ? 'is-selected' : ''}`}>
      <input
        type="radio"
        className="client-option-input"
        name={name}
        value={waypoint.id}
        checked={selected}
        onChange={onSelect}
      />
      <span className="client-option-icon" aria-hidden>
        {waypoint.icon}
      </span>
      <span className="client-option-body">
        <span className="client-option-name">
          {waypoint.name}
          {domain && <span className="client-option-domain">{domain}</span>}
        </span>
        <span className="client-option-blurb">{waypointBlurb(waypoint)}</span>
      </span>

      {previewUrl && (
        <a
          className="client-option-preview"
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={13} aria-hidden />
          <span className="client-option-preview-label">preview</span>
          <span className="sr-only">{waypoint.name}, opens in a new tab</span>
        </a>
      )}

      <span className="client-option-check" aria-hidden>
        <Check size={16} />
      </span>
    </label>
  );
}
