import type { Metadata } from 'next';
import SpaceTypeExplorer from '@/components/explore/space/SpaceTypeExplorer';

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

type Params = { repo: string; spaceType: string };

// robots / OG rationale: see `explore/[repo]/space/page.tsx`.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo, spaceType } = await params;
  const decodedRepo = decodeURIComponent(repo);
  const decodedType = decodeURIComponent(spaceType);
  const title = `${decodedType} · Spaces · Atmosphere Explorer`;
  const description = `The ${decodedType} space type, and ${decodedRepo}'s spaces of that type.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [SPACE_OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SPACE_OG_IMAGE] },
  };
}

export default async function ExploreSpaceTypePage({ params }: { params: Promise<Params> }) {
  const { repo, spaceType } = await params;
  return (
    <SpaceTypeExplorer
      repo={decodeURIComponent(repo)}
      spaceType={decodeURIComponent(spaceType)}
    />
  );
}
