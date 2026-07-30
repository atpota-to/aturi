import type { Metadata } from 'next';
import CollectionExplorer from '@/components/explore/CollectionExplorer';

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
