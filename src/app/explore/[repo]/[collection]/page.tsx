import type { Metadata } from 'next';
import CollectionExplorer from '@/components/explore/CollectionExplorer';

// Cached shell — see `explore/[repo]/page.tsx` for why this is safe to serve
// from cache rather than re-render.
export const revalidate = 3600;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

type Params = { repo: string; collection: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo, collection } = await params;
  const decodedRepo = decodeURIComponent(repo);
  const decodedCollection = decodeURIComponent(collection);
  const title = `${decodedCollection} on ${decodedRepo} · Atmosphere Explorer`;
  const description = `Browse ${decodedCollection} records on ${decodedRepo}.`;
  const ogPath = `/api/og/explore?repo=${encodeURIComponent(decodedRepo)}&collection=${encodeURIComponent(decodedCollection)}`;
  return {
    title,
    description,
    // Unbounded, client-rendered inspection view — see `explore/[repo]/page.tsx`.
    robots: { index: false, follow: true },
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

export default async function ExploreCollectionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { repo, collection } = await params;
  return (
    <CollectionExplorer
      repo={decodeURIComponent(repo)}
      collection={decodeURIComponent(collection)}
    />
  );
}
