/**
 * Tiny wrapper around `browser.i18n.getMessage()`. Locale is determined by
 * the browser's UI language (Chrome `default_locale` fallback for unknown
 * targets), so callers don't have to worry about it.
 *
 * Missing keys return the literal key in production (so it's still findable
 * in the rendered UI), wrapped in ⟦…⟧ in dev to make extraction gaps loud.
 */

import { browser } from '#imports';

const DEV = import.meta.env.DEV;

export function t(key: string, substitutions?: string | string[]): string {
  // WXT auto-generates a literal union of keys from `_locales/en/messages.json`
  // for `browser.i18n.getMessage`. We accept any string so callers don't have
  // to keep that union in lockstep; missing keys fall back gracefully below.
  const get = browser.i18n.getMessage as (k: string, s?: string | string[]) => string;
  const out = get(key, substitutions);
  if (out) return out;
  return DEV ? `⟦${key}⟧` : key;
}

/** Current browser UI locale, e.g. "en-US". Use the 2-letter prefix for comparisons. */
export function getUILocale(): string {
  return browser.i18n.getUILanguage();
}
