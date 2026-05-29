import type { Metadata } from 'next';
import LexiconDetail from '@/components/explore/lexicons/LexiconDetail';

type Params = { nsid: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { nsid } = await params;
  const decoded = decodeURIComponent(nsid);
  const title = `${decoded} · Lexicons · Atmosphere Explorer`;
  const description = `Usage trends, stats, and recent records for the ${decoded} lexicon across the AT Protocol.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: ['/og-images/aturi-explore.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-images/aturi-explore.png'],
    },
  };
}

export default async function LexiconDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { nsid } = await params;
  return <LexiconDetail nsid={decodeURIComponent(nsid)} />;
}
