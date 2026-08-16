import type { Metadata } from 'next';
import Header from '@/components/Header';
import ExtensionLanding from '@/components/landing/ExtensionLanding';

export const metadata: Metadata = {
  title: 'Browser Extension · aturi.to',
  description:
    'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect links to the client you prefer.',
  openGraph: {
    title: 'Browser Extension · aturi.to',
    description:
      'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect links to the client you prefer.',
    images: [
      {
        url: '/og-images/aturi-extension.png',
        width: 1200,
        height: 671,
        alt: 'Browser Extension: three modes, one extension',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browser Extension · aturi.to',
    description:
      'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect links to the client you prefer.',
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
