import type { Metadata } from 'next';
import LexiconsExplorer from '@/components/explore/lexicons/LexiconsExplorer';

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

export default function LexiconsPage() {
  return <LexiconsExplorer />;
}
