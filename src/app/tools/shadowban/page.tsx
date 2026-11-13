import type { Metadata } from 'next';
import { Suspense } from 'react';
import Header from '@/components/Header';
import ShadowbanChecker, { ShadowbanHeading } from '@/components/tools/ShadowbanChecker';

const title = 'Shadowban checker · aturi.to';
const description =
  'Compare an account’s repository on its PDS with what an AppView shows, and find posts, replies or search results it quietly leaves out.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [
      {
        url: '/og-images/aturi-explore.png',
        width: 1200,
        height: 669,
        alt: 'Atmosphere Explorer: tour the Atmosphere',
      },
    ],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og-images/aturi-explore.png'] },
};

/**
 * Served at the same path as the redesigned site's tool, so a link shared
 * now keeps working when that ships. Framed like the Explorer: the compact
 * header over the narrow column.
 *
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the heading.
 */
export default function ShadowbanCheckerPage() {
  return (
    <>
      <Header compact />
      <div className="container-narrow" style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}>
        <Suspense
          fallback={
            <div className="shadowban">
              <header>
                <ShadowbanHeading />
              </header>
            </div>
          }
        >
          <ShadowbanChecker />
        </Suspense>
      </div>
    </>
  );
}
