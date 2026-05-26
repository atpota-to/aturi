import type { ReactNode } from 'react';
import Header from '@/components/Header';

// AtprotoSessionProvider now lives in the root layout, so the session and
// the Header's sign-in menu are available on every page. This layout just
// adds the explore-specific page chrome and pins min-height so route
// transitions don't shrink the viewport.
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{
          padding: '0 2rem 4rem',
          minHeight: '80dvh',
        }}
      >
        {children}
      </div>
    </>
  );
}
