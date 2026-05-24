import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Header from '@/components/Header';
import UniversalLinksLanding from '@/components/landing/UniversalLinksLanding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.universalLinks' });
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: ['/api/og/static?page=universal-links'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/api/og/static?page=universal-links'],
    },
  };
}

export default function UniversalLinksPage() {
  return (
    <div
      className="container-narrow"
      style={{ padding: '2rem 2rem 4rem', minHeight: '80dvh' }}
    >
      <Header compact />
      <UniversalLinksLanding />
    </div>
  );
}
