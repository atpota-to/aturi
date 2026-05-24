import type { ReactNode } from 'react';
import Header from '@/components/Header';

// AtprotoSessionProvider lives in the root layout, so we don't re-wrap.
// Just the page chrome.
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="container-narrow"
      style={{
        padding: '2rem 2rem 4rem',
        minHeight: '80dvh',
      }}
    >
      <Header compact />
      {children}
    </div>
  );
}
