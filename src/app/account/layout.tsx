import type { ReactNode } from 'react';
import Header from '@/components/Header';

// AtprotoSessionProvider lives in the root layout, so we don't re-wrap.
// Just the page chrome; the settings column layout lives in
// src/styles/fieldnotes/account.css.
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header compact />
      <div className="fn-account-page">{children}</div>
    </>
  );
}
