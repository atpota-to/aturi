import type { Metadata } from 'next';
import RecordExplorer from '@/components/explore/RecordExplorer';

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
