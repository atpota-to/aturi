import type { Prefs } from './prefs';

/**
 * Apply the user's theme and font-size preferences to the document by writing
 * `data-theme` and `data-fs` attributes onto `<html>`. CSS variable overrides
 * for each preset live in `entrypoints/shared.css`.
 */
export function applyAppearance(prefs: Pick<Prefs, 'theme' | 'fontSize'>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = prefs.theme ?? 'dark';
  root.dataset.fs = prefs.fontSize ?? 'medium';
}
