import type { Metadata } from 'next';
import SpaceExplorer from '@/components/explore/space/SpaceExplorer';

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

type Params = { repo: string; spaceType: string; skey: string };

// robots / OG rationale: see `explore/[repo]/space/page.tsx`.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo, spaceType, skey } = await params;
  const decodedRepo = decodeURIComponent(repo);
  const decodedType = decodeURIComponent(spaceType);
  const decodedSkey = decodeURIComponent(skey);
  const title = `${decodedSkey} · ${decodedType} · Atmosphere Explorer`;
  const description = `A permissioned ${decodedType} space run by ${decodedRepo}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [SPACE_OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SPACE_OG_IMAGE] },
  };
}

export default async function ExploreSpacePage({ params }: { params: Promise<Params> }) {
  const { repo, spaceType, skey } = await params;
  return (
    <SpaceExplorer
      repo={decodeURIComponent(repo)}
      spaceType={decodeURIComponent(spaceType)}
      skey={decodeURIComponent(skey)}
    />
  );
}
