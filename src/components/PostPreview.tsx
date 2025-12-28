/**
 * PostPreview Component
 * Displays a rich preview card for Bluesky posts
 */

'use client';

import { BskyPost } from '@/utils/recordFetcher';
import { User, MessageSquare, Repeat2, Heart, Quote, Play, CornerDownRight } from 'lucide-react';

type PostPreviewProps = {
  post: BskyPost;
  parent?: BskyPost;
};

export default function PostPreview({ post, parent }: PostPreviewProps) {
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

  // Render a quoted post card
  const renderQuotedPost = (quotedPost: any) => {
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

    return (
      <div
        style={{
          border: '1px solid var(--border-medium)',
          padding: '1rem',
          marginBottom: '1rem',
          background: 'var(--bg-tertiary)',
        }}
      >
        {/* Quoted post author */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <a
            href={qAuthor?.did || qAuthor?.handle ? `/${qAuthor.did || qAuthor.handle}` : '#'}
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
                  src={qAuthor.avatar}
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
              href={qAuthor?.did || qAuthor?.handle ? `/${qAuthor.did || qAuthor.handle}` : '#'}
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
                  href={qAuthor.did || qAuthor.handle ? `/${qAuthor.did || qAuthor.handle}` : '#'}
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
        {qEmbeds.map((qEmbed: any, idx: number) => {
          // Images
          if (qEmbed.$type === 'app.bsky.embed.images#view' && qEmbed.images) {
            return (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: qEmbed.images.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                  gap: '0.25rem',
                  marginTop: '0.5rem',
                }}
              >
                {qEmbed.images.map((image: any, i: number) => (
                  <a
                    key={i}
                    href={image.fullsize}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      display: 'block',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={image.thumb}
                      alt={image.alt}
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '200px',
                        objectFit: 'cover',
                        background: 'var(--bg-secondary)',
                        display: 'block',
                        border: '1px solid var(--border-medium)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                      }}
                    />
                  </a>
                ))}
              </div>
            );
          }

          // External link
          if (qEmbed.$type === 'app.bsky.embed.external#view' && qEmbed.external) {
            return (
              <a
                key={idx}
                href={qEmbed.external.uri}
                target="_blank"
                rel="noopener noreferrer"
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
                    src={qEmbed.external.thumb}
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
                    {new URL(qEmbed.external.uri).hostname}
                  </div>
                </div>
              </a>
            );
          }

          // Video
          if (qEmbed.$type === 'app.bsky.embed.video#view' && qEmbed.playlist) {
            return (
              <div
                key={idx}
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
                  poster={qEmbed.thumbnail}
                  style={{
                    width: '100%',
                    maxHeight: '200px',
                    display: 'block',
                  }}
                >
                  <source src={qEmbed.playlist} type="application/x-mpegURL" />
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
            {quotedPost.embed.$type === 'app.bsky.embed.external#view' && '🔗 Link'}
            {quotedPost.embed.$type === 'app.bsky.embed.video#view' && '🎥 Video'}
            {quotedPost.embed.$type === 'app.bsky.embed.record#view' && '💬 Quote'}
          </div>
        )}
      </div>
    );
  };

  // Parse text with facets (links, mentions, hashtags)
  const renderText = () => {
    if (!record.facets || record.facets.length === 0) {
      return <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{record.text}</p>;
    }

    const segments: Array<{ text: string; facet?: any }> = [];
    let lastIndex = 0;

    // Sort facets by start index
    const sortedFacets = [...record.facets].sort(
      (a, b) => a.index.byteStart - b.index.byteStart
    );

    for (const facet of sortedFacets) {
      const { byteStart, byteEnd } = facet.index;

      // Add text before facet
      if (byteStart > lastIndex) {
        segments.push({ text: record.text.slice(lastIndex, byteStart) });
      }

      // Add facet text
      segments.push({
        text: record.text.slice(byteStart, byteEnd),
        facet: facet.features[0],
      });

      lastIndex = byteEnd;
    }

    // Add remaining text
    if (lastIndex < record.text.length) {
      segments.push({ text: record.text.slice(lastIndex) });
    }

    return (
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {segments.map((segment, i) => {
          if (!segment.facet) {
            return <span key={i}>{segment.text}</span>;
          }

          const { $type } = segment.facet;

          if ($type === 'app.bsky.richtext.facet#link') {
            return (
              <a
                key={i}
                href={segment.facet.uri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-accent)', textDecoration: 'underline' }}
              >
                {segment.text}
              </a>
            );
          }

          if ($type === 'app.bsky.richtext.facet#mention') {
            return (
              <a
                key={i}
                href={`/${segment.facet.did}`}
                style={{ color: 'var(--text-accent)', textDecoration: 'none' }}
              >
                {segment.text}
              </a>
            );
          }

          if ($type === 'app.bsky.richtext.facet#tag') {
            return (
              <a
                key={i}
                href={`https://bsky.app/hashtag/${segment.facet.tag}`}
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
      {parent && (
        <div
          style={{
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
              href={`/${parent.author.did || parent.author.handle}`}
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
                    src={parent.author.avatar}
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
                href={`/${parent.author.did || parent.author.handle}`}
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
                  href={`/${parent.author.did || parent.author.handle}`}
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
              {/* Images */}
              {parent.embed.$type === 'app.bsky.embed.images#view' && parent.embed.images && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: parent.embed.images.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                    gap: '0.25rem',
                  }}
                >
                  {parent.embed.images.slice(0, 2).map((image: any, i: number) => (
                    <a
                      key={i}
                      href={image.fullsize}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ 
                        display: 'block',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={image.thumb}
                        alt={image.alt}
                        style={{
                          width: '100%',
                          height: 'auto',
                          maxHeight: '120px',
                          objectFit: 'cover',
                          background: 'var(--bg-secondary)',
                          display: 'block',
                          border: '1px solid var(--border-medium)',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                        }}
                      />
                    </a>
                  ))}
                </div>
              )}

              {/* External link */}
              {parent.embed.$type === 'app.bsky.embed.external#view' && parent.embed.external && (
                <a
                  href={parent.embed.external.uri}
                  target="_blank"
                  rel="noopener noreferrer"
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
                      src={parent.embed.external.thumb}
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
                      {new URL(parent.embed.external.uri).hostname}
                    </div>
                  </div>
                </a>
              )}

              {/* Video */}
              {parent.embed.$type === 'app.bsky.embed.video#view' && parent.embed.playlist && (
                <div
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
      )}

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
          href={`/${author.did || author.handle}`}
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
                src={author.avatar}
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
            href={`/${author.did || author.handle}`}
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
              href={`/${author.did || author.handle}`}
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
      <div style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1rem', lineHeight: '1.5' }}>
        {renderText()}
      </div>

      {/* Embed - Images */}
      {embed?.$type === 'app.bsky.embed.images#view' && embed.images && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: embed.images.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          {embed.images.map((image, i) => (
            <a
              key={i}
              href={image.fullsize}
              target="_blank"
              rel="noopener noreferrer"
              style={{ 
                display: 'block',
                overflow: 'hidden',
              }}
            >
              <img
                src={image.thumb}
                alt={image.alt}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '400px',
                  objectFit: 'cover',
                  background: 'var(--bg-tertiary)',
                  display: 'block',
                  border: '1px solid var(--border-medium)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                }}
              />
            </a>
          ))}
        </div>
      )}

      {/* Embed - External Link */}
      {embed?.$type === 'app.bsky.embed.external#view' && embed.external && (
        <a
          href={embed.external.uri}
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
              src={embed.external.thumb}
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
              {new URL(embed.external.uri).hostname}
            </div>
          </div>
        </a>
      )}

      {/* Embed - Video */}
      {embed?.$type === 'app.bsky.embed.video#view' && embed.playlist && (
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
            poster={embed.thumbnail}
            style={{
              width: '100%',
              maxHeight: '500px',
              display: 'block',
            }}
          >
            <source src={embed.playlist} type="application/x-mpegURL" />
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
      )}

      {/* Embed - Quote Post (Record) */}
      {embed?.$type === 'app.bsky.embed.record#view' && embed.record && (
        renderQuotedPost(embed.record)
      )}

      {/* Embed - Record with Media (Quote + Link/Image/Video) */}
      {embed?.$type === 'app.bsky.embed.recordWithMedia#view' && (
        <>
          {/* Render the media first */}
          {embed.media?.$type === 'app.bsky.embed.images#view' && embed.media.images && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: embed.media.images.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              {embed.media.images.map((image: any, i: number) => (
                <a
                  key={i}
                  href={image.fullsize}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ 
                    display: 'block',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={image.thumb}
                    alt={image.alt}
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: '400px',
                      objectFit: 'cover',
                      background: 'var(--bg-tertiary)',
                      display: 'block',
                      border: '1px solid var(--border-medium)',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    }}
                  />
                </a>
              ))}
            </div>
          )}

          {embed.media?.$type === 'app.bsky.embed.external#view' && embed.media.external && (
            <a
              href={embed.media.external.uri}
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
                  src={embed.media.external.thumb}
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
                  {new URL(embed.media.external.uri).hostname}
                </div>
              </div>
            </a>
          )}

          {embed.media?.$type === 'app.bsky.embed.video#view' && embed.media.playlist && (
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
                poster={embed.media.thumbnail}
                style={{
                  width: '100%',
                  maxHeight: '500px',
                  display: 'block',
                }}
              >
                <source src={embed.media.playlist} type="application/x-mpegURL" />
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
          )}

          {/* Then render the quoted record */}
          {embed.record?.record && renderQuotedPost(embed.record.record)}
        </>
      )}

      {/* Post Metadata */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.875rem',
          color: 'var(--text-tertiary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <MessageSquare size={16} />
          <span>{replyCount || 0}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Repeat2 size={16} />
          <span>{repostCount || 0}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Heart size={16} />
          <span>{likeCount || 0}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Quote size={16} />
          <span>{quoteCount || 0}</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>{formattedDate}</div>
      </div>
    </div>
    </>
  );
}

