import { Suspense } from 'react';
import type { Metadata } from 'next';
import LexiconRoute, { LexiconRouteSkeleton } from '@/components/explore/lexicons/workbench/LexiconRoute';

export const metadata: Metadata = {
  title: 'Lexicons · Atmosphere Explorer · aturi.to',
  description:
    'Search, browse, and track usage trends for every lexicon (collection NSID) across the AT Protocol.',
  openGraph: {
    title: 'Lexicons · Atmosphere Explorer · aturi.to',
    description:
      'Search, browse, and track usage trends for every lexicon (collection NSID) across the AT Protocol.',
    images: [
      {
        url: '/og-images/aturi-explore.png',
        width: 1200,
        height: 669,
        alt: 'Atmosphere Explorer: lexicon trends',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lexicons · Atmosphere Explorer · aturi.to',
    description:
      'Search, browse, and track usage trends for every lexicon (collection NSID) across the AT Protocol.',
    images: ['/og-images/aturi-explore.png'],
  },
};

/**
 * The workbench reads its list from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries its frame.
 */
export default function LexiconsPage() {
  return (
    <Suspense fallback={<LexiconRouteSkeleton />}>
      <LexiconRoute />
    </Suspense>
  );
}
