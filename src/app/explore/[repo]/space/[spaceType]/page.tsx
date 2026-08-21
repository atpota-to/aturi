import type { Metadata } from 'next';
import SpaceTypeExplorer from '@/components/explore/space/SpaceTypeExplorer';

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
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
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
