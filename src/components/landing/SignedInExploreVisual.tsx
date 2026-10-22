'use client';

import {
  Cloud,
  Layers,
  Server,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * Static mock of what /explore/<repo> looks like once you sign in:
 *   - A "Synced" pill in the header — preferences (pins, custom
 *     waypoints, theme) ride along with your PDS so every device
 *     stays in lockstep.
 *   - The "You + @them" relationship strip just above the profile
 *     header, with same-PDS, mutual-follow, mutuals, and shared
 *     lexicons chips.
 */
export default function SignedInExploreVisual() {
  return (
    <div className="fl-mock">
      {/* Header strip with the signed-in account and the Synced indicator. */}
      <div className="fl-mock-head">
        <span className="fl-mock-head-stack">
          <span className="fl-mock-label">Explore · signed in</span>
          <span className="fl-mock-head-title">@you.bsky.social</span>
        </span>
        <span className="fl-chip" data-on="" title="Preferences sync to your PDS">
          <Cloud size={12} aria-hidden />
          Synced
        </span>
      </div>

      <div className="fl-mock-body">
        {/* You + @them relationship strip. */}
        <section className="fl-relation">
          <span className="fl-mock-label">You + @aturi.to</span>
          <div className="fl-chips">
            <Chip icon={<Server size={11} aria-hidden />}>Same PDS · pds.example.host</Chip>
            <Chip icon={<UserCheck size={11} aria-hidden />} accent>
              Mutual follow
              <span className="fl-relation-since">· since Mar 14, 2024</span>
            </Chip>
            <Chip icon={<Users size={11} aria-hidden />}>42 mutuals</Chip>
            <Chip icon={<Layers size={11} aria-hidden />}>6 lexicons in common</Chip>
          </div>
        </section>

        {/* Profile header preview beneath, so the strip reads as a banner
            on top of an account page rather than a floating chip group. */}
        <div className="fl-mock-row">
          <span className="fl-picker-avatar" data-size="s" aria-hidden />
          <span className="fl-mock-row-text">
            <span className="fl-mock-name">aturi.to</span>
            <span className="fl-mock-sub">did:plc:gq4fo3u6tqzzdkjlwzpb23tj</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({
  icon,
  accent,
  children,
}: {
  icon: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="fl-chip" data-on={accent ? '' : undefined}>
      {icon}
      {children}
    </span>
  );
}
