import { Metadata } from 'next';
import { Suspense } from 'react';
import WaypointPicker from '@/components/WaypointPicker';
import PostPreview from '@/components/PostPreview';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import RecordPreview from '@/components/RecordPreview';
import RecordPreviewSkeleton from '@/components/RecordPreviewSkeleton';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import { parseURI, resolveHandle, getDisplayName, type ParsedURI } from '@/utils/uriParser';
import { fetchRecordData, type PostThread, type GenericRecord } from '@/utils/recordFetcher';
import { resolveDidToHandle } from '@/utils/didResolver';
import { getSiteUrl } from '@/lib/config';

type Props = {
  params: Promise<{ handle: string; collection: string; rkey: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle: rawHandle, collection: rawCollection, rkey: rawRkey } = await params;
  const handle = decodeURIComponent(rawHandle);
  const collection = decodeURIComponent(rawCollection);
  const rkey = decodeURIComponent(rawRkey);
  
  try {
    const resolvedDid = await resolveHandle(handle);
    if (!resolvedDid) {
      return {
        title: 'Record not found - aturi.to',
        description: 'Universal links for the ATmosphere',
      };
    }

    const parsedData = parseURI(handle, collection, rkey);
    const recordData = await fetchRecordData(resolvedDid, collection, rkey);
    const displayHandle = handle.startsWith('did:') 
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;
    
    if (recordData) {
      let title = '';
      let description = '';
      let ogImageUrl = '';

      if (recordData.type === 'post' && recordData.data.thread[0]?.value.post) {
        const post = recordData.data.thread[0].value.post;
        const author = post.author;
        title = `Post by ${author.displayName || author.handle} (@${author.handle}) on Bluesky — View on Aturi`;
        description = post.record?.text 
          ? post.record.text.slice(0, 160) 
          : 'View this post on your preferred ATProto app';
        
        const ogUrl = new URL('/api/og/post', getSiteUrl());
        ogUrl.searchParams.set('handle', resolvedDid);
        ogUrl.searchParams.set('rkey', rkey);
        ogImageUrl = ogUrl.toString();
      } else if (recordData.type === 'record') {
        const record = recordData.data;
        
        if (collection === 'app.bsky.graph.list' || collection.endsWith('.list')) {
          title = record.value?.name 
            ? `${record.value.name} — ATProto List by @${displayHandle}`
            : `ATProto List by @${displayHandle}`;
          description = record.value?.description 
            ? record.value.description.slice(0, 160)
            : 'View this list on your preferred ATProto app';
          
          const ogUrl = new URL('/api/og/list', getSiteUrl());
          ogUrl.searchParams.set('handle', resolvedDid);
          ogUrl.searchParams.set('rkey', rkey);
          ogImageUrl = ogUrl.toString();
        } else {
          // Generic record type
          const collectionName = collection.split('.').pop() || collection;
          title = `${collection} record by ${displayHandle} (@${displayHandle}) — View on Aturi`;
          description = `View this ${collectionName} record on your preferred ATProto app`;
        }
      }
      
      return {
        title,
        description,
        openGraph: {
          title,
          description,
          type: 'article',
          images: ogImageUrl ? [
            {
              url: ogImageUrl,
              width: 1200,
              height: 630,
              alt: title,
            },
          ] : undefined,
        },
        twitter: {
          card: 'summary_large_image',
          title,
          description,
          images: ogImageUrl ? [ogImageUrl] : undefined,
        },
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: `Record — View on Aturi`,
    description: 'Universal links for the ATmosphere',
  };
}

async function RecordContent({ handle, collection, rkey }: { handle: string; collection: string; rkey: string }) {
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

    if (parsedData.type === 'unknown') {
      return (
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
          <Header compact />
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Invalid or unsupported URI</p>
        </div>
      );
    }

    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
        <Header compact />

        {recordData && (
          <div className="content-fade-in">
            {recordData.type === 'post' && recordData.data.thread[0]?.value.post && (
              <PostPreview post={recordData.data.thread[0].value.post} />
            )}
            {recordData.type === 'record' && (
              <RecordPreview 
                record={recordData.data} 
                collection={collection}
                handle={resolvedHandle}
                rkey={rkey}
              />
            )}
          </div>
        )}

        <ScrollIndicator />

        <WaypointPicker
          type={parsedData.type}
          handle={resolvedHandle}
          collection={collection}
          rkey={rkey}
          displayName={getDisplayName(resolvedHandle, resolvedDid)}
        />
      </div>
    );
  } catch (error) {
    console.error('Error loading record:', error);
    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem', textAlign: 'center' }}>
        <Header compact />
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Error processing URI</p>
      </div>
    );
  }
}

export default async function RecordPage({ params }: Props) {
  const { handle: rawHandle, collection: rawCollection, rkey: rawRkey } = await params;
  const handle = decodeURIComponent(rawHandle);
  const collection = decodeURIComponent(rawCollection);
  const rkey = decodeURIComponent(rawRkey);

  return (
    <Suspense
      fallback={
        <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
          <Header compact />
          <PostPreviewSkeleton />
        </div>
      }
    >
      <RecordContent handle={handle} collection={collection} rkey={rkey} />
    </Suspense>
  );
}


