import { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import PostPreview from '@/components/PostPreview';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import RecordPreview from '@/components/RecordPreview';
import ScrollIndicator from '@/components/ScrollIndicator';
import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';
import { parseURI, resolveHandle, getDisplayName } from '@/utils/uriParser';
import { fetchRecordData } from '@/utils/recordFetcher';
import { resolveDidToHandle } from '@/utils/didResolver';
import { buildPostMetadata, buildPostJsonLd } from '@/utils/postMetadata';
import { serializeJsonLd } from '@/utils/sanitize';
import { buildAtTagsMetadata } from '@/utils/atproto/atTags';
import { getMarginLexiconType, getMarginLexiconDisplayName, getMarginLexiconDescription } from '@/utils/marginLexicons';
import {
  MarginAnnotationPreview,
  MarginBookmarkPreview,
  MarginHighlightPreview,
  MarginCollectionPreview,
  MarginCollectionItemPreview,
  MarginReplyPreview,
  MarginLikePreview,
} from '@/components/margin';

type Props = {
  params: Promise<{ handle: string; collection: string; rkey: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle: rawHandle, collection: rawCollection, rkey: rawRkey } = await params;
  let handle = decodeURIComponent(rawHandle);
  const collection = decodeURIComponent(rawCollection);
  const rkey = decodeURIComponent(rawRkey);
  
  // If handle starts with @, strip it for resolution
  if (handle.startsWith('@')) {
    handle = handle.slice(1);
  }
  
  try {
    const resolvedDid = await resolveHandle(handle);
    if (!resolvedDid) {
      return {
        title: 'Record not found - aturi.to',
        description: 'Tour the Atmosphere',
      };
    }

    // Parse and fetch record data
    parseURI(handle, collection, rkey); // Validate URI format
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
        return buildPostMetadata(post, { resolvedDid, collection, rkey });
      } else if (recordData.type === 'record') {
        const record = recordData.data;
        const marginLexiconType = getMarginLexiconType(collection);
        
        if (collection === 'app.bsky.graph.list' || collection.endsWith('.list')) {
          title = record.value?.name 
            ? `${record.value.name}: Atmosphere List by @${displayHandle}`
            : `Atmosphere List by @${displayHandle}`;
          description = record.value?.description 
            ? record.value.description.slice(0, 160)
            : 'View this list in your preferred Atmosphere client';
          
          const ogUrl = new URL('/api/og/list', 'https://aturi.to');
          ogUrl.searchParams.set('handle', resolvedDid);
          ogUrl.searchParams.set('rkey', rkey);
          ogImageUrl = ogUrl.toString();
        } else if (marginLexiconType) {
          // Custom metadata for margin lexicons
          const lexiconDisplayName = getMarginLexiconDisplayName(collection);
          const lexiconDescription = getMarginLexiconDescription(collection);
          
          switch (marginLexiconType) {
            case 'at.margin.annotation':
              title = record.value?.target?.title
                ? `Annotation on "${record.value.target.title}" by @${displayHandle}`
                : `Annotation by @${displayHandle}: View on Aturi`;
              description = record.value?.body?.value
                ? record.value.body.value.slice(0, 160)
                : lexiconDescription;
              break;
            case 'at.margin.bookmark':
              title = record.value?.title
                ? `Bookmark: ${record.value.title} by @${displayHandle}`
                : `Bookmark by @${displayHandle}: View on Aturi`;
              description = record.value?.description
                ? record.value.description.slice(0, 160)
                : record.value?.source || lexiconDescription;
              break;
            case 'at.margin.highlight':
              title = record.value?.target?.title
                ? `Highlight on "${record.value.target.title}" by @${displayHandle}`
                : `Highlight by @${displayHandle}: View on Aturi`;
              description = record.value?.target?.selector?.exact
                ? record.value.target.selector.exact.slice(0, 160)
                : lexiconDescription;
              break;
            case 'at.margin.collection':
              title = record.value?.name
                ? `${record.value.name}: Margin Collection by @${displayHandle}`
                : `Margin Collection by @${displayHandle}`;
              description = record.value?.description
                ? record.value.description.slice(0, 160)
                : lexiconDescription;
              break;
            case 'at.margin.reply':
              title = `Reply by @${displayHandle}: View on Aturi`;
              description = record.value?.text
                ? record.value.text.slice(0, 160)
                : lexiconDescription;
              break;
            case 'at.margin.like':
            case 'at.margin.collectionItem':
              title = `${lexiconDisplayName} by @${displayHandle}: View on Aturi`;
              description = lexiconDescription;
              break;
            default:
              title = `${lexiconDisplayName} by @${displayHandle}: View on Aturi`;
              description = lexiconDescription;
          }
        } else {
          // Generic record type
          const collectionName = collection.split('.').pop() || collection;
          title = `${collection} record by ${displayHandle} (@${displayHandle}): View on Aturi`;
          description = `View this ${collectionName} record in your preferred Atmosphere client`;
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
        // AT Tags (https://tangled.org/chrisshank.com/at-tags/): this page
        // renders the record at `at://{did}/{collection}/{rkey}`, authored by
        // {did}, so declare both for extensions/crawlers/verifiers.
        other: buildAtTagsMetadata({
          canonical: `at://${resolvedDid}/${collection}/${rkey}`,
          author: `at://${resolvedDid}`,
        }),
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: `Record: View on Aturi`,
    description: 'Tour the Atmosphere',
  };
}

async function RecordContent({ handle, collection, rkey }: { handle: string; collection: string; rkey: string }) {
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

    if (parsedData.type === 'unknown') {
      return (
        <>
          <Header compact />
          <div className="container-narrow" style={{ padding: '0 2rem 4rem', textAlign: 'center' }}>
            <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Invalid or unsupported URI</p>
          </div>
        </>
      );
    }

    // Determine if this is a margin lexicon with custom preview
    const marginLexiconType = getMarginLexiconType(collection);

    // Build JSON-LD for Bluesky posts so Apple LinkPresentation and search
    // engines can identify the page as a discussion forum posting.
    const post =
      recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post
        ? recordData.data.thread[0].value.post
        : null;
    const jsonLd = post ? buildPostJsonLd(post) : null;

    const postAtUri = post?.uri || '';

    return (
      <>
        <Header compact />
        <div className="container-narrow waypoint-page" style={{ padding: '0 2rem 4rem' }}>

        {/* AT-URI alternate link, mirroring Bluesky's bskyweb template.
            React 19 hoists this to <head>. */}
        {postAtUri && <link rel="alternate" href={postAtUri} />}

        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
          />
        )}

        {recordData && (
          <div className="content-fade-in">
            {recordData.type === 'post' && recordData.data.thread[0]?.value.post && (
              <PostPreview 
                post={recordData.data.thread[0].value.post} 
                parent={recordData.data.parent}
              />
            )}
            {recordData.type === 'record' && (
              <>
                {/* Render custom margin preview if available */}
                {marginLexiconType === 'at.margin.annotation' && (
                  <MarginAnnotationPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.bookmark' && (
                  <MarginBookmarkPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.highlight' && (
                  <MarginHighlightPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.collection' && (
                  <MarginCollectionPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.collectionItem' && (
                  <MarginCollectionItemPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.reply' && (
                  <MarginReplyPreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {marginLexiconType === 'at.margin.like' && (
                  <MarginLikePreview
                    record={recordData.data}
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
                {/* Fall back to generic record preview if not a margin lexicon */}
                {!marginLexiconType && (
                  <RecordPreview 
                    record={recordData.data} 
                    collection={collection}
                    handle={resolvedHandle}
                    rkey={rkey}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* The record fetch returns null for both a deleted/nonexistent record
            and a transient host failure, so this notice covers both honestly
            rather than silently showing the picker with no preview and no
            explanation. The picker still renders below — its client links work
            if the record exists elsewhere or the host recovers. */}
        {!recordData && (
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
              We couldn&rsquo;t load a preview for this record.
            </strong>{' '}
            It may have been deleted, or the account&rsquo;s host server may be
            temporarily unavailable. You can still try opening it in a client below.
          </div>
        )}

        <WaypointPicker
          type={parsedData.type}
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
    console.error('Error loading record:', error);
    return (
      <>
        <Header compact />
        <div className="container-narrow" style={{ padding: '0 2rem 4rem', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Error processing URI</p>
        </div>
      </>
    );
  }
}

export default async function RecordPage({ params }: Props) {
  const { handle: rawHandle, collection: rawCollection, rkey: rawRkey } = await params;
  let handle = decodeURIComponent(rawHandle);
  const collection = decodeURIComponent(rawCollection);
  const rkey = decodeURIComponent(rawRkey);

  // If handle starts with @, resolve to DID and redirect
  if (handle.startsWith('@')) {
    const cleanHandle = handle.slice(1);
    const resolvedDid = await resolveHandle(cleanHandle);
    
    if (resolvedDid) {
      // Redirect to canonical /profile/{did}/{collection}/{rkey} URL
      redirect(`/profile/${resolvedDid}/${collection}/${rkey}`);
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
      <RecordContent handle={handle} collection={collection} rkey={rkey} />
    </Suspense>
  );
}


