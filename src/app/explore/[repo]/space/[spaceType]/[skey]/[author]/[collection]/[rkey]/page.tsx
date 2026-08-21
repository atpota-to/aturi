import type { Metadata } from 'next';
import SpaceRecordExplorer from '@/components/explore/space/SpaceRecordExplorer';

type Params = {
  repo: string;
  spaceType: string;
  skey: string;
  author: string;
  collection: string;
  rkey: string;
};

// robots / OG rationale: see `explore/[repo]/space/page.tsx`.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { skey, collection, rkey } = await params;
  const decodedSkey = decodeURIComponent(skey);
  const decodedCollection = decodeURIComponent(collection);
  const decodedRkey = decodeURIComponent(rkey);
  const title = `${decodedRkey} · ${decodedCollection} · Atmosphere Explorer`;
  const description = `A permissioned ${decodedCollection} record in the space ${decodedSkey}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ExploreSpaceRecordPage({ params }: { params: Promise<Params> }) {
  const { repo, spaceType, skey, author, collection, rkey } = await params;
  return (
    <SpaceRecordExplorer
      repo={decodeURIComponent(repo)}
      spaceType={decodeURIComponent(spaceType)}
      skey={decodeURIComponent(skey)}
      author={decodeURIComponent(author)}
      collection={decodeURIComponent(collection)}
      rkey={decodeURIComponent(rkey)}
    />
  );
}
