import type { Metadata } from 'next';
import LexiconGroup from '@/components/explore/lexicons/LexiconGroup';

// Cached shell — see `explore/[repo]/page.tsx` for why this is safe to serve
// from cache rather than re-render.
export const revalidate = 3600;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

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
