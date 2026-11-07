import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import StreamMonitor from '@/components/tools/StreamMonitor';

const TITLE = 'Stream monitor · aturi.to';
const DESCRIPTION =
  'Watch atproto activity live: Jetstream commits, identity and account events, and PLC directory operations, filtered by event type, account, collection or text.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/**
 * The intro is rendered here, on the server; the monitor reads its filters
 * from the query string, so it renders on the client under a Suspense
 * boundary and the static HTML carries the intro alone.
 */
export default function StreamMonitorPage() {
  return (
    <div className="fn-tools fn-sm">
      <header className="fn-t-intro">
        <Link href="/tools" className="fn-kicker fn-t-kicker-link">
          Tools
        </Link>
        <h1>Stream monitor</h1>
        <p>
          Watch atproto activity as it happens. Jetstream carries records being created, updated and
          deleted across the network, along with identity and account events. The PLC directory feed
          carries every <code>did:plc</code> operation: new DIDs, handle and PDS changes, key
          rotations, tombstones. Your filters are kept in the address bar, so a view can be bookmarked
          or shared.
        </p>
      </header>
      <Suspense fallback={<p className="fn-sm-hint">Loading the monitor…</p>}>
        <StreamMonitor />
      </Suspense>
    </div>
  );
}
