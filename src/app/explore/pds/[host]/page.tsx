import type { Metadata } from 'next';
import PdsExplorer from '@/components/explore/PdsExplorer';

// Cached shell — see `explore/[repo]/page.tsx` for why this is safe to serve
// from cache rather than re-render.
export const revalidate = 3600;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

type Params = { host: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { host } = await params;
  const decoded = decodeURIComponent(host);
  const title = `${decoded} · PDS · Atmosphere Explorer`;
  const description = `Inspect the ${decoded} Personal Data Server: server metadata, available domains, and the repos it hosts.`;
  const ogPath = `/api/og/explore?host=${encodeURIComponent(decoded)}`;
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

export default async function ExplorePdsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { host } = await params;
  return <PdsExplorer host={decodeURIComponent(host)} />;
}
