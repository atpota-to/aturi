'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import Header from '@/components/Header';
import { parseURI, resolveHandle, getDisplayName } from '@/utils/uriParser';
import { resolveDidToHandle } from '@/utils/didResolver';
import { fetchProfile, type BskyProfile } from '@/utils/profileFetcher';

export default function ProfilePage() {
  const params = useParams();
  // Decode the handle parameter in case it's URL encoded (for DIDs with colons)
  const handle = decodeURIComponent(params.handle as string);
  
  const [isLoading, setIsLoading] = useState(true);
  const [did, setDid] = useState<string | null>(null);
  const [resolvedHandle, setResolvedHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<BskyProfile | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const resolvedDid = await resolveHandle(handle);
        if (resolvedDid) {
          setDid(resolvedDid);
          
          // If the original input was a DID, resolve it back to a handle for display
          if (handle.startsWith('did:')) {
            const handleFromDid = await resolveDidToHandle(resolvedDid);
            if (handleFromDid) {
              setResolvedHandle(handleFromDid);
            }
          } else {
            // If it was already a handle, use it
            setResolvedHandle(handle);
          }
          
          // Fetch the profile data for preview
          const profile = await fetchProfile(resolvedDid);
          if (profile) {
            setProfileData(profile);
          } else {
            console.warn('Failed to fetch profile data');
          }
        } else {
          setError('Could not resolve handle');
        }
      } catch (err) {
        setError('Error resolving handle');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    resolve();
  }, [handle]);

  if (isLoading) {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
        <Header simple />
        <ProfilePreviewSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
      </div>
    );
  }

  const parsed = parseURI(handle);

  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      {/* Site Header */}
      <Header simple />

      {/* Profile Preview */}
      {profileData && (
        <div className="content-fade-in">
          <ProfilePreview profile={profileData} />
        </div>
      )}

      <WaypointPicker
        type="profile"
        handle={resolvedHandle || handle}
        displayName={getDisplayName(resolvedHandle || handle, did || undefined)}
      />
    </div>
  );
}


