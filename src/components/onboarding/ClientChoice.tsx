'use client';

import { Check, ExternalLink, Minus } from 'lucide-react';
import type { Waypoint } from '@/utils/waypoints';
import { waypointBlurb, waypointDomain } from '@/utils/onboardingQuestions';

type Props = {
  /** Accessible name for the group — the question being answered. */
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
 * Radio grid of the apps that can open one kind of record. Used by the guided
 * setup; the Clients settings tab renders the same choice as a select, since
 * there it sits inside a dense list of rules rather than being the whole
 * screen.
 */
export default function ClientChoice({
  label,
  options,
  selectedId,
  onSelect,
  previewHandle,
  previewDid,
}: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="client-choice">
      {options.map((waypoint) => (
        <Option
          key={waypoint.id}
          waypoint={waypoint}
          selected={selectedId === waypoint.id}
          onSelect={() => onSelect(waypoint.id)}
          previewHandle={previewHandle}
          previewDid={previewDid}
        />
      ))}

      <button
        type="button"
        role="radio"
        aria-checked={selectedId === null}
        onClick={() => onSelect(null)}
        className={`client-option is-neutral ${selectedId === null ? 'is-selected' : ''}`}
      >
        <span className="client-option-icon" aria-hidden>
          <Minus size={18} />
        </span>
        <span className="client-option-body">
          <span className="client-option-name">No preference</span>
          <span className="client-option-blurb">
            Leave this one to Aturi&apos;s own recommendations.
          </span>
        </span>
        {selectedId === null && (
          <span className="client-option-check" aria-hidden>
            <Check size={16} />
          </span>
        )}
      </button>
    </div>
  );
}

function Option({
  waypoint,
  selected,
  onSelect,
  previewHandle,
  previewDid,
}: {
  waypoint: Waypoint;
  selected: boolean;
  onSelect: () => void;
  previewHandle?: string | null;
  previewDid?: string | null;
}) {
  const domain = waypointDomain(waypoint);
  // Preview against the signed-in account's own profile — the quickest way to
  // judge a reader you've never opened. Only offered when we know who to point
  // it at; an anonymous visitor gets the description alone.
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
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`client-option ${selected ? 'is-selected' : ''}`}
    >
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
        // A nested <a> inside a <button> is invalid markup, so this carries
        // link semantics explicitly. It opens the page without changing the
        // answer.
        <span
          role="link"
          tabIndex={0}
          className="client-option-preview"
          title={`Open ${waypoint.name} in a new tab`}
          onClick={(e) => {
            e.stopPropagation();
            window.open(previewUrl, '_blank', 'noopener,noreferrer');
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            window.open(previewUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          <ExternalLink size={13} aria-hidden />
          <span className="client-option-preview-label">preview</span>
        </span>
      )}

      {selected && (
        <span className="client-option-check" aria-hidden>
          <Check size={16} />
        </span>
      )}
    </button>
  );
}
