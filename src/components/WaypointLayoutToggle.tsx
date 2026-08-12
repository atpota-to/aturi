'use client';

import { LayoutGrid, List, Rows3 } from 'lucide-react';
import { usePreferences } from './PreferencesProvider';
import { setWaypointLayout, type WaypointLayout } from '@/utils/preferences';

/**
 * The three layouts, in the order they're offered. Values are the stored
 * preference; the labels are what the user sees, so they describe the shape
 * rather than the implementation (`dense` reads as "Compact").
 */
export const WAYPOINT_LAYOUT_OPTIONS: Array<{
  value: WaypointLayout;
  label: string;
  hint: string;
  Icon: typeof List;
}> = [
  { value: 'dense', label: 'Compact', hint: 'One line per waypoint', Icon: List },
  { value: 'grid', label: 'Grid', hint: 'Icon tiles, names only', Icon: LayoutGrid },
  { value: 'classic', label: 'Cards', hint: 'Full cards with descriptions', Icon: Rows3 },
];

type WaypointLayoutToggleProps = {
  /**
   * `icons` is the in-picker control — marks only, labelled for screen
   * readers. `labels` is the settings row, where there's room for the words.
   */
  variant?: 'icons' | 'labels';
};

/**
 * Switches the picker between its three layouts. Writes straight to
 * preferences, so the choice is instant locally and rides the existing
 * debounced PDS sync to the user's other devices.
 */
export default function WaypointLayoutToggle({
  variant = 'icons',
}: WaypointLayoutToggleProps) {
  const { prefs, update } = usePreferences();

  return (
    <div
      role="radiogroup"
      aria-label="Waypoint layout"
      className={`waypoint-layout-toggle${variant === 'labels' ? ' is-labelled' : ''}`}
    >
      {WAYPOINT_LAYOUT_OPTIONS.map(({ value, label, hint, Icon }) => {
        const active = prefs.waypointLayout === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={variant === 'icons' ? `${label} layout — ${hint}` : undefined}
            title={`${label} — ${hint}`}
            className={`waypoint-layout-option${active ? ' is-active' : ''}`}
            onClick={() => update((p) => setWaypointLayout(p, value))}
          >
            <Icon size={16} aria-hidden="true" />
            {variant === 'labels' && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
