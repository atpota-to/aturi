import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import WaypointPicker from '@/components/WaypointPicker';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import { resolveHandle, getDisplayName } from '@/utils/uriParser';
import { resolveDidToHandle } from '@/utils/didResolver';
import { fetchProfile } from '@/utils/profileFetcher';

type Props = {
  params: Promise<{ locale: string; handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, handle: rawHandle } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.profile' });
  let handle = decodeURIComponent(rawHandle);

  // If handle starts with @, strip it for resolution
  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }

  try {
    const resolvedDid = await resolveHandle(handle);
    if (!resolvedDid) {
      return {
        title: t('notFoundTitle'),
        description: t('notFoundDescription'),
      };
    }

    const profile = await fetchProfile(resolvedDid);
    const displayHandle = handle.startsWith('did:')
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;

    if (profile) {
      const title = t('title', {
        name: profile.displayName || displayHandle,
        handle: displayHandle,
      });
      const description = profile.description
        ? profile.description.slice(0, 160)
        : t('descriptionFallback', { handle: displayHandle });
      
      // Generate OG image URL - hardcode production domain
      const ogImageUrl = new URL('/api/og/profile', 'https://aturi.to');
      ogImageUrl.searchParams.set('handle', resolvedDid);
      
      return {
        title,
        description,
        openGraph: {
          title,
          description,
          type: 'profile',
          images: [
            {
              url: ogImageUrl.toString(),
              width: 1200,
              height: 630,
              alt: `${profile.displayName || displayHandle}'s profile`,
            },
          ],
        },
        twitter: {
          card: 'summary_large_image',
          title,
          description,
          images: [ogImageUrl.toString()],
        },
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: t('rawTitle', { handle }),
    description: t('notFoundDescription'),
  };
}

async function ProfileContent({ handle }: { handle: string }) {
  const resolvedDid = await resolveHandle(handle);
  
  if (!resolvedDid) {
    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
        <Header compact />
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Could not resolve handle</p>
      </div>
    );
  }

  const resolvedHandle = handle.startsWith('did:')
    ? await resolveDidToHandle(resolvedDid) || handle
    : handle;

  const profileData = await fetchProfile(resolvedDid);

  return (
    <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
      <Header compact />

      {profileData && (
        <div className="content-fade-in">
          <ProfilePreview profile={profileData} />
        </div>
      )}

      <WaypointPicker
        type="profile"
        handle={resolvedHandle}
        did={resolvedDid}
        displayName={getDisplayName(resolvedHandle, resolvedDid)}
      />

      {/* Floating scroll indicator overlay */}
      <ScrollIndicator />
    </div>
  );
}

export default async function ProfilePage({ params }: Props) {
  const { handle: rawHandle } = await params;
  let handle = decodeURIComponent(rawHandle);
  
  // If handle starts with @, resolve to DID and redirect
  if (handle.startsWith('@')) {
    const cleanHandle = handle.slice(1);
    const resolvedDid = await resolveHandle(cleanHandle);
    
    if (resolvedDid) {
      // Redirect to canonical /profile/{did} URL
      redirect(`/profile/${resolvedDid}`);
    }
    
    // If resolution fails, continue with cleaned handle
    handle = cleanHandle;
  }

  return (
    <Suspense
      fallback={
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
          <Header compact />
          <ProfilePreviewSkeleton />
        </div>
      }
    >
      <ProfileContent handle={handle} />
    </Suspense>
  );
}


