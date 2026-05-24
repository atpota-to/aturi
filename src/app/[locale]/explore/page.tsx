import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import ExploreLanding from '@/components/explore/ExploreLanding';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.explore' });
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: ['/api/og/static?page=explore'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/api/og/static?page=explore'],
    },
  };
}

export default function ExplorePage() {
  return <ExploreLanding />;
}
