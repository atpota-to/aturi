import { Suspense } from 'react';
import XrpcConsole from '@/components/tools/XrpcConsole';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('xrpc');

/**
 * The console reads its request from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function XrpcConsolePage() {
  return (
    <Suspense fallback={<ToolShell slug="xrpc" wide />}>
      <XrpcConsole />
    </Suspense>
  );
}
