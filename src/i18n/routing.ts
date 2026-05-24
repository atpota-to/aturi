import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const LOCALES = ['en', 'ja', 'fr', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  fr: 'Français',
  es: 'Español',
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'en',
  // `/` stays English; `/ja`, `/fr`, `/es` are explicit. SEO-friendly and
  // non-breaking for existing inbound links.
  localePrefix: 'as-needed',
  localeCookie: {
    name: 'ATURI_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
  },
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
