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
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [`/api/og/static?page=explore`],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/api/og/static?page=explore`],
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
