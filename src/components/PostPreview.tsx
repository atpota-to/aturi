/**
 * PostPreview Component
 * Displays a rich preview card for Bluesky posts
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BskyPost, UnknownRecordValue } from '@/utils/recordFetcher';
import { getEmbedImages } from '@/utils/postEmbeds';
import { EmbedImageGrid, ExternalEmbedCard, VideoEmbed } from './PostEmbeds';
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

// Build a canonical post URL from an AT URI and the post's author.
// Returns null if either piece is missing or doesn't sanitize to a valid identifier.
const buildPostUrl = (uri?: string, author?: { did?: string; handle?: string }): string | null => {
  if (!uri || !author) return null;
  const rkey = uri.split('/').pop();
  const id = sanitizeDid(author.did) || sanitizeHandle(author.handle);
  if (!rkey || !id) return null;
  return `/profile/${id}/post/${rkey}`;
};


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
  // Short form for the byline ("22 Oct 2026, 03:00"); the long form above
  // is the hover title. Unparseable dates fall back to the long string
  // (toISOString would otherwise throw).
  const validDate = !Number.isNaN(createdAt.getTime());
  const shortDate = validDate
    ? createdAt.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : formattedDate;

  // Quote embeds mix several view shapes (ViewRecord, ViewNotFound,
  // ViewBlocked, nested re-quotes), so field access is dynamic by design.
  const renderQuotedPost = (quotedPost: UnknownRecordValue) => {
    if (!quotedPost) return null;

    // Handle blocked/not found records
    if (quotedPost.notFound || quotedPost.blocked) {
      return (
        <div className="fn-post-quote" style={{ color: 'var(--text-tertiary)' }}>
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
        className="fn-post-quote"
        style={quoteUrl ? { cursor: 'pointer' } : undefined}
      >
        {/* Quoted post author */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <a
            href={qAuthor?.did || qAuthor?.handle ? `/${sanitizeDid(qAuthor.did) || sanitizeHandle(qAuthor.handle)}` : '#'}
            onClick={(e) => e.stopPropagation()}
            style={{ textDecoration: 'none', flexShrink: 0 }}
          >
            {qAuthor?.avatar ? (
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '1px solid transparent',
                  transition: 'border-color 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--text-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
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
                  width: '20px',
                  height: '20px',
                  border: '1px solid transparent',
                  borderRadius: '50%',
                  background: 'var(--accent-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'border-color 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--text-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <User size={12} color="var(--accent-soft-fg)" />
              </div>
            )}
          </a>
          <div
            style={{
              fontSize: '13px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <a
              href={qAuthor?.did || qAuthor?.handle ? `/${sanitizeDid(qAuthor.did) || sanitizeHandle(qAuthor.handle)}` : '#'}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontWeight: 700,
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
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
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
            fontSize: '14px',
            lineHeight: 1.5,
            color: 'var(--text-primary)',
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
                maxHeight="200px"
                background="var(--bg-secondary)"
                boxShadow="none"
                stopPropagation
              />
            );
          }

          // External link
          if (qEmbed.$type === 'app.bsky.embed.external#view' && qEmbed.external) {
            return (
              <ExternalEmbedCard
                key={idx}
                external={qEmbed.external}
                variant="compact"
                marginTop="0.5rem"
                thumbMaxHeight="150px"
              />
            );
          }

          // Video
          if (qEmbed.$type === 'app.bsky.embed.video#view' && qEmbed.playlist) {
            return (
              <VideoEmbed
                key={idx}
                video={qEmbed}
                variant="compact"
                marginTop="0.5rem"
                videoMaxHeight="200px"
              />
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

  // Profile path for an author, shared by the avatar, name and handle links.
  const profileHref = (a: { did?: string; handle?: string }) =>
    `/${sanitizeDid(a.did) || sanitizeHandle(a.handle)}`;

  // Hashtags shown as chips in the footer: the record's own `tags` plus any
  // tag facets in the text, de-duplicated case-insensitively.
  const tagChips = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (raw: unknown) => {
      const tag = typeof raw === 'string' ? sanitizeHashtag(raw) : null;
      if (!tag || seen.has(tag.toLowerCase())) return;
      seen.add(tag.toLowerCase());
      out.push(tag);
    };
    const ownTags = (record as { tags?: unknown }).tags;
    if (Array.isArray(ownTags)) ownTags.forEach(add);
    for (const facet of record.facets ?? []) {
      for (const feature of facet.features) {
        if (feature.$type === 'app.bsky.richtext.facet#tag') add(feature.tag);
      }
    }
    return out;
  })();

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const counts = [
    { key: 'like', Icon: Heart, n: likeCount || 0, label: plural(likeCount || 0, 'like', 'likes') },
    { key: 'repost', Icon: Repeat2, n: repostCount || 0, label: plural(repostCount || 0, 'repost', 'reposts') },
    { key: 'reply', Icon: MessageSquare, n: replyCount || 0, label: plural(replyCount || 0, 'reply', 'replies') },
    { key: 'quote', Icon: Quote, n: quoteCount || 0, label: plural(quoteCount || 0, 'quote', 'quotes') },
  ];

  // Cross-product link at the end of the footer: out of the universal link
  // page into the raw record in the explorer, or (inside the explorer, which
  // is that link's destination) back out to the shareable universal page.
  const crossLink = (() => {
    if (!hideExplorerCtas) {
      const explorePath = explorePathFromAtUri(post.uri);
      if (!explorePath) return null;
      return (
        <Link href={explorePath} prefetch={false} className="profile-explorer-link fn-post-crosslink">
          <Telescope size={13} aria-hidden />
          View record data in the Explorer →
        </Link>
      );
    }
    const postUrl = buildPostUrl(post.uri, author);
    if (!postUrl) return null;
    return (
      <Link href={postUrl} prefetch={false} className="profile-explorer-link fn-post-crosslink">
        <Globe size={13} aria-hidden />
        View the universal link page →
      </Link>
    );
  })();

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
          className="parent-card fn-post-parent"
        >
          <div className="fn-post-parent-kicker">
            <CornerDownRight size={13} aria-hidden />
            <span>Replying to</span>
          </div>

          {/* Parent Author */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            <a
              href={profileHref(parent.author)}
              onClick={(e) => e.stopPropagation()}
              style={{ textDecoration: 'none', flexShrink: 0 }}
            >
              <span className="fn-post-avatar" style={{ width: 28, height: 28 }}>
                {parent.author.avatar ? (
                  <img
                    src={sanitizeUrl(parent.author.avatar)}
                    alt={parent.author.displayName || parent.author.handle}
                  />
                ) : (
                  <User size={14} aria-hidden />
                )}
              </span>
            </a>
            <div style={{ minWidth: 0, fontSize: '13px', lineHeight: 1.3 }}>
              <a
                href={profileHref(parent.author)}
                onClick={(e) => e.stopPropagation()}
                className="fn-post-name"
              >
                {parent.author.displayName || parent.author.handle}
              </a>{' '}
              <a
                href={profileHref(parent.author)}
                onClick={(e) => e.stopPropagation()}
                className="fn-post-handle"
              >
                @{parent.author.handle}
              </a>
            </div>
          </div>

          {/* Parent Post Text (truncated) */}
          {parent.record.text && (
            <div
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                lineHeight: '1.45',
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
                    boxShadow="none"
                    limit={2}
                    stopPropagation
                  />
                );
              })()}

              {/* External link */}
              {parent.embed.$type === 'app.bsky.embed.external#view' && parent.embed.external && (
                <ExternalEmbedCard
                  external={parent.embed.external}
                  variant="compact"
                  thumbMaxHeight="100px"
                />
              )}

              {/* Video */}
              {parent.embed.$type === 'app.bsky.embed.video#view' && parent.embed.playlist && (
                <VideoEmbed
                  video={parent.embed}
                  variant="compact"
                  videoMaxHeight="150px"
                />
              )}
            </>
          )}
        </div>
        );
      })()}

      <div className="card post-preview fn-post">
      {/* Author: avatar, name, then the mono handle and date on one line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <a href={profileHref(author)} style={{ textDecoration: 'none', flexShrink: 0 }}>
          <span className="fn-post-avatar" style={{ width: 40, height: 40 }}>
            {author.avatar ? (
              <img src={sanitizeUrl(author.avatar)} alt={author.displayName || author.handle} />
            ) : (
              <User size={20} aria-hidden />
            )}
          </span>
        </a>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
          <a href={profileHref(author)} className="fn-post-name" style={{ fontSize: '15px' }}>
            {author.displayName || author.handle}
            {author.pronouns && (
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>
                {author.pronouns}
              </span>
            )}
          </a>
          <div className="fn-post-meta">
            <a href={profileHref(author)} className="fn-post-handle fn-post-handle-accent">
              @{author.handle}
            </a>
            <span aria-hidden> · </span>
            {/* Full timestamp on hover; the local-time string can differ
                between server and client render, so don't warn about it. */}
            <time
              dateTime={validDate ? createdAt.toISOString() : undefined}
              title={formattedDate}
              suppressHydrationWarning
            >
              {shortDate}
            </time>
          </div>
        </div>
      </div>

      {/* Post Content */}
      <div className="fn-post-text">
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
            maxHeight="1000px"
            background="var(--bg-tertiary)"
            boxShadow="none"
          />
        );
      })()}

      {/* Embed - External Link */}
      {embed?.$type === 'app.bsky.embed.external#view' && embed.external && (
        <ExternalEmbedCard
          external={embed.external}
          variant="full"
          thumbMaxHeight="300px"
        />
      )}

      {/* Embed - Video */}
      {embed?.$type === 'app.bsky.embed.video#view' && embed.playlist && (
        <VideoEmbed
          video={embed}
          variant="full"
          videoMaxHeight="500px"
        />
      )}

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
                maxHeight="1000px"
                background="var(--bg-tertiary)"
                boxShadow="none"
              />
            );
          })()}

          {embed.media?.$type === 'app.bsky.embed.external#view' && embed.media.external && (
            <ExternalEmbedCard
              external={embed.media.external}
              variant="full"
              thumbMaxHeight="300px"
            />
          )}

          {embed.media?.$type === 'app.bsky.embed.video#view' && embed.media.playlist && (
            <VideoEmbed
              video={embed.media}
              variant="full"
              videoMaxHeight="500px"
            />
          )}

          {/* Then render the quoted record */}
          {embed.record?.record && renderQuotedPost(embed.record.record)}
        </>
      )}

      {/* Footer: tag chips, labelled counts, then the cross-product link */}
      <div className="fn-post-footer">
        {tagChips.map((tag) => (
          <a
            key={tag}
            href={`https://bsky.app/hashtag/${tag}`}
            target="_blank"
            rel="noopener noreferrer"
            className="fn-post-tag"
          >
            #{tag}
          </a>
        ))}
        {counts.map(({ key, Icon, n, label }) => (
          <span key={key} className="fn-post-count">
            <Icon size={15} aria-hidden />
            <strong>{formatCount(n)}</strong> {label}
          </span>
        ))}
        {crossLink}
      </div>
    </div>
    </>
  );
}
