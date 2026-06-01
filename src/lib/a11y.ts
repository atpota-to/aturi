/**
 * Accessibility appearance toggles: "reduce motion" and "high contrast".
 *
 * Both mirror the theme / font-scale modules: a boolean persisted in
 * localStorage (browser-local, not synced to the PDS) and reflected as a
 * `data-*` attribute on <html> that the CSS in globals.css keys off.
 *
 *   - data-reduce-motion='true' → reuses the reduced-motion rules (pauses
 *     the body::before drift, collapses keyframe animations, drops hover
 *     transforms). Framer Motion follows the same flag via MotionConfig in
 *     PageTransition.tsx.
 *   - data-high-contrast='true' → swaps in higher-contrast token values per
 *     theme and removes the ambient glow + noise overlay.
 *
 * When the user hasn't made an explicit choice, each toggle defaults to the
 * matching OS preference (`prefers-reduced-motion` / `prefers-contrast`), so
 * system accessibility settings are honored out of the box and can still be
 * overridden per-browser here.
 */

export const REDUCE_MOTION_STORAGE_KEY = 'aturi.reduceMotion';
export const HIGH_CONTRAST_STORAGE_KEY = 'aturi.highContrast';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function prefersHighContrast(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-contrast: more)').matches;
  } catch {
    return false;
  }
}

function readToggle(key: string, osDefault: () => boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return osDefault();
  } catch {
    return false;
  }
}

function writeToggle(key: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, on ? 'true' : 'false');
  } catch {
    // localStorage can throw in private modes; ignore.
  }
}

/** True when the user has made an explicit choice (vs. falling back to OS). */
function hasExplicit(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function getStoredReduceMotion(): boolean {
  return readToggle(REDUCE_MOTION_STORAGE_KEY, prefersReducedMotion);
}

export function getStoredHighContrast(): boolean {
  return readToggle(HIGH_CONTRAST_STORAGE_KEY, prefersHighContrast);
}

export function hasStoredReduceMotion(): boolean {
  return hasExplicit(REDUCE_MOTION_STORAGE_KEY);
}

export function hasStoredHighContrast(): boolean {
  return hasExplicit(HIGH_CONTRAST_STORAGE_KEY);
}

export function setStoredReduceMotion(on: boolean): void {
  writeToggle(REDUCE_MOTION_STORAGE_KEY, on);
}

export function setStoredHighContrast(on: boolean): void {
  writeToggle(HIGH_CONTRAST_STORAGE_KEY, on);
}

export function applyReduceMotion(on: boolean): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (on) el.setAttribute('data-reduce-motion', 'true');
  else el.removeAttribute('data-reduce-motion');
}

export function applyHighContrast(on: boolean): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (on) el.setAttribute('data-high-contrast', 'true');
  else el.removeAttribute('data-high-contrast');
}

// --- useSyncExternalStore helpers ------------------------------------------
// The attribute on <html> is the source of truth at runtime (seeded by the
// init script before paint, kept current by A11ySync). Snapshots read it
// directly so the settings toggles and PageTransition stay in lockstep with
// what's actually applied. Same-tab changes re-dispatch a `storage` event so
// these subscriptions fire (mirrors the theme picker).

export function subscribeReduceMotion(onChange: () => void): () => void {
  function handler(event: StorageEvent) {
    if (event.key === REDUCE_MOTION_STORAGE_KEY) onChange();
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function getReduceMotionSnapshot(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-reduce-motion') === 'true';
}

export function getReduceMotionServerSnapshot(): boolean {
  return false;
}

export function subscribeHighContrast(onChange: () => void): () => void {
  function handler(event: StorageEvent) {
    if (event.key === HIGH_CONTRAST_STORAGE_KEY) onChange();
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function getHighContrastSnapshot(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-high-contrast') === 'true';
}

export function getHighContrastServerSnapshot(): boolean {
  return false;
}

/**
 * Inline script body, stringified for injection into <head>. Runs before
 * React hydrates so reduced-motion / high-contrast are applied without a
 * flash of animation (or a low-contrast flash) on cold loads. Mirrors
 * THEME_INIT_SCRIPT. Storage keys and media queries are inlined as literals
 * because this string executes standalone. Each toggle falls back to its OS
 * preference when the user hasn't made an explicit choice.
 */
export const A11Y_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var m=window.matchMedia;var rm=localStorage.getItem('${REDUCE_MOTION_STORAGE_KEY}');if(rm==='true'||(rm===null&&m&&m('(prefers-reduced-motion: reduce)').matches))d.setAttribute('data-reduce-motion','true');var hc=localStorage.getItem('${HIGH_CONTRAST_STORAGE_KEY}');if(hc==='true'||(hc===null&&m&&m('(prefers-contrast: more)').matches))d.setAttribute('data-high-contrast','true');}catch(e){}})();`;
