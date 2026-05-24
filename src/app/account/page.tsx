import type { Metadata } from 'next';
import AccountPage from '@/components/account/AccountPage';

export const metadata: Metadata = {
  title: 'Account · aturi.to',
  description: 'Customize your Aturi waypoints and preferences.',
  // Don't index the account page — it's gated by sign-in and personalized.
  robots: { index: false, follow: false },
};

export default function Account() {
  return <AccountPage />;
}
