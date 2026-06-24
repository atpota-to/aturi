import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';
import { resolveHandle, getDisplayName } from '@/utils/uriParser';
import { resolveDidToHandle } from '@/utils/didResolver';
import { fetchProfile } from '@/utils/profileFetcher';
import { fetchRepoCollections } from '@/utils/atproto/identity';

type Props = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle: rawHandle } = await params;
  let handle = decodeURIComponent(rawHandle);
  
  // If handle starts with @, strip it for resolution
  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }
  
  try {
    const resolvedDid = await resolveHandle(handle);
    if (!resolvedDid) {
      return {
        title: 'Profile not found - aturi.to',
        description: 'Tour the Atmosphere',
      };
    }

    const profile = await fetchProfile(resolvedDid);
    const displayHandle = handle.startsWith('did:') 
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;
    
    if (profile) {
      const title = `${profile.displayName || displayHandle} (@${displayHandle})'s Atmosphere Profile`;
      const description = profile.description 
        ? profile.description.slice(0, 160) 
        : `View @${displayHandle}'s profile in your preferred Atmosphere client`;
      
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
    title: `@${handle} - aturi.to`,
    description: 'Tour the Atmosphere',
  };
}

async function ProfileContent({ handle }: { handle: string }) {
  const resolvedDid = await resolveHandle(handle);
  
  if (!resolvedDid) {
    return (
      <>
        <Header compact />
        <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
          <NotFoundPanel
            eyebrow="Couldn't resolve"
            headline="That handle didn't resolve."
            body={`We tried to resolve "${handle}" as an Atmosphere handle and didn't find anything. If you meant a different account, search for a handle, DID, or AT URI below.`}
            initialQuery={handle}
          />
        </div>
      </>
    );
  }

  const resolvedHandle = handle.startsWith('did:')
    ? await resolveDidToHandle(resolvedDid) || handle
    : handle;

  // Fetch the Bluesky profile and the repo's collection list together. The
  // collections feed the waypoint picker so it can hide clients the account
  // has no records for (e.g. no Tangled waypoint when there are no
  // sh.tangled.* records). A null result (failed scan) leaves every waypoint
  // visible rather than wrongly hiding them.
  const [profileData, repoCollections] = await Promise.all([
    fetchProfile(resolvedDid),
    fetchRepoCollections(resolvedDid),
  ]);

  return (
    <>
      <Header compact />
      <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
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
          repoCollections={repoCollections}
        />

        {/* Floating scroll indicator overlay */}
        <ScrollIndicator />
      </div>
    </>
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
        <>
          <Header compact />
          <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
            <ProfilePreviewSkeleton />
          </div>
        </>
      }
    >
      <ProfileContent handle={handle} />
    </Suspense>
  );
}


