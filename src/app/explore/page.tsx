import type { Metadata } from 'next';
import ExploreLanding from '@/components/explore/ExploreLanding';

export const metadata: Metadata = {
  title: 'Atmosphere Explorer · aturi.to',
  description:
    "Browse any account's PDS records, identity history, and backlinks across the AT Protocol.",
  openGraph: {
    title: 'Atmosphere Explorer · aturi.to',
    description:
      "Browse any account's PDS records, identity history, and backlinks across the AT Protocol.",
    images: [
      {
        url: '/og-images/aturi-explore.png',
        width: 1200,
        height: 669,
        alt: 'Atmosphere Explorer — tour the Atmosphere',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atmosphere Explorer · aturi.to',
    description:
      "Browse any account's PDS records, identity history, and backlinks across the AT Protocol.",
    images: ['/og-images/aturi-explore.png'],
  },
};

export default function ExplorePage() {
  return <ExploreLanding />;
}
