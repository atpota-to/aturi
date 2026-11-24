import type { ReactNode } from 'react';
import LexiconFrame from '@/components/explore/lexicons/LexiconFrame';

/**
 * The lexicons explorer's sidebar, held across its landing, its namespace
 * pages and its lexicons' pages: a layout, so Next keeps it mounted while
 * the page beside it changes.
 */
export default function LexiconsLayout({ children }: { children: ReactNode }) {
  return <LexiconFrame>{children}</LexiconFrame>;
}
