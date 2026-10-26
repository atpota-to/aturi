import type { Metadata } from 'next';
import SpaceRecordExplorer from '@/components/explore/space/SpaceRecordExplorer';

/**
 * One shared card for every space route, carrying no address.
 *
 * The per-page OG builders the public explorer uses take the repo,
 * collection and rkey as query params, which would put a space type, key
 * or member DID into a URL that the renderer logs and every surface that
 * unfurls the link repeats. A space address is itself the private part —
 * so these unfurl as spaces, not as anyone's space.
 */
const SPACE_OG_IMAGE = '/api/og/static?page=spaces';

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
    openGraph: { title, description, images: [SPACE_OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SPACE_OG_IMAGE] },
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
