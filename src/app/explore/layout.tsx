import type { ReactNode } from 'react';
import Header from '@/components/Header';
import { BreadcrumbProvider } from '@/components/explore/BreadcrumbContext';
import { EditBarProvider } from '@/components/explore/EditBarContext';
import { ChromeBarProvider } from '@/components/explore/ChromeBarContext';
import ExploreChromeBar from '@/components/explore/ExploreChromeBar';

// AtprotoSessionProvider now lives in the root layout, so the session and
// the Header's sign-in menu are available on every page. This layout just
// adds the explore-specific page chrome and pins min-height so route
// transitions don't shrink the viewport.
//
// BreadcrumbProvider wraps both the nav and the content so the in-page
// <Breadcrumb> can hand its trail to the nav's condensed copy, which slides
// in once you scroll past the full one.
//
// ChromeBarProvider does the same job at the other end of the screen: pages
// publish the find action that fits where you are, and the fixed
// <ExploreChromeBar> renders it alongside a copy-link button.
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <EditBarProvider>
        <ChromeBarProvider>
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
          <ExploreChromeBar />
        </ChromeBarProvider>
      </EditBarProvider>
    </BreadcrumbProvider>
  );
}
