import type { Metadata } from 'next';
import SpacesLanding from '@/components/explore/space/SpacesLanding';

/**
 * A static segment beside `explore/[repo]`, resolved ahead of it — the same
 * arrangement `explore/pds` and `explore/lexicons` already use. No handle
 * collides with it: a handle is a domain and always carries a dot.
 *
 * Indexable, unlike everything under `[repo]/space`: this page shows a
 * sign-in form and nothing about anybody's data, so there is no address here
 * worth keeping from a crawler.
 */
export const metadata: Metadata = {
  title: 'Atproto spaces · aturi.to',
  description:
    'Browse your permissioned atproto data — records kept outside your public repo.',
  openGraph: {
    title: 'Atproto spaces · aturi.to',
    description:
      'Browse your permissioned atproto data — records kept outside your public repo.',
    images: ['/api/og/static?page=spaces'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atproto spaces · aturi.to',
    description:
      'Browse your permissioned atproto data — records kept outside your public repo.',
    images: ['/api/og/static?page=spaces'],
  },
};

export default function SpacesLandingPage() {
  return <SpacesLanding />;
}
