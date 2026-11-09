import { Suspense } from 'react';
import type { Metadata } from 'next';
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

/** The intro, which the monitor keeps behind an ⓘ beside its title. */
const about = (
  <>
    <p>
      Records being written across the Atmosphere, from Jetstream, and every <code>did:plc</code>{' '}
      operation, from the PLC directory, as they happen.
    </p>
    <p>
      Pause holds new events above the list and stays connected. Stop disconnects from both streams.
      Filters are kept in the link, so any view can be shared.
    </p>
  </>
);

/**
 * The monitor reads its filters from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the frame, the
 * title and the intro.
 *
 * The explorer's bottom bar comes along (ChromeBarProvider) for phones,
 * where it becomes the monitor's toolbar: Pause and Stop, the text filter
 * and the filters button. Wider, the monitor's own toolbar holds all of
 * that, so the bar is phone only.
 */
export default function StreamMonitorPage() {
  return (
    <ChromeBarProvider>
      <Suspense fallback={<StreamMonitorSkeleton about={about} />}>
        <StreamMonitor about={about} />
      </Suspense>
      <ExploreChromeBar phoneOnly />
    </ChromeBarProvider>
  );
}
