import type { Metadata } from 'next';
import SpaceCollectionExplorer from '@/components/explore/space/SpaceCollectionExplorer';

type Params = {
  repo: string;
  spaceType: string;
  skey: string;
  author: string;
  collection: string;
};

// robots / OG rationale: see `explore/[repo]/space/page.tsx`.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { skey, author, collection } = await params;
  const decodedSkey = decodeURIComponent(skey);
  const decodedAuthor = decodeURIComponent(author);
  const decodedCollection = decodeURIComponent(collection);
  const title = `${decodedCollection} · ${decodedSkey} · Atmosphere Explorer`;
  const description = `Permissioned ${decodedCollection} records written by ${decodedAuthor}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ExploreSpaceCollectionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { repo, spaceType, skey, author, collection } = await params;
  return (
    <SpaceCollectionExplorer
      repo={decodeURIComponent(repo)}
      spaceType={decodeURIComponent(spaceType)}
      skey={decodeURIComponent(skey)}
      author={decodeURIComponent(author)}
      collection={decodeURIComponent(collection)}
    />
  );
}
