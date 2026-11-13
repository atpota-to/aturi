export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'aturi.theme';
export const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage can throw in private modes; ignore.
  }
}

let themeFadeTimer: ReturnType<typeof setTimeout> | undefined;

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // A real switch (not ThemeSync re-applying the same theme on mount) eases
  // every colour across to the new theme instead of swapping in one frame:
  // `data-theme-fade` turns on a colour transition for everything
  // (motion.css, "Theme switch") just long enough to cover it. Skipped for
  // reduced motion, which this module reads off the attribute directly.
  if (root.dataset.theme !== theme && root.getAttribute('data-reduce-motion') !== 'true') {
    root.setAttribute('data-theme-fade', '');
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(() => root.removeAttribute('data-theme-fade'), 400);
  }
  root.dataset.theme = theme;
}

/**
 * Inline script body, stringified for injection into <head>. Runs before
 * React hydrates so the saved theme is applied without a flash. Falls back
 * to the default theme when localStorage is unavailable or unparseable.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='light')t='${DEFAULT_THEME}';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');}})();`;
