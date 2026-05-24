/**
 * Single source of truth for supported UI locales. Kept in this no-deps file
 * so both the web app (`src/i18n/routing.ts`) and the extension (which
 * imports `preferences.ts` via the `@aturi` alias) can use it without
 * pulling in `next-intl`.
 */
export const LOCALES = ['en', 'ja', 'fr', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
