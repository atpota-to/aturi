/**
 * Color schemes — the hue family the whole app is painted in.
 *
 * This is a separate axis from `theme` (dark / light): every scheme has both
 * a dark and a light variant, so `data-scheme` and `data-theme` combine on
 * <html> to pick one of eight palettes. The token blocks live in
 * globals.css under `[data-theme='…'][data-scheme='…']`; `moss` is the
 * default and is defined by the base `:root` / `[data-theme='light']`
 * blocks, so it needs no overrides of its own.
 *
 * Unlike theme / font-scale / a11y — which are deliberately per-browser —
 * the chosen scheme is part of the user's synced preferences
 * (`to.aturi.actor.preferences`), so it follows them across devices. The
 * localStorage key here is only a pre-paint cache: `ColorSchemeSync` mirrors
 * the value out of preferences on every change so `COLOR_SCHEME_INIT_SCRIPT`
 * can apply it before first paint on the next cold load, well before the
 * preferences record has been read back from the PDS.
 */

export type ColorScheme =
  | 'moss'
  | 'ember'
  | 'tide'
  | 'dusk'
  | 'sol'
  | 'bloom'
  | 'trans'
  | 'noir';

export const COLOR_SCHEME_STORAGE_KEY = 'aturi.colorScheme';
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'moss';

export const COLOR_SCHEMES: ReadonlyArray<{
  value: ColorScheme;
  label: string;
  /** One-line flavor shown under the name in the settings picker. */
  hint: string;
}> = [
  { value: 'moss', label: 'Moss', hint: 'Forest green, charcoal & paper' },
  { value: 'ember', label: 'Ember', hint: 'Rust and amber on warm black' },
  { value: 'tide', label: 'Tide', hint: 'Deep water blues, misted light' },
  { value: 'dusk', label: 'Dusk', hint: 'Violet twilight over ink' },
  { value: 'sol', label: 'Sol', hint: 'Brass and gold over deep umber' },
  { value: 'bloom', label: 'Bloom', hint: 'Wild rose on plum, blush paper' },
  { value: 'trans', label: 'Trans', hint: 'Sky blue, pink and white' },
  { value: 'noir', label: 'Noir', hint: 'Black and white, no hue at all' },
];

const VALUES: ReadonlySet<string> = new Set(COLOR_SCHEMES.map((s) => s.value));

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && VALUES.has(value);
}

/**
 * The pre-paint cache value. Preferences are the source of truth — read
 * this only where prefs aren't available yet (the init script's fallback,
 * and `ColorSchemeSync`'s cross-tab handler).
 */
export function getStoredColorScheme(): ColorScheme {
  if (typeof window === 'undefined') return DEFAULT_COLOR_SCHEME;
  try {
    const raw = window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    return isColorScheme(raw) ? raw : DEFAULT_COLOR_SCHEME;
  } catch {
    return DEFAULT_COLOR_SCHEME;
  }
}

export function setStoredColorScheme(scheme: ColorScheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // localStorage can throw in private modes; ignore.
  }
}

export function applyColorScheme(scheme: ColorScheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.scheme = scheme;
}

/**
 * Inline script body, stringified for injection into <head>. Runs before
 * React hydrates so the saved scheme is applied without a flash of the
 * default palette. Mirrors THEME_INIT_SCRIPT; the storage key and the
 * scheme names are inlined as literals because this string executes
 * standalone, with no access to this module's exports.
 */
export const COLOR_SCHEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${COLOR_SCHEME_STORAGE_KEY}');if(['${COLOR_SCHEMES.map(
  (s) => s.value,
).join("','")}'].indexOf(s)<0)s='${DEFAULT_COLOR_SCHEME}';document.documentElement.setAttribute('data-scheme',s);}catch(e){document.documentElement.setAttribute('data-scheme','${DEFAULT_COLOR_SCHEME}');}})();`;
