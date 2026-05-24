'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  LOCALES,
  LOCALE_LABELS,
  usePathname,
  useRouter,
  type Locale,
} from '@/i18n/routing';
import { usePreferences } from './PreferencesProvider';

type Props = {
  /** `inline` is a compact selector for headers; `block` adds a visible label. */
  variant?: 'inline' | 'block';
  className?: string;
};

export default function LanguageSwitcher({ variant = 'inline', className }: Props) {
  const locale = useLocale() as Locale;
  const t = useTranslations('account.language');
  const router = useRouter();
  const pathname = usePathname();
  const { prefs, update } = usePreferences();

  const current = prefs.language ?? locale;

  function onChange(next: Locale) {
    update((p) => ({ ...p, language: next }));
    router.replace(pathname, { locale: next });
  }

  const select = (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value as Locale)}
      aria-label={t('label')}
      style={{
        font: 'inherit',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid var(--border-subtle, currentColor)',
        borderRadius: '0.375rem',
        padding: '0.25rem 0.5rem',
        cursor: 'pointer',
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );

  if (variant === 'block') {
    return (
      <label className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <span>{t('label')}</span>
        {select}
      </label>
    );
  }

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {select}
    </span>
  );
}
