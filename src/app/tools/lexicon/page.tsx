import { Suspense } from 'react';
import LexiconChecker from '@/components/tools/LexiconChecker';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('lexicon');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function LexiconCheckerPage() {
  return (
    <Suspense fallback={<ToolShell slug="lexicon" />}>
      <LexiconChecker />
    </Suspense>
  );
}
