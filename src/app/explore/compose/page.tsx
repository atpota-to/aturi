import type { Metadata } from 'next';
import RecordComposer from '@/components/explore/RecordComposer';

/**
 * The record composer.
 *
 * A static sibling of `/explore/[repo]`, alongside `lexicons`, `pds` and
 * `spaces` — not a segment under a repo, because the repo is never in
 * question: a PDS only takes writes for the account that authorized them, so
 * the composer always targets the signed-in one. Putting it under `[repo]`
 * would also have collided with `[collection]/[rkey]`, where `new` is a
 * perfectly legal record key.
 *
 * The collection and record key arrive as query parameters so a collection page
 * can hand over what you were looking at, and so a composer opened on a
 * particular lexicon is a link someone can send.
 */

export const metadata: Metadata = {
  title: 'Write a record · Atmosphere Explorer',
  description:
    'Create a record of any AT Protocol lexicon in your own repository, from a schema-derived form or from raw JSON.',
  // Signed-in, per-account authoring surface with nothing to index.
  robots: { index: false, follow: true },
};

type SearchParams = { collection?: string | string[]; rkey?: string | string[] };

/** A repeated query parameter arrives as an array; the first one wins. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function ComposeRecordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <RecordComposer
      initialCollection={first(params.collection).trim()}
      initialRkey={first(params.rkey).trim()}
    />
  );
}
