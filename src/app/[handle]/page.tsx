import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect, notFound } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';
import { resolveHandle, resolveHandleStatus, getDisplayName } from '@/utils/uriParser';
import { resolveDidToHandle } from '@/utils/didResolver';
import { fetchProfile } from '@/utils/profileFetcher';
import { fetchRepoCollections } from '@/utils/atproto/identity';
import { buildAtTagsMetadata } from '@/utils/atproto/atTags';
import { buildProfileCanonical } from '@/utils/canonicalUrl';
import { getSiteUrl } from '@/lib/config';

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
      
      // Absolute OG image URL, built from the site's own base so previews and
      // forks point at the deployment that's actually serving the page.
      const ogImageUrl = new URL('/api/og/profile', getSiteUrl());
      ogImageUrl.searchParams.set('handle', resolvedDid);
      
      return {
        title,
        description,
        // This page is served at both `/{handle}` and `/profile/{handle}`, with
        // either a handle or a DID — point every spelling at the DID form so
        // crawlers consolidate them into one page instead of crawling each.
        alternates: {
          canonical: buildProfileCanonical(resolvedDid),
        },
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
        // AT Tags (https://tangled.org/chrisshank.com/at-tags/): this page is
        // about a single atproto identity, so point `at:author` at its DID.
        other: buildAtTagsMetadata({
          author: `at://${resolvedDid}`,
        }),
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

async function ProfileContent({ handle, resolvedDid }: { handle: string; resolvedDid: string }) {
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

  // Resolve up front so /[handle] returns a real HTTP 404 for handles that
  // definitively don't resolve (scanners, typos) instead of a soft-404 (200)
  // that crawlers index. A transient resolver outage is NOT a 404 — it falls
  // through to a retry panel below. (Resolving here rather than inside the
  // Suspense child is what lets the 404 status be set before streaming begins,
  // mirroring the '@' redirect path above.)
  const resolution = await resolveHandleStatus(handle);
  if (resolution.reason === 'not-found') {
    notFound();
  }
  if (!resolution.did) {
    return (
      <>
        <Header compact />
        <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
          <NotFoundPanel
            eyebrow="Couldn't reach the resolver"
            headline="We couldn't look that up right now."
            body={`We couldn't reach the atproto resolver to look up "${handle}". This is usually temporary. Try again in a moment, or search for a handle, DID, or AT URI below.`}
            initialQuery={handle}
          />
        </div>
      </>
    );
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
      <ProfileContent handle={handle} resolvedDid={resolution.did} />
    </Suspense>
  );
}


