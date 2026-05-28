import type { Metadata } from 'next';
import Header from '@/components/Header';
import ExtensionLanding from '@/components/landing/ExtensionLanding';

export const metadata: Metadata = {
  title: 'Browser Extension · aturi.to',
  description:
    'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect to your preferred app per lexicon.',
  openGraph: {
    title: 'Browser Extension · aturi.to',
    description:
      'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect to your preferred app per lexicon.',
    images: [
      {
        url: '/og-images/aturi-extension.png',
        width: 1200,
        height: 671,
        alt: 'Browser Extension — three modes, one extension',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browser Extension · aturi.to',
    description:
      'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect to your preferred app per lexicon.',
    images: ['/og-images/aturi-extension.png'],
  },
};

export default function ExtensionPage() {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}
      >
        <ExtensionLanding />
      </div>
    </>
  );
}
