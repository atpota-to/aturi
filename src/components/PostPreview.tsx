/**
 * PostPreview Component
 * Displays a rich preview card for Bluesky posts
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BskyPost, UnknownRecordValue } from '@/utils/recordFetcher';
import { getEmbedImages, type EmbedDisplayImage } from '@/utils/postEmbeds';
import { formatCount } from '@/utils/ufos/format';
import { sanitizeFacetLink, sanitizeDid, sanitizeHashtag, sanitizeUrl, sanitizeHandle } from '@/utils/sanitize';
import { User, MessageSquare, Repeat2, Heart, Quote, CornerDownRight, Telescope, Globe } from 'lucide-react';
import { explorePathFromAtUri } from '@/utils/atproto/urls';

type PostPreviewProps = {
  post: BskyPost;
  parent?: BskyPost;
  /**
   * When true, suppress the "View raw record in the explorer" footer link.
   * Used inside the explorer, which is itself the link's destination.
   */
  hideExplorerCtas?: boolean;
};

// Compact, Bluesky-style relative timestamp ("now", "5m", "2h", "3d",
// "2w", "5mo", "1y"). Keeps the post footer from being squished on narrow
// screens; the full timestamp is retained on hover via a title tooltip.
// Future timestamps (clock skew) clamp to "now".
const formatRelativeTime = (date: Date, now: Date = new Date()): string => {
  const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  if (day < 30) return `${Math.floor(day / 7)}w`;
  if (day < 365) return `${Math.floor(day / 30)}mo`;
  return `${Math.floor(day / 365)}y`;
};

// Build a canonical post URL from an AT URI and the post's author.
// Returns null if either piece is missing or doesn't sanitize to a valid identifier.
const buildPostUrl = (uri?: string, author?: { did?: string; handle?: string }): string | null => {
  if (!uri || !author) return null;
  const rkey = uri.split('/').pop();
  const id = sanitizeDid(author.did) || sanitizeHandle(author.handle);
  if (!rkey || !id) return null;
  return `/profile/${id}/post/${rkey}`;
};

// Shared grid for a post's image embeds, used by the main post, the parent
// preview, quoted posts, and recordWithMedia media. Renders both the classic
// images embed (1–4) and the gallery embed (5+) identically — callers pass a
// normalized list from getEmbedImages. Galleries (5+) lay out in 3 columns;
// smaller sets keep the original 1/2-column behaviour.
function EmbedImageGrid({
  images,
  gap,
  marginTop,
  marginBottom,
  maxHeight,
  background,
  boxShadow,
  limit,
  stopPropagation,
}: {
  images: EmbedDisplayImage[];
  gap: string;
  marginTop?: string;
  marginBottom?: string;
  maxHeight: string;
  background: string;
  boxShadow: string;
  /** Cap the number of images shown (e.g. the parent preview shows 2). */
  limit?: number;
  /** Stop click propagation so opening an image doesn't trigger card nav. */
  stopPropagation?: boolean;
}) {
  const shown = typeof limit === 'number' ? images.slice(0, limit) : images;
  const columns =
    shown.length === 1 ? '1fr' : shown.length >= 5 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap, marginTop, marginBottom }}>
      {shown.map((image, i) => {
        const sanitizedFullsize = sanitizeUrl(image.fullsize);
        const sanitizedThumb = sanitizeUrl(image.thumb);

        return (
          <a
            key={i}
            href={sanitizedFullsize}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
            style={{ display: 'block', overflow: 'hidden' }}
          >
            <img
              src={sanitizedThumb}
              alt={image.alt}
              style={{
                width: '100%',
                height: 'auto',
                maxHeight,
                objectFit: 'cover',
                background,
                display: 'block',
                border: '1px solid var(--border-medium)',
                boxShadow,
              }}
            />
          </a>
        );
      })}
    </div>
  );
}

