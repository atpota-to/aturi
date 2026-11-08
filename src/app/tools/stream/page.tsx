import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import StreamMonitor, { StreamMonitorSkeleton } from '@/components/tools/StreamMonitor';
import { ChromeBarProvider } from '@/components/explore/ChromeBarContext';
import ExploreChromeBar from '@/components/explore/ExploreChromeBar';

const TITLE = 'Stream monitor · aturi.to';
const DESCRIPTION =
  'Watch atproto activity live: Jetstream commits, identity and account events, and PLC directory operations, filtered by event type, account, collection or text.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const intro = (
  <>
    <Link href="/tools" className="fn-kicker fn-t-kicker-link">
      Tools
    </Link>
    <h1>Stream monitor</h1>
    <p>
      Records being written across the Atmosphere, from Jetstream, and every <code>did:plc</code>{' '}
      operation, from the PLC directory, as they happen. Filters are kept in the link, so any view can
      be shared.
    </p>
  </>
);

/**
 * The monitor reads its filters from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the intro and
 * the skeleton of the card.
 *
 * The explorer's bottom bar comes along (ChromeBarProvider): on a phone it
 * holds the text filter beside Back, Home and the menu, as it does on a
 * repo or a collection.
 */
export default function StreamMonitorPage() {
  return (
    <ChromeBarProvider>
      <Suspense fallback={<StreamMonitorSkeleton intro={intro} />}>
        <StreamMonitor intro={intro} />
      </Suspense>
      <ExploreChromeBar />
    </ChromeBarProvider>
  );
}
