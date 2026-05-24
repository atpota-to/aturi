import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Header from '@/components/Header';
import ExtensionLanding from '@/components/landing/ExtensionLanding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.extension' });
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: ['/api/og/static?page=extension'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/api/og/static?page=extension'],
    },
  };
}

export default function ExtensionPage() {
  return (
    <div
      className="container-narrow"
      style={{ padding: '2rem 2rem 4rem', minHeight: '80dvh' }}
    >
      <Header compact />
      <ExtensionLanding />
    </div>
  );
}
