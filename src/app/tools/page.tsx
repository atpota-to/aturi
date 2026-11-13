import type { Metadata } from 'next';
import ToolsLanding from '@/components/tools/ToolsLanding';

/**
 * A static segment beside the root `[handle]` route, resolved ahead of it.
 * No handle collides with it: a handle is a domain and always carries a dot.
 */
const TITLE = 'Tools · aturi.to';
const DESCRIPTION =
  'Small single-purpose utilities for atproto: a handle debugger, a record validator, an XRPC console, a live Jetstream and PLC monitor, and more.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function ToolsPage() {
  return <ToolsLanding />;
}
