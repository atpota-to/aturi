import type { Metadata } from 'next';
import SpaceListExplorer from '@/components/explore/space/SpaceListExplorer';

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

type Params = { repo: string };

/**
 * Space pages deviate from the public explore routes in two ways, both
 * deliberate:
 *
 *   `follow: false` — every other `[repo]`-rooted page uses `follow: true`.
 *   A space address is itself private information: the authority, type, and key
 *   of a space someone belongs to, and below that the DIDs of its members.
 *   Letting a crawler follow links out of one page harvests that address graph
 *   even though every page renders empty without a credential.
 *
 *   No OG image — the other explore routes build `/api/og/explore?repo=…`.
 *   Putting a space type, key, or member DID in an OG URL leaks the address
 *   into the renderer's logs and into every surface that unfurls the link, for
 *   a card that could only ever say "sign in".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo } = await params;
  const decodedRepo = decodeURIComponent(repo);
  const title = `Spaces · ${decodedRepo} · Atmosphere Explorer`;
  const description = `Permissioned spaces ${decodedRepo} writes to.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [SPACE_OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [SPACE_OG_IMAGE] },
  };
}

export default async function ExploreSpacesPage({ params }: { params: Promise<Params> }) {
  const { repo } = await params;
  return <SpaceListExplorer repo={decodeURIComponent(repo)} />;
}
