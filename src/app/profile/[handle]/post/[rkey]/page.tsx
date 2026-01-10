import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import PostPreview from '@/components/PostPreview';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import { parseURI, resolveHandle, getDisplayName } from '@/utils/uriParser';
import { fetchRecordData } from '@/utils/recordFetcher';
import { resolveDidToHandle } from '@/utils/didResolver';

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
        description: 'Universal links for the ATmosphere',
      };
    }

    // Parse and fetch post data
    parseURI(handle, collection, rkey); // Validate URI format
    const recordData = await fetchRecordData(resolvedDid, collection, rkey);
    const displayHandle = handle.startsWith('did:') 
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;
    
    if (recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post) {
      const post = recordData.data.thread[0].value.post;
      const author = post.author;
      const title = `Post by ${author.displayName || author.handle} (@${author.handle}) on Bluesky — View on Aturi`;
      const description = post.record?.text 
        ? post.record.text.slice(0, 160) 
        : 'View this post on your preferred ATProto app';
      
      const ogUrl = new URL('/api/og/post', 'https://aturi.to');
      ogUrl.searchParams.set('handle', resolvedDid);
      ogUrl.searchParams.set('rkey', rkey);
      const ogImageUrl = ogUrl.toString();
      
      return {
        title,
        description,
        openGraph: {
          title,
          description,
          type: 'article',
          images: [
            {
              url: ogImageUrl,
              width: 1200,
              height: 630,
              alt: title,
            },
          ],
        },
        twitter: {
          card: 'summary_large_image',
          title,
          description,
          images: [ogImageUrl],
        },
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: `Post — View on Aturi`,
    description: 'Universal links for the ATmosphere',
  };
}

async function PostContent({ handle, rkey }: { handle: string; rkey: string }) {
  const collection = 'app.bsky.feed.post';
  
  try {
    const parsedData = parseURI(handle, collection, rkey);
    
    if (parsedData.error) {
      return (
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
          <Header compact />
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{parsedData.error}</p>
        </div>
      );
    }

    const resolvedDid = await resolveHandle(handle);
    
    if (!resolvedDid) {
      return (
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
          <Header compact />
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Could not resolve handle: {handle}</p>
        </div>
      );
    }

    const resolvedHandle = handle.startsWith('did:')
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;

    const recordData = await fetchRecordData(resolvedDid, collection, rkey);

    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
        <Header compact />

        {recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post && (
          <div className="content-fade-in">
            <PostPreview 
              post={recordData.data.thread[0].value.post} 
              parent={recordData.data.parent}
            />
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
    );
  } catch (error) {
    console.error('Error loading post:', error);
    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
        <Header compact />
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Error loading post</p>
      </div>
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
      // Redirect to DID-based URL
      redirect(`/${resolvedDid}/app.bsky.feed.post/${rkey}`);
    }
    
    // If resolution fails, continue with cleaned handle
    handle = cleanHandle;
  }

  return (
    <Suspense
      fallback={
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
          <Header compact />
          <PostPreviewSkeleton />
        </div>
      }
    >
      <PostContent handle={handle} rkey={rkey} />
    </Suspense>
  );
}


