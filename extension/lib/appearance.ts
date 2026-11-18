import type { Prefs } from './prefs';

// The last applied appearance, cached per extension origin so the popup and
// settings page can paint in the right theme before prefs load from storage.
const CACHE_KEY = 'aturi.appearance';

type Appearance = Pick<Prefs, 'theme' | 'fontSize'>;

const FONT_SIZES: readonly string[] = ['small', 'medium', 'large', 'xlarge'];

/**
 * Apply the user's theme and font-size preferences to the document by writing
 * `data-theme` and `data-fs` attributes onto `<html>`. CSS variable overrides
 * for each preset live in `entrypoints/shared.css`.
 */
export function applyAppearance(prefs: Appearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = prefs.theme ?? 'light';
  root.dataset.fs = prefs.fontSize ?? 'medium';
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: root.dataset.theme, fontSize: root.dataset.fs }));
  } catch {
    /* storage unavailable: the page still themes once prefs load */
  }
}

/**
 * Apply the appearance cached by the last `applyAppearance` call, synchronously,
 * before React renders. Without it the page paints the light defaults first and
 * dark-theme users see a light flash while prefs load.
 */
export function applyCachedAppearance(): void {
  if (typeof document === 'undefined') return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as Partial<Appearance>;
    const root = document.documentElement;
    if (cached.theme === 'dark' || cached.theme === 'light') root.dataset.theme = cached.theme;
    if (cached.fontSize && FONT_SIZES.includes(cached.fontSize)) root.dataset.fs = cached.fontSize;
  } catch {
    /* no cache or unreadable: fall back to the light defaults */
  }
}
