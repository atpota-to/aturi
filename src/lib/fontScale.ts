export type FontScale = 'small' | 'default' | 'large' | 'xlarge';

export const FONT_SCALE_STORAGE_KEY = 'aturi.fontScale';
export const DEFAULT_FONT_SCALE: FontScale = 'default';

/**
 * Root font-size baseline in px. Matches `html { font-size: 16px; }` in
 * globals.css — the whole type scale is rem-based off this single value,
 * so scaling it scales the entire app's typography. Keep in sync with the
 * CSS if that base ever changes.
 */
export const FONT_SCALE_BASE_PX = 16;

/**
 * Multiplier applied to the base px for each preset. `default` is exactly
 * 1, so it resolves to the same 16px the CSS already sets — i.e. opting
 * into "Default" leaves the app-wide baseline unchanged.
 */
export const FONT_SCALE_FACTORS: Record<FontScale, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
  xlarge: 1.25,
};

export const FONT_SCALE_OPTIONS: ReadonlyArray<{
  value: FontScale;
  label: string;
}> = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra Large' },
];

export function isFontScale(value: unknown): value is FontScale {
  return (
    value === 'small' ||
    value === 'default' ||
    value === 'large' ||
    value === 'xlarge'
  );
}

export function getStoredFontScale(): FontScale {
  if (typeof window === 'undefined') return DEFAULT_FONT_SCALE;
  try {
    const raw = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return isFontScale(raw) ? raw : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function setStoredFontScale(scale: FontScale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, scale);
  } catch {
    // localStorage can throw in private modes; ignore.
  }
}

export function applyFontScale(scale: FontScale): void {
  if (typeof document === 'undefined') return;
  const factor = FONT_SCALE_FACTORS[scale] ?? 1;
  document.documentElement.style.fontSize = `${FONT_SCALE_BASE_PX * factor}px`;
  document.documentElement.dataset.fontScale = scale;
}

/**
 * Inline script body, stringified for injection into <head>. Runs before
 * React hydrates so the saved font scale is applied without a reflow on
 * cold loads. Mirrors THEME_INIT_SCRIPT. The storage key and base px are
 * inlined as literals because this string executes standalone, with no
 * access to this module's exports. Falls back to the unscaled 16px base
 * when localStorage is unavailable or the stored value is unrecognised.
 */
export const FONT_SCALE_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${FONT_SCALE_STORAGE_KEY}');var f=s==='small'?0.9:s==='large'?1.1:s==='xlarge'?1.25:1;document.documentElement.style.fontSize=(16*f)+'px';}catch(e){document.documentElement.style.fontSize='16px';}})();`;
