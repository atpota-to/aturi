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
    images: ['/api/og/static?page=explore'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atmosphere Explorer · aturi.to',
    description:
      "Browse any account's PDS records, identity history, and backlinks across the AT Protocol.",
    images: ['/api/og/static?page=explore'],
  },
};

export default function ExplorePage() {
  return <ExploreLanding />;
}
