import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import AccountPage from '@/components/account/AccountPage';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.account' });
  return {
    title: t('title'),
    description: t('description'),
    // Don't index the account page — it's gated by sign-in and personalized.
    robots: { index: false, follow: false },
  };
}

export default function Account() {
  return <AccountPage />;
}
