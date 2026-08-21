import type { Metadata } from 'next';
import SpaceRepoExplorer from '@/components/explore/space/SpaceRepoExplorer';

type Params = { repo: string; spaceType: string; skey: string; author: string };

// robots / OG rationale: see `explore/[repo]/space/page.tsx`.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { spaceType, skey, author } = await params;
  const decodedType = decodeURIComponent(spaceType);
  const decodedSkey = decodeURIComponent(skey);
  const decodedAuthor = decodeURIComponent(author);
  const title = `${decodedAuthor} · ${decodedSkey} · Atmosphere Explorer`;
  const description = `A member's permissioned repository in the ${decodedType} space ${decodedSkey}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ExploreSpaceRepoPage({ params }: { params: Promise<Params> }) {
  const { repo, spaceType, skey, author } = await params;
  return (
    <SpaceRepoExplorer
      repo={decodeURIComponent(repo)}
      spaceType={decodeURIComponent(spaceType)}
      skey={decodeURIComponent(skey)}
      author={decodeURIComponent(author)}
    />
  );
}
