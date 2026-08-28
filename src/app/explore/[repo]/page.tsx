import type { Metadata } from 'next';
import RepoExplorer from '@/components/explore/RepoExplorer';

type Params = { repo: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo } = await params;
  const decoded = decodeURIComponent(repo);
  const title = `${decoded} · Atmosphere Explorer`;
  const description = `Browse the PDS records, identity history, and backlinks for ${decoded} in the Atmosphere.`;
  return {
    title,
    description,
    // The explorer is a live inspection tool, not content: it spans every repo
    // in the network (an unbounded URL space) and renders its data client-side,
    // so a crawler only ever sees an empty shell. Keep it out of the index while
    // still letting crawlers follow through to the pages that are worth having.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      images: [`/api/og/profile?handle=${encodeURIComponent(decoded)}`],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/api/og/profile?handle=${encodeURIComponent(decoded)}`],
    },
  };
}

export default async function ExploreRepoPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { repo } = await params;
  return <RepoExplorer repo={decodeURIComponent(repo)} />;
}
