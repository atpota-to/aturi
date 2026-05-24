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
import { getPostOgImage } from '@/utils/postOgImage';

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
    const displayHandle = handle.startsWith('did:') 
      ? await resolveDidToHandle(resolvedDid) || handle
      : handle;
    
    if (recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post) {
      const post = recordData.data.thread[0].value.post;
      const author = post.author;
      const authorByline = author.displayName
        ? `${author.displayName} (@${author.handle})`
        : `@${author.handle}`;
      const pageTitle = `@${author.handle} on Bluesky — View on Aturi`;
      const postText = post.record?.text || '';
      const description = postText || 'View this post in your preferred Atmosphere client';
      const avatarThumb = author.avatar
        ? author.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/')
        : '';

      // Prefer the post's embedded media (photo/video/external thumb) so
      // rich-link previewers (iMessage, Twitter, Slack, etc.) render the
      // large image like bsky.app does. Fall back to the avatar thumbnail
      // for text-only or quote-only posts.
      const postOgImage = getPostOgImage(post);
      const ogImage = postOgImage
        ? {
            url: postOgImage.url,
            ...(postOgImage.alt ? { alt: postOgImage.alt } : {}),
            ...(postOgImage.width && postOgImage.height
              ? { width: postOgImage.width, height: postOgImage.height }
              : {}),
          }
        : avatarThumb
        ? { url: avatarThumb }
        : null;
      const twitterCard = postOgImage ? 'summary_large_image' : 'summary';

      const canonicalUrl = `https://aturi.to/profile/${author.handle}/post/${rkey}`;
      const atUri = `at://${resolvedDid}/${collection}/${rkey}`;
      const oembedUrl = `https://aturi.to/api/oembed?format=json&url=${encodeURIComponent(atUri)}`;
      const publishedTime = post.indexedAt || post.record?.createdAt;

      // We MUST set openGraph and twitter blocks here to override the root
      // layout's site-wide defaults. Without this, the root layout's
      // og:title="aturi.to - Universal links" and og:image=/api/og/static
      // bleed through and create conflicting tags that confuse Apple's
      // LinkPresentation framework and other rich-link previewers.
      return {
        title: pageTitle,
        description,
        alternates: {
          canonical: canonicalUrl,
          types: {
            'application/json+oembed': oembedUrl,
          },
        },
        openGraph: {
          title: authorByline,
          description: postText || description,
          type: 'article',
          url: canonicalUrl,
          siteName: 'Aturi',
          ...(publishedTime ? { publishedTime } : {}),
          ...(ogImage ? { images: [ogImage] } : {}),
        },
        twitter: {
          card: twitterCard,
          title: authorByline,
          description: postText || description,
          ...(ogImage ? { images: [ogImage.url] } : {}),
        },
        other: {
          'profile:username': author.handle,
          ...(publishedTime
            ? {
                'twitter:label1': 'Posted At',
                'twitter:value1': publishedTime,
              }
            : {}),
          ...(post.likeCount
            ? {
                'twitter:label2': 'Likes',
                'twitter:value2': String(post.likeCount),
              }
            : {}),
          ...(post.replyCount
            ? {
                'twitter:label3': 'Replies',
                'twitter:value3': String(post.replyCount),
              }
            : {}),
          ...(post.repostCount
            ? {
                'twitter:label4': 'Reposts',
                'twitter:value4': String(post.repostCount),
              }
            : {}),
        },
      };
    }
  } catch (error) {
    console.error('Error generating metadata:', error);
  }

  return {
    title: `Post — View on Aturi`,
    description: 'Tour the Atmosphere',
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

    const post =
      recordData && recordData.type === 'post' && recordData.data.thread[0]?.value.post
        ? recordData.data.thread[0].value.post
        : null;

    const jsonLd = post
      ? {
          '@context': 'https://schema.org',
          '@type': 'DiscussionForumPosting',
          author: {
            '@type': 'Person',
            ...(post.author.displayName
              ? {
                  name: post.author.displayName,
                  alternateName: `@${post.author.handle}`,
                }
              : { name: `@${post.author.handle}` }),
            url: `https://aturi.to/profile/${post.author.handle}`,
          },
          ...(post.record?.text ? { text: post.record.text } : {}),
          datePublished: post.indexedAt || post.record?.createdAt,
          interactionStatistic: [
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/LikeAction',
              userInteractionCount: post.likeCount || 0,
            },
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/CommentAction',
              userInteractionCount: post.replyCount || 0,
            },
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/ShareAction',
              userInteractionCount: (post.repostCount || 0) + (post.quoteCount || 0),
            },
          ],
        }
      : null;

    const atUri = post?.uri || '';

    return (
      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
        <Header compact />

        {/* AT-URI alternate link, mirroring Bluesky's bskyweb template.
            React 19 hoists this to <head>. */}
        {atUri && <link rel="alternate" href={atUri} />}

        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
      // Redirect to canonical /profile/{did}/post/{rkey} URL
      redirect(`/profile/${resolvedDid}/post/${rkey}`);
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


