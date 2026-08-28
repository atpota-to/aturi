import type { Metadata } from 'next';
import RecordExplorer from '@/components/explore/RecordExplorer';

// Cached shell — see `explore/[repo]/page.tsx` for why this is safe to serve
// from cache rather than re-render.
export const revalidate = 3600;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

type Params = { repo: string; collection: string; rkey: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { repo, collection, rkey } = await params;
  const decodedRepo = decodeURIComponent(repo);
  const decodedCollection = decodeURIComponent(collection);
  const decodedRkey = decodeURIComponent(rkey);
  const title = `${decodedRkey} · ${decodedCollection} · Atmosphere Explorer`;
  const description = `${decodedCollection} record ${decodedRkey} from ${decodedRepo}.`;
  const isPost = decodedCollection === 'app.bsky.feed.post';
  const ogPath = isPost
    ? `/api/og/post?handle=${encodeURIComponent(decodedRepo)}&rkey=${encodeURIComponent(decodedRkey)}`
    : `/api/og/explore?repo=${encodeURIComponent(decodedRepo)}&collection=${encodeURIComponent(decodedCollection)}&rkey=${encodeURIComponent(decodedRkey)}`;
  return {
    title,
    description,
    // Unbounded, client-rendered inspection view — see `explore/[repo]/page.tsx`.
    // The same record has a canonical, server-rendered home under `/profile/`.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      images: [ogPath],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogPath],
    },
  };
}

export default async function ExploreRecordPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { repo, collection, rkey } = await params;
  return (
    <RecordExplorer
      repo={decodeURIComponent(repo)}
      collection={decodeURIComponent(collection)}
      rkey={decodeURIComponent(rkey)}
    />
  );
}
