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
    images: ['/api/og/static?page=extension'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browser Extension · aturi.to',
    description:
      'Jump between Atmosphere clients in one click, inspect AT URIs anywhere on the web, and auto-redirect to your preferred app per lexicon.',
    images: ['/api/og/static?page=extension'],
  },
};

export default function ExtensionPage() {
  return (
    <div
      className="container-narrow"
      style={{ padding: '2rem 2rem 4rem', minHeight: '80dvh' }}
    >
      <Header compact />
      <ExtensionLanding />
    </div>
  );
}
