import type { Metadata } from 'next';
import ThreadView from '@/components/feedback/ThreadView';
import { getRecordByUri } from '@/utils/atproto/slingshot';
import { UI_NSID, type DiscussionRecord } from '@/utils/userinput/lexicons';

type Params = { did: string; rkey: string };

function uriFor(did: string, rkey: string): string {
  return `at://${did}/${UI_NSID.discussion}/${rkey}`;
}

/**
 * A thread URL is meant to be pasted into a conversation, so the title and
 * description come from the discussion itself. Slingshot serves the record
 * from an edge cache, which keeps this a single fast fetch on the server.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { did, rkey } = await params;
  const record = await getRecordByUri<DiscussionRecord>(
    uriFor(decodeURIComponent(did), decodeURIComponent(rkey)),
  );

  const title = record?.value?.title
    ? `${record.value.title} · Feedback · aturi.to`
    : 'Feedback · aturi.to';
  const description =
    record?.value?.body?.trim().replace(/\s+/g, ' ').slice(0, 200) ||
    'A feedback discussion on aturi.to, stored as records on the AT Protocol.';

  return {
    title,
    description,
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function FeedbackThreadPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { did, rkey } = await params;
  return <ThreadView did={decodeURIComponent(did)} rkey={decodeURIComponent(rkey)} />;
}
