'use client';

import { useEffect, useState } from 'react';
import { fetchProfile, type BskyProfile } from '@/utils/profileFetcher';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import WaypointCarousel from './WaypointCarousel';

type Props = {
  /** Handle to fetch + showcase, e.g. "aturi.to". */
  handle: string;
};

/**
 * Live demo embedded on the homepage's Universal Links strip. Pulls a
 * real Bluesky profile and renders the real ProfilePreview card,
 * followed by an animated WaypointCarousel that rotates through the
 * 25+ supported clients in groups of three — the full WaypointPicker
 * would eat the whole strip rendering all of them at once.
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
      <WaypointCarousel handle={profile.handle} did={profile.did} />
    </div>
  );
}
