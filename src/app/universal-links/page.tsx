import type { Metadata } from 'next';
import Header from '@/components/Header';
import UniversalLinksLanding from '@/components/landing/UniversalLinksLanding';

export const metadata: Metadata = {
  title: 'Universal Links · aturi.to',
  description:
    'Share one aturi.to link and let your audience pick the Atmosphere client they want to open it in — 25+ supported clients, no lock-in, no sign-up.',
  openGraph: {
    title: 'Universal Links · aturi.to',
    description:
      'Share one aturi.to link and let your audience pick the Atmosphere client they want to open it in — 25+ supported clients, no lock-in, no sign-up.',
    images: [
      {
        url: '/og-images/aturi-links.png',
        width: 3020,
        height: 1698,
        alt: 'Universal Links — one link, every client',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Universal Links · aturi.to',
    description:
      'Share one aturi.to link and let your audience pick the Atmosphere client they want to open it in — 25+ supported clients, no lock-in, no sign-up.',
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
