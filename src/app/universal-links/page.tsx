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
    images: ['/api/og/static?page=universal-links'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Universal Links · aturi.to',
    description:
      'Share one aturi.to link and let your audience pick the Atmosphere client they want to open it in — 25+ supported clients, no lock-in, no sign-up.',
    images: ['/api/og/static?page=universal-links'],
  },
};

export default function UniversalLinksPage() {
  return (
    <div
      className="container-narrow"
      style={{ padding: '2rem 2rem 4rem', minHeight: '80dvh' }}
    >
      <Header compact />
      <UniversalLinksLanding />
    </div>
  );
}
