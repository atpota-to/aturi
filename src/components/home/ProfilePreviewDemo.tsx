'use client';

import { useEffect, useState } from 'react';
import { fetchProfile, type BskyProfile } from '@/utils/profileFetcher';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import WaypointPicker from '@/components/WaypointPicker';

type Props = {
  /** Handle to fetch + showcase, e.g. "aturi.to". */
  handle: string;
};

/**
 * Live demo embedded on the homepage's Universal Links strip. Pulls a
 * real Bluesky profile and renders the same ProfilePreview +
 * WaypointPicker stack visitors see when they land on
 * `/<handle>` from a shared link. Every waypoint tile is real and
 * tappable — clicking one opens that profile in that client.
 */
export default function ProfilePreviewDemo({ handle }: Props) {
  const [profile, setProfile] = useState<BskyProfile | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchProfile(handle).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (profile === undefined) {
    return <ProfilePreviewSkeleton />;
  }
  if (profile === null) {
    // Network failed or the handle no longer resolves — degrade silently
    // rather than blocking the rest of the strip.
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ProfilePreview profile={profile} />
      <WaypointPicker
        type="profile"
        handle={profile.handle}
        did={profile.did}
        displayName={profile.displayName}
      />
    </div>
  );
}
