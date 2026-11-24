import type { ReactNode } from 'react';
import AccountFrame from '@/components/explore/AccountFrame';

type Params = { repo: string };

/**
 * The account's sidebar, held across its repo page, its collections and
 * their records: a layout, so Next keeps it mounted while the page beside
 * it changes. The space pages under the same repo sit outside this group
 * and keep their own sidebars.
 */
export default async function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<Params>;
}) {
  const { repo } = await params;
  return <AccountFrame repo={decodeURIComponent(repo)}>{children}</AccountFrame>;
}
