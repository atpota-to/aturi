import type { Metadata } from 'next';
import SpaceExplorer from '@/components/explore/space/SpaceExplorer';

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
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
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
