'use client';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Identifier so the input + label can pair via `htmlFor`. */
  id: string;
}

/**
 * Settings toggle row — label + optional sub-line + switch on the right.
 * Visual style ported from the extension's `.aturi-switch`.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: ToggleProps) {
  return (
    <div className="settings-toggle-row">
      <label htmlFor={id} className="settings-toggle-label">
        <span className="settings-toggle-label-text">{label}</span>
        {description && (
          <span className="settings-toggle-label-sub">{description}</span>
        )}
      </label>
      <span className="settings-switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className="settings-switch-box" aria-hidden="true" />
      </span>
    </div>
  );
}
