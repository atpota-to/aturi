import type { Metadata } from 'next';
import LexiconGroup from '@/components/explore/lexicons/LexiconGroup';

type Params = { prefix: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { prefix } = await params;
  const decoded = decodeURIComponent(prefix);
  const title = `${decoded} · Lexicons · Atmosphere Explorer`;
  const description = `Lexicons in the ${decoded} namespace across the AT Protocol.`;
  const ogPath = `/api/og/explore?prefix=${encodeURIComponent(decoded)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogPath],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogPath],
    },
  };
}

export default async function LexiconGroupPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { prefix } = await params;
  return <LexiconGroup prefix={decodeURIComponent(prefix)} />;
}
