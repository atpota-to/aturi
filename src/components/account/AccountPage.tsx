'use client';

import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import SettingsShell from './SettingsShell';

/**
 * /account page. Always renders the tabbed settings shell — the Account
 * tab itself handles the signed-out sign-in flow, so anonymous users
 * can still reach (and tweak) every preference that doesn't require an
 * authenticated session. Local changes carry over to the PDS the first
 * time they sign in.
 */
export default function AccountPage() {
  const { loading } = useAtprotoSession();
  if (loading) {
    return <p className="explore-placeholder">Loading account…</p>;
  }
  return <SettingsShell />;
}
