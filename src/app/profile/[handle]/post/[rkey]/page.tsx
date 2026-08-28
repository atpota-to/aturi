import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import AutoRedirect from '@/components/AutoRedirect';
import AutoRedirectGate from '@/components/AutoRedirectGate';
import PostPreview from '@/components/PostPreview';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';
import { parseURI, resolveHandle, getDisplayName } from '@/utils/uriParser';
import { fetchRecordData } from '@/utils/recordFetcher';
import { resolveDidToHandle } from '@/utils/didResolver';
import { buildPostMetadata, buildPostJsonLd } from '@/utils/postMetadata';
import { serializeJsonLd } from '@/utils/sanitize';

/**
 * ISR. Unlike the /explore shells this route really does fetch on the server —
 * handle resolution and then the record itself, once in generateMetadata and
 * again in RecordContent — so caching the render is what takes those upstream
 * calls off the hot path. The same record is reachable at four spellings (bare
 * and /profile/, handle and DID); the canonical tag consolidates those for
 * ranking but does not stop a crawler fetching all four, so a good share of the
 * pressure here is repeat renders of byte-identical output.
 *
 * Five minutes, and the ceiling is set by what goes stale rather than by what
 * there is to save. A deleted record keeps rendering for up to that long — and
 * so does a transient failure, because fetchRecordData returns null for both a
 * deleted record and an unreachable host, and the "couldn't load a preview"
 * notice is a 200 as far as the cache is concerned. A blip at the wrong moment
 * therefore pins that notice for five minutes instead of for one request. That
 * is the trade, bounded deliberately rather than left open.
 */
export const revalidate = 300;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}

type Props = {
  params: Promise<{ handle: string; rkey: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle: rawHandle, rkey: rawRkey } = await params;
  let handle = decodeURIComponent(rawHandle);
  const rkey = decodeURIComponent(rawRkey);
  const collection = 'app.bsky.feed.post';
  
  // If handle starts with @, strip it for resolution
  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }
  
  try {
    const resolvedDid = await resolveHandle(handle);
    if (!resolvedDid) {
      return {
        title: 'Post not found - aturi.to',
        description: 'Tour the Atmosphere',
      };
    }

    // Parse and fetch post data
    parseURI(handle, collection, rkey); // Validate URI format
    const recordData = await fetchRecordData(resolvedDid, collection, rkey);

    if (recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post) {
      const post = recordData.data.thread[0].value.post;
      return buildPostMetadata(post, { resolvedDid, collection, rkey });
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: `Post: View on Aturi`,
    description: 'Tour the Atmosphere',
  };
}

async function PostContent({ handle, rkey }: { handle: string; rkey: string }) {
  const collection = 'app.bsky.feed.post';
  
  try {
    const parsedData = parseURI(handle, collection, rkey);
    
    if (parsedData.error) {
      return (
        <>
          <Header compact />
          <div className="container-narrow" style={{ padding: '0 2rem 4rem', textAlign: 'center' }}>
            <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
            <p style={{ color: 'var(--text-secondary)' }}>{parsedData.error}</p>
          </div>
        </>
      );
    }

    const resolvedDid = await resolveHandle(handle);
    
    if (!resolvedDid) {
      return (
        <>
          <Header compact />
          <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
            <NotFoundPanel
              eyebrow="Couldn't resolve"
              headline="That handle didn't resolve."
              body={`We tried to resolve "${handle}" as an Atmosphere handle and didn't find anything. Try a different handle, DID, or AT URI below.`}
              initialQuery={handle}
            />
          </div>
        </>
      );
    }

    const resolvedHandle = handle.startsWith('did:')
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;

    const recordData = await fetchRecordData(resolvedDid, collection, rkey);

    const post =
      recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post
        ? recordData.data.thread[0].value.post
        : null;

    const jsonLd = post ? buildPostJsonLd(post) : null;

    const atUri = post?.uri || '';

    return (
      <>
        {/* Inside the Suspense boundary rather than in the outer component,
            because the DID is only known here — and the explorer waypoints
            can't build a URL without it. One flush later than the other two
            waypoint pages, still ahead of the picker's markup. */}
        <AutoRedirect
          type="post"
          handle={resolvedHandle}
          did={resolvedDid}
          collection={collection}
          rkey={rkey}
        />
        <Header compact />
        <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>
        <AutoRedirectGate
          type="post"
          handle={resolvedHandle}
          did={resolvedDid}
          collection={collection}
          rkey={rkey}
        />

        {/* AT-URI alternate link, mirroring Bluesky's bskyweb template.
            React 19 hoists this to <head>. */}
        {atUri && <link rel="alternate" href={atUri} />}

        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
          />
        )}

        {post && recordData && recordData.type === 'post' && (
          <div className="content-fade-in">
            <PostPreview
              post={post}
              parent={recordData.data.parent}
            />
          </div>
        )}

        {/* Covers both a deleted post and a transient host failure (the fetch
            returns null for both), so the visitor isn't shown a bare picker
            with no explanation. The picker still renders below. */}
        {!post && (
          <div
            className="content-fade-in"
            style={{
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-secondary)',
              padding: '1rem 1.25rem',
              marginBottom: '1.5rem',
              color: 'var(--text-secondary)',
              fontSize: '0.9375rem',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              We couldn&rsquo;t load a preview for this post.
            </strong>{' '}
            It may have been deleted, or the account&rsquo;s host server may be
            temporarily unavailable. You can still try opening it in a client below.
          </div>
        )}

        <WaypointPicker
          type="post"
          handle={resolvedHandle}
          collection={collection}
          rkey={rkey}
          did={resolvedDid}
          displayName={getDisplayName(resolvedHandle, resolvedDid)}
        />

        {/* Floating scroll indicator overlay */}
        <ScrollIndicator />
        </div>
      </>
    );
  } catch (error) {
    console.error('Error loading post:', error);
    return (
      <>
        <Header compact />
        <div className="container-narrow" style={{ padding: '0 2rem 4rem', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Error loading post</p>
        </div>
      </>
    );
  }
}

export default async function PostPage({ params }: Props) {
  const { handle: rawHandle, rkey: rawRkey } = await params;
  let handle = decodeURIComponent(rawHandle);
  const rkey = decodeURIComponent(rawRkey);

  // If handle starts with @, resolve to DID and redirect
  if (handle.startsWith('@')) {
    const cleanHandle = handle.slice(1);
    const resolvedDid = await resolveHandle(cleanHandle);
    
    if (resolvedDid) {
      // Redirect to canonical /profile/{did}/post/{rkey} URL
      redirect(`/profile/${resolvedDid}/post/${rkey}`);
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
            <PostPreviewSkeleton />
          </div>
        </>
      }
    >
      <PostContent handle={handle} rkey={rkey} />
    </Suspense>
  );
}