export default function PostPreview({ post, parent, hideExplorerCtas }: PostPreviewProps) {
  const router = useRouter();
  const { author, record, embed, replyCount, repostCount, likeCount, quoteCount } = post;

  // Format the date nicely
  const createdAt = new Date(record.createdAt);
  const formattedDate = createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Compact relative form shown in the footer; the full date above stays
  // available on hover so no information is lost. Falls back to the full
  // string for unparseable dates (toISOString would otherwise throw).
  const validDate = !Number.isNaN(createdAt.getTime());
  const relativeDate = validDate ? formatRelativeTime(createdAt) : formattedDate;

  // Quote embeds mix several view shapes (ViewRecord, ViewNotFound,
  // ViewBlocked, nested re-quotes), so field access is dynamic by design.
  const renderQuotedPost = (quotedPost: UnknownRecordValue) => {
    if (!quotedPost) return null;

    // Handle blocked/not found records
    if (quotedPost.notFound || quotedPost.blocked) {
      return (
        <div
          style={{
            border: '1px solid var(--border-medium)',
            padding: '1rem',
            marginBottom: '1rem',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
            fontSize: '0.875rem',
          }}
        >
          {quotedPost.notFound ? 'Post not found' : 'Post unavailable'}
        </div>
      );
    }

    const qAuthor = quotedPost.author;
    const qRecord = quotedPost.value || quotedPost.record || {};
    const qEmbeds = quotedPost.embeds || [];
    const quoteUrl = buildPostUrl(quotedPost.uri, qAuthor);

    return (
      <div
        {...(quoteUrl
          ? {
              role: 'link',
              tabIndex: 0,
              onClick: () => router.push(quoteUrl),
              onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(quoteUrl);
                }
              },
              onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
                e.currentTarget.style.borderColor = 'var(--text-accent)';
              },
              onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
                e.currentTarget.style.borderColor = 'var(--border-medium)';
              },
            }
          : {})}
        style={{
          border: '1px solid var(--border-medium)',
          padding: '1rem',
          marginBottom: '1rem',
          background: 'var(--bg-tertiary)',
          transition: 'border-color 0.2s ease',
          ...(quoteUrl ? { cursor: 'pointer' } : {}),
        }}
      >
        {/* Quoted post author */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <a
            href={qAuthor?.did || qAuthor?.handle ? `/${sanitizeDid(qAuthor.did) || sanitizeHandle(qAuthor.handle)}` : '#'}
            onClick={(e) => e.stopPropagation()}
            style={{ textDecoration: 'none', flexShrink: 0 }}
          >
            {qAuthor?.avatar ? (
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: '1px solid var(--accent-stone)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--text-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-stone)';
                }}
              >
                <img
                  src={sanitizeUrl(qAuthor.avatar)}
                  alt={qAuthor.displayName || qAuthor.handle}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: '1px solid var(--accent-stone)',
                  background: 'var(--bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'border-color 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--text-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-stone)';
                }}
              >
                <User size={14} color="var(--text-tertiary)" />
              </div>
            )}
          </a>
          <div style={{ fontSize: '0.875rem' }}>
            <a
              href={qAuthor?.did || qAuthor?.handle ? `/${sanitizeDid(qAuthor.did) || sanitizeHandle(qAuthor.handle)}` : '#'}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontWeight: '600',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
            >
              {qAuthor?.displayName || qAuthor?.handle || 'Unknown'}
            </a>
            {qAuthor?.handle && (
              <>
                {' '}
                <a
                  href={qAuthor.did || qAuthor.handle ? `/${sanitizeDid(qAuthor.did) || sanitizeHandle(qAuthor.handle)}` : '#'}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: 'var(--text-tertiary)',
                    textDecoration: 'none',
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-tertiary)';
                  }}
                >
                  @{qAuthor.handle}
                </a>
              </>
            )}
          </div>
        </div>

        {/* Quoted post text */}
        {qRecord.text && (
          <div style={{ 
            fontSize: '0.875rem', 
            color: 'var(--text-secondary)', 
            marginBottom: qEmbeds.length > 0 ? '0.5rem' : '0',
            whiteSpace: 'pre-wrap',
          }}>
            {qRecord.text}
          </div>
        )}

        {/* Quoted post embeds - render them properly */}
        {qEmbeds.map((qEmbed: UnknownRecordValue, idx: number) => {
          // Images — classic images embed (1–4) or gallery embed (5+).
          const qImages = getEmbedImages(qEmbed);
          if (qImages) {
            return (
              <EmbedImageGrid
                key={idx}
                images={qImages}
                gap="0.25rem"
                marginTop="0.5rem"
                maxHeight="200px"
                background="var(--bg-secondary)"
                boxShadow="0 2px 8px rgba(0, 0, 0, 0.3)"
                stopPropagation
              />
            );
          }

          // External link
          if (qEmbed.$type === 'app.bsky.embed.external#view' && qEmbed.external) {
            const sanitizedExtUrl = sanitizeUrl(qEmbed.external.uri);
            if (sanitizedExtUrl === '#') return null; // Skip invalid URLs

            return (
              <a
                key={idx}
                href={sanitizedExtUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'block',
                  marginTop: '0.5rem',
                  border: '1px solid var(--border-medium)',
                  textDecoration: 'none',
                  color: 'inherit',
                  overflow: 'hidden',
                  fontSize: '0.75rem',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                }}
              >
                {qEmbed.external.thumb && (
                  <img
                    src={sanitizeUrl(qEmbed.external.thumb)}
                    alt=""
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: '150px',
                      objectFit: 'cover',
                      background: 'var(--bg-secondary)',
                      display: 'block',
                      borderBottom: '1px solid var(--border-medium)',
                    }}
                  />
                )}
                <div style={{ padding: '0.5rem' }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                    {qEmbed.external.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    {(() => {
                      try {
                        return new URL(sanitizedExtUrl).hostname;
                      } catch {
                        return '';
                      }
                    })()}
                  </div>
                </div>
              </a>
            );
          }

          // Video
          if (qEmbed.$type === 'app.bsky.embed.video#view' && qEmbed.playlist) {
            const sanitizedPlaylist = sanitizeUrl(qEmbed.playlist);
            const sanitizedThumbnail = sanitizeUrl(qEmbed.thumbnail);
            
            if (sanitizedPlaylist === '#') return null; // Skip invalid video URLs
            
            return (
              <div
                key={idx}
                onClick={(e) => e.stopPropagation()}
                style={{
                  marginTop: '0.5rem',
                  background: 'var(--bg-secondary)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-medium)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                }}
              >
                <video
                  controls
                  poster={sanitizedThumbnail}
                  style={{
                    width: '100%',
                    maxHeight: '200px',
                    display: 'block',
                  }}
                >
                  <source src={sanitizedPlaylist} type="application/x-mpegURL" />
                </video>
              </div>
            );
          }

          return null;
        })}

        {/* If no embeds were rendered but there's an embed object, show indicator */}
        {qEmbeds.length === 0 && quotedPost.embed && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
            {quotedPost.embed.$type === 'app.bsky.embed.images#view' && '📷 Images'}
            {quotedPost.embed.$type === 'app.bsky.embed.gallery#view' && '📷 Images'}
            {quotedPost.embed.$type === 'app.bsky.embed.external#view' && '🔗 Link'}
            {quotedPost.embed.$type === 'app.bsky.embed.video#view' && '🎥 Video'}
            {quotedPost.embed.$type === 'app.bsky.embed.record#view' && '💬 Quote'}
          </div>
        )}
      </div>
    );
  };

  // Helper function to convert UTF-8 byte offset to JavaScript string index
  // ATProto facets use UTF-8 byte offsets, but JS strings are UTF-16
  const utf8ByteToUtf16Index = (text: string, targetByteOffset: number): number => {
    const utf8Encoder = new TextEncoder();
    let utf16Index = 0;
    let utf8ByteCount = 0;
    
    // Use Array.from to properly iterate over code points (handles surrogate pairs)
    const codePoints = Array.from(text);
    
    for (let i = 0; i < codePoints.length; i++) {
      // Check if we've reached the target byte offset
      if (utf8ByteCount === targetByteOffset) {
        return utf16Index;
      }
      
      // If we've passed it, something's wrong but return current position
      if (utf8ByteCount > targetByteOffset) {
        return utf16Index;
      }
      
      const codePoint = codePoints[i];
      const utf8Bytes = utf8Encoder.encode(codePoint).length;
      
      // In JavaScript strings, most characters are 1 UTF-16 unit, but
      // characters outside the BMP (like many emoji) are 2 UTF-16 units (surrogate pairs)
      utf16Index += codePoint.length;
      utf8ByteCount += utf8Bytes;
    }
    
    // If we've processed all characters, return the final index
    return utf16Index;
  };

  // Parse text with facets (links, mentions, hashtags)
  const renderText = () => {
    if (!record.facets || record.facets.length === 0) {
      return <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{record.text}</p>;
    }

    type FacetFeature = NonNullable<BskyPost['record']['facets']>[number]['features'][number];
    const segments: Array<{ text: string; facet?: FacetFeature }> = [];
    let lastIndex = 0;

    // Sort facets by start index
    const sortedFacets = [...record.facets].sort(
      (a, b) => a.index.byteStart - b.index.byteStart
    );

    for (const facet of sortedFacets) {
      const { byteStart, byteEnd } = facet.index;
      
      // Convert byte indices to character indices
      const charStart = utf8ByteToUtf16Index(record.text, byteStart);
      const charEnd = utf8ByteToUtf16Index(record.text, byteEnd);

      // Add text before facet
      if (charStart > lastIndex) {
        segments.push({ text: record.text.slice(lastIndex, charStart) });
      }

      // Add facet text
      segments.push({
        text: record.text.slice(charStart, charEnd),
        facet: facet.features[0],
      });

      lastIndex = charEnd;
    }

    // Add remaining text
    if (lastIndex < record.text.length) {
      segments.push({ text: record.text.slice(lastIndex) });
    }

    return (
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', pointerEvents: 'auto' }}>
        {segments.map((segment, i) => {
          if (!segment.facet) {
            return <span key={i} style={{ pointerEvents: 'auto' }}>{segment.text}</span>;
          }

          const { $type } = segment.facet;

          if ($type === 'app.bsky.richtext.facet#link') {
            const sanitizedUrl = sanitizeFacetLink(segment.facet.uri);
            // Don't render link if URL is invalid
            if (sanitizedUrl === '#') {
              return <span key={i} style={{ color: 'var(--text-secondary)' }}>{segment.text}</span>;
            }
            return (
              <a
                key={i}
                href={sanitizedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-accent)', textDecoration: 'underline' }}
              >
                {segment.text}
              </a>
            );
          }

          if ($type === 'app.bsky.richtext.facet#mention') {
            const sanitizedDid = sanitizeDid(segment.facet.did);
            // Don't render link if DID is invalid
            if (!sanitizedDid) {
              return <span key={i} style={{ color: 'var(--text-secondary)' }}>{segment.text}</span>;
            }
            return (
              <a
                key={i}
                href={`/${sanitizedDid}`}
                style={{ color: 'var(--text-accent)', textDecoration: 'none' }}
              >
                {segment.text}
              </a>
            );
          }

          if ($type === 'app.bsky.richtext.facet#tag') {
            const sanitizedTag = sanitizeHashtag(segment.facet.tag);
            // Don't render link if tag is invalid
            if (!sanitizedTag) {
              return <span key={i} style={{ color: 'var(--text-secondary)' }}>{segment.text}</span>;
            }
            return (
              <a
                key={i}
                href={`https://bsky.app/hashtag/${sanitizedTag}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-accent)', textDecoration: 'none' }}
              >
                {segment.text}
              </a>
            );
          }

          return <span key={i}>{segment.text}</span>;
        })}
      </p>
    );
  };

  return (
    <>
      {/* Parent Post Context - shown if this is a reply */}
      {parent && (() => {
        const parentUrl = buildPostUrl(parent.uri, parent.author);
        return (
        <div
          {...(parentUrl
            ? {
                role: 'link',
                tabIndex: 0,
                onClick: () => router.push(parentUrl),
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(parentUrl);
                  }
                },
              }
            : {})}
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            position: 'relative',
            marginBottom: '-1.5rem',
            padding: '1rem 1.25rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            transform: 'rotate(-0.3deg) scale(0.96)',
            transformOrigin: 'top center',
            transition: 'all 0.4s ease',
            paddingBottom: '3rem',
            zIndex: 0,
          }}
          className="parent-card"
        >
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            marginBottom: '0.75rem',
            color: 'var(--text-tertiary)',
            fontSize: '0.875rem',
          }}>
            <CornerDownRight size={14} />
            <span>Replying to</span>
          </div>

          {/* Parent Author */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <a
              href={`/${sanitizeDid(parent.author.did) || sanitizeHandle(parent.author.handle)}`}
              onClick={(e) => e.stopPropagation()}
              style={{ textDecoration: 'none', flexShrink: 0 }}
            >
              {parent.author.avatar ? (
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    border: '1px solid var(--accent-stone)',
                    overflow: 'hidden',
                    transition: 'border-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-stone)';
                  }}
                >
                  <img
                    src={sanitizeUrl(parent.author.avatar)}
                    alt={parent.author.displayName || parent.author.handle}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    border: '1px solid var(--accent-stone)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'border-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-stone)';
                  }}
                >
                  <User size={16} color="var(--text-tertiary)" />
                </div>
              )}
            </a>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a
                href={`/${sanitizeDid(parent.author.did) || sanitizeHandle(parent.author.handle)}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  transition: 'color 0.2s ease',
                  fontSize: '0.875rem',
                  display: 'block',
                  lineHeight: '1.2',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
              >
                {parent.author.displayName || parent.author.handle}
              </a>
              <div style={{ fontSize: '0.875rem', lineHeight: '1.2' }}>
                <a
                  href={`/${sanitizeDid(parent.author.did) || sanitizeHandle(parent.author.handle)}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: 'var(--text-tertiary)',
                    textDecoration: 'none',
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-tertiary)';
                  }}
                >
                  @{parent.author.handle}
                </a>
              </div>
            </div>
          </div>

          {/* Parent Post Text (truncated) */}
          {parent.record.text && (
            <div
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                lineHeight: '1.4',
                marginBottom: parent.embed ? '0.5rem' : '0',
              }}
            >
              {parent.record.text}
            </div>
          )}

          {/* Parent Post Embeds - Show images/video/external links */}
          {parent.embed && (
            <>
              {/* Images — classic images embed (1–4) or gallery embed (5+). */}
              {(() => {
                const parentImages = getEmbedImages(parent.embed);
                if (!parentImages) return null;
                return (
                  <EmbedImageGrid
                    images={parentImages}
                    gap="0.25rem"
                    maxHeight="120px"
                    background="var(--bg-secondary)"
                    boxShadow="0 2px 8px rgba(0, 0, 0, 0.3)"
                    limit={2}
                    stopPropagation
                  />
                );
              })()}

              {/* External link */}
              {parent.embed.$type === 'app.bsky.embed.external#view' && parent.embed.external && (() => {
                const parentExtUri = sanitizeUrl(parent.embed.external.uri);
                const parentExtThumb = sanitizeUrl(parent.embed.external.thumb);

                if (parentExtUri === '#') return null; // Skip invalid/unsafe URLs

                return (
                <a
                  href={parentExtUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'block',
                    border: '1px solid var(--border-medium)',
                    textDecoration: 'none',
                    color: 'inherit',
                    overflow: 'hidden',
                    fontSize: '0.75rem',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {parent.embed.external.thumb && (
                    <img
                      src={parentExtThumb}
                      alt=""
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '100px',
                        objectFit: 'cover',
                        background: 'var(--bg-secondary)',
                        display: 'block',
                        borderBottom: '1px solid var(--border-medium)',
                      }}
                    />
                  )}
                  <div style={{ padding: '0.5rem' }}>
                    <div style={{ fontWeight: '600', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                      {parent.embed.external.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {(() => {
                        try {
                          return new URL(parentExtUri).hostname;
                        } catch {
                          return '';
                        }
                      })()}
                    </div>
                  </div>
                </a>
                );
              })()}

              {/* Video */}
              {parent.embed.$type === 'app.bsky.embed.video#view' && parent.embed.playlist && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'var(--bg-secondary)',
                    overflow: 'hidden',
                    border: '1px solid var(--border-medium)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <video
                    controls
                    poster={parent.embed.thumbnail}
                    style={{
                      width: '100%',
                      maxHeight: '150px',
                      display: 'block',
                    }}
                  >
                    <source src={parent.embed.playlist} type="application/x-mpegURL" />
                  </video>
                </div>
              )}
            </>
          )}
        </div>
        );
      })()}

      <div
        style={{
          position: 'relative',
          marginBottom: '2rem',
          padding: '1.5rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          transform: 'rotate(0.4deg)',
          transition: 'all 0.4s ease',
          boxShadow: parent ? '0 8px 24px rgba(0, 0, 0, 0.4)' : 'none',
          zIndex: 1,
        }}
        className="card"
      >
      {/* Author Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <a
          href={`/${sanitizeDid(author.did) || sanitizeHandle(author.handle)}`}
          style={{ textDecoration: 'none', flexShrink: 0 }}
        >
          {author.avatar ? (
            <div
              style={{
                width: '48px',
                height: '48px',
                border: '2px solid var(--accent-stone)',
                overflow: 'hidden',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--text-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-stone)';
              }}
            >
              <img
                src={sanitizeUrl(author.avatar)}
                alt={author.displayName || author.handle}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  background: 'var(--bg-tertiary)',
                  display: 'block',
                }}
              />
            </div>
          ) : (
            <div
              style={{
                width: '48px',
                height: '48px',
                border: '2px solid var(--accent-stone)',
                background: 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--text-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-stone)';
              }}
            >
              <User size={24} color="var(--text-tertiary)" />
            </div>
          )}
        </a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={`/${sanitizeDid(author.did) || sanitizeHandle(author.handle)}`}
            style={{
              fontWeight: '600',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
              display: 'block',
              lineHeight: '1.2',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
          >
            {author.displayName || author.handle}
            {author.pronouns && (
              <span style={{ fontWeight: '400', color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>
                {author.pronouns}
              </span>
            )}
          </a>
          <div style={{ fontSize: '0.875rem', lineHeight: '1.2' }}>
            <a
              href={`/${sanitizeDid(author.did) || sanitizeHandle(author.handle)}`}
              style={{
                color: 'var(--text-tertiary)',
                textDecoration: 'none',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
            >
              @{author.handle}
            </a>
          </div>
        </div>
      </div>

      {/* Post Content */}
      <div style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1rem', lineHeight: '1.5', pointerEvents: 'auto' }}>
        {renderText()}
      </div>

      {/* Embed - Images (classic images embed 1–4 or gallery embed 5+) */}
      {(() => {
        const mainImages = getEmbedImages(embed);
        if (!mainImages) return null;
        return (
          <EmbedImageGrid
            images={mainImages}
            gap="0.5rem"
            marginBottom="1rem"
            maxHeight="1000px"
            background="var(--bg-tertiary)"
            boxShadow="0 4px 12px rgba(0, 0, 0, 0.4)"
          />
        );
      })()}

      {/* Embed - External Link */}
      {embed?.$type === 'app.bsky.embed.external#view' && embed.external && (() => {
        const sanitizedExtUri = sanitizeUrl(embed.external.uri);
        const sanitizedExtThumb = sanitizeUrl(embed.external.thumb);
        
        if (sanitizedExtUri === '#') return null; // Skip invalid URLs
        
        return (
          <a
            href={sanitizedExtUri}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              marginBottom: '1rem',
              border: '1px solid var(--border-medium)',
              textDecoration: 'none',
              color: 'inherit',
              overflow: 'hidden',
              transition: 'border-color 0.2s ease',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
            className="external-link-card"
          >
            {embed.external.thumb && (
              <img
                src={sanitizedExtThumb}
                alt=""
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '300px',
                  objectFit: 'cover',
                  background: 'var(--bg-tertiary)',
                  display: 'block',
                  borderBottom: '1px solid var(--border-medium)',
                }}
              />
            )}
            <div style={{ padding: '1rem' }}>
              <div style={{ fontWeight: '600', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                {embed.external.title}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {embed.external.description}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                {(() => {
                  try {
                    return new URL(sanitizedExtUri).hostname;
                  } catch {
                    return '';
                  }
                })()}
              </div>
            </div>
          </a>
        );
      })()}

      {/* Embed - Video */}
      {embed?.$type === 'app.bsky.embed.video#view' && embed.playlist && (() => {
        const sanitizedPlaylist = sanitizeUrl(embed.playlist);
        const sanitizedThumbnail = sanitizeUrl(embed.thumbnail);
        
        if (sanitizedPlaylist === '#') return null; // Skip invalid video URLs
        
        return (
          <div
            style={{
              position: 'relative',
              marginBottom: '1rem',
              background: 'var(--bg-tertiary)',
              overflow: 'hidden',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            }}
          >
            <video
              controls
              poster={sanitizedThumbnail}
              style={{
                width: '100%',
                maxHeight: '500px',
                display: 'block',
              }}
            >
              <source src={sanitizedPlaylist} type="application/x-mpegURL" />
              Your browser does not support the video tag.
            </video>
            {embed.alt && (
              <div style={{ 
                padding: '0.5rem', 
                fontSize: '0.875rem', 
                color: 'var(--text-tertiary)',
                background: 'var(--bg-secondary)',
              }}>
                {embed.alt}
              </div>
            )}
          </div>
        );
      })()}

      {/* Embed - Quote Post (Record) */}
      {embed?.$type === 'app.bsky.embed.record#view' && embed.record && (
        renderQuotedPost(embed.record)
      )}

      {/* Embed - Record with Media (Quote + Link/Image/Video) */}
      {embed?.$type === 'app.bsky.embed.recordWithMedia#view' && (
        <>
          {/* Render the media first (images embed 1–4 or gallery embed 5+) */}
          {(() => {
            const mediaImages = getEmbedImages(embed.media);
            if (!mediaImages) return null;
            return (
              <EmbedImageGrid
                images={mediaImages}
                gap="0.5rem"
                marginBottom="1rem"
                maxHeight="1000px"
                background="var(--bg-tertiary)"
                boxShadow="0 4px 12px rgba(0, 0, 0, 0.4)"
              />
            );
          })()}

          {embed.media?.$type === 'app.bsky.embed.external#view' && embed.media.external && (() => {
            const sanitizedMediaExtUri = sanitizeUrl(embed.media.external.uri);
            const sanitizedMediaExtThumb = sanitizeUrl(embed.media.external.thumb);
            
            if (sanitizedMediaExtUri === '#') return null; // Skip invalid URLs
            
            return (
              <a
                href={sanitizedMediaExtUri}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  marginBottom: '1rem',
                  border: '1px solid var(--border-medium)',
                  textDecoration: 'none',
                  color: 'inherit',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                }}
                className="external-link-card"
              >
                {embed.media.external.thumb && (
                  <img
                    src={sanitizedMediaExtThumb}
                    alt=""
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: '300px',
                      objectFit: 'cover',
                      background: 'var(--bg-tertiary)',
                      display: 'block',
                      borderBottom: '1px solid var(--border-medium)',
                    }}
                  />
                )}
                <div style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                    {embed.media.external.title}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {embed.media.external.description}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                    {(() => {
                      try {
                        return new URL(sanitizedMediaExtUri).hostname;
                      } catch {
                        return '';
                      }
                    })()}
                  </div>
                </div>
              </a>
            );
          })()}

          {embed.media?.$type === 'app.bsky.embed.video#view' && embed.media.playlist && (() => {
            const sanitizedMediaPlaylist = sanitizeUrl(embed.media.playlist);
            const sanitizedMediaThumbnail = sanitizeUrl(embed.media.thumbnail);
            
            if (sanitizedMediaPlaylist === '#') return null; // Skip invalid video URLs
            
            return (
              <div
                style={{
                  position: 'relative',
                  marginBottom: '1rem',
                  background: 'var(--bg-tertiary)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-medium)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                }}
              >
                <video
                  controls
                  poster={sanitizedMediaThumbnail}
                  style={{
                    width: '100%',
                    maxHeight: '500px',
                    display: 'block',
                  }}
                >
                  <source src={sanitizedMediaPlaylist} type="application/x-mpegURL" />
                  Your browser does not support the video tag.
                </video>
                {embed.media.alt && (
                  <div style={{ 
                    padding: '0.5rem', 
                    fontSize: '0.875rem', 
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-secondary)',
                  }}>
                    {embed.media.alt}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Then render the quoted record */}
          {embed.record?.record && renderQuotedPost(embed.record.record)}
        </>
      )}

      {/* Post Metadata */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          // Wrap on narrow screens so the timestamp drops to its own line
          // intact instead of squishing the row; tighter row gap when it does.
          flexWrap: 'wrap',
          gap: '0.5rem 1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.875rem',
          color: 'var(--text-tertiary)',
          // Collapse inherited line-height so icons align to the text
          // midline (body's default of 1.7 was floating them above).
          lineHeight: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          <MessageSquare size={16} />
          <span>{formatCount(replyCount || 0)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          <Repeat2 size={16} />
          <span>{formatCount(repostCount || 0)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          <Heart size={16} />
          <span>{formatCount(likeCount || 0)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          <Quote size={16} />
          <span>{formatCount(quoteCount || 0)}</span>
        </div>
        {/* Relative time keeps the footer compact; full timestamp on hover. */}
        <time
          dateTime={validDate ? createdAt.toISOString() : undefined}
          title={formattedDate}
          // Relative time is computed from "now", so the SSR value may differ
          // from the client at hydration — expected, don't warn.
          suppressHydrationWarning
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {relativeDate}
        </time>
      </div>

      {/* Cross-product: jump to this post's raw record in the explorer */}
      {!hideExplorerCtas && (() => {
        const explorePath = explorePathFromAtUri(post.uri);
        if (!explorePath) return null;
        return (
          <div
            style={{
              paddingTop: '1rem',
              marginTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
            }}
          >
            <Link
              href={explorePath}
              className="profile-explorer-link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                textDecoration: 'none',
              }}
            >
              <Telescope size={12} />
              View record data in the Explorer →
            </Link>
          </div>
        );
      })()}

      {/* Inverse of the universal link page's "View record data in the
          Explorer →" CTA: inside the explorer, a quiet link back out to the
          shareable universal link page for this post. Mirrors the explorer
          profile card's "View the universal link page →". */}
      {hideExplorerCtas && (() => {
        const postUrl = buildPostUrl(post.uri, author);
        if (!postUrl) return null;
        return (
          <div
            style={{
              paddingTop: '1rem',
              marginTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
            }}
          >
            <Link
              href={postUrl}
              className="profile-explorer-link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                textDecoration: 'none',
              }}
            >
              <Globe size={12} />
              View the universal link page →
            </Link>
          </div>
        );
      })()}
    </div>
    </>
  );
}

