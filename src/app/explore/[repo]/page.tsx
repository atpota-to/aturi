import type { Metadata } from 'next';
import RepoExplorer from '@/components/explore/RepoExplorer';

/**
 * The page is a shell. Everything below <RepoExplorer> is a client component
 * that fetches on mount, so the only server work here is turning route params
 * into metadata strings — the rendered output is a pure function of the URL and
 * nothing in it can go stale.
 *
 * Worth caching because the URL space is unbounded: a crawler walking the
 * network produced ~1.5M distinct paths in 24h, and each one was a fresh
 * function invocation for markup that never varies. Given the above, `false`
 * would be just as correct as an hour; an hour is the conservative spelling, so
 * that the cache heals on its own if this page ever stops being pure — the day
 * someone adds a server-side fetch to it and doesn't think about this comment.
 */
export const revalidate = 3600;

/**
 * Empty on purpose, and load-bearing. `revalidate` on its own does nothing to a
 * route with a dynamic segment: with no generateStaticParams Next treats the
 * segment as fully dynamic and never caches the render — the route stays `ƒ` in
 * the build output and gets no entry in the prerender manifest. Returning []
 * prerenders nothing at build time while still opting the route into ISR, so an
 * unknown param is rendered on demand once and served from cache thereafter.
 *
 * Delete this and the `revalidate` above silently stops working.
 */
export function generateStaticParams() {
  return [];
}

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
