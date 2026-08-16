import type { Metadata } from 'next';
import Header from '@/components/Header';
import UniversalLinksLanding from '@/components/landing/UniversalLinksLanding';

export const metadata: Metadata = {
  title: 'Universal Links · aturi.to',
  description:
    'Share one aturi.to link and let whoever opens it pick the Atmosphere client that renders the record.',
  openGraph: {
    title: 'Universal Links · aturi.to',
    description:
      'Share one aturi.to link and let whoever opens it pick the Atmosphere client that renders the record.',
    images: [
      {
        url: '/og-images/aturi-links.png',
        width: 1200,
        height: 675,
        alt: 'Universal Links: one link, every client',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Universal Links · aturi.to',
    description:
      'Share one aturi.to link and let whoever opens it pick the Atmosphere client that renders the record.',
    images: ['/og-images/aturi-links.png'],
  },
};

export default function UniversalLinksPage() {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}
      >
        <UniversalLinksLanding />
      </div>
    </>
  );
}
