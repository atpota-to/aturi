import type { Metadata } from 'next';
import LexiconDetail from '@/components/explore/lexicons/LexiconDetail';

// Cached shell — see `explore/[repo]/page.tsx` for why this is safe to serve
// from cache rather than re-render.
export const revalidate = 3600;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

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
  // Every lexicon page used to unfurl with the same generic explorer PNG, so
  // com.atproto.lexicon.schema and sh.tangled.repo were indistinguishable in a
  // share. Name the NSID on the card instead.
  const ogPath = `/api/og/explore?nsid=${encodeURIComponent(decoded)}`;
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

export default async function LexiconDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { nsid } = await params;
  return <LexiconDetail nsid={decodeURIComponent(nsid)} />;
}
