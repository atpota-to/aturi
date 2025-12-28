/**
 * PostPreview Component
 * Displays a rich preview card for Bluesky posts
 */

import { BskyPost } from '@/utils/recordFetcher';
import { User, MessageSquare, Repeat2, Heart, Quote, Play } from 'lucide-react';

type PostPreviewProps = {
  post: BskyPost;
};

export default function PostPreview({ post }: PostPreviewProps) {
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
    const qRecord = quotedPost.record || {};

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
          {qAuthor?.avatar ? (
            <div
              style={{
                width: '24px',
                height: '24px',
                border: '1px solid var(--accent-stone)',
                overflow: 'hidden',
                flexShrink: 0,
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
                flexShrink: 0,
              }}
            >
              <User size={14} color="var(--text-tertiary)" />
            </div>
          )}
          <div style={{ fontSize: '0.875rem' }}>
            <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
              {qAuthor?.displayName || qAuthor?.handle || 'Unknown'}
            </span>
            {qAuthor?.handle && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>
                @{qAuthor.handle}
              </span>
            )}
          </div>
        </div>

        {/* Quoted post text */}
        {qRecord.text && (
          <div style={{ 
            fontSize: '0.875rem', 
            color: 'var(--text-secondary)', 
            marginBottom: '0.5rem',
            whiteSpace: 'pre-wrap',
          }}>
            {qRecord.text}
          </div>
        )}

        {/* Quoted post embed preview (simple version) */}
        {quotedPost.embed && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
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
                href={`https://bsky.app/profile/${segment.facet.did}`}
                target="_blank"
                rel="noopener noreferrer"
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
    <div
      style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        transform: 'rotate(0.4deg)',
        transition: 'all 0.4s ease',
      }}
      className="card"
    >
      {/* Author Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        {author.avatar ? (
          <div
            style={{
              width: '48px',
              height: '48px',
              border: '2px solid var(--accent-stone)',
              overflow: 'hidden',
              flexShrink: 0,
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
              flexShrink: 0,
            }}
          >
            <User size={24} color="var(--text-tertiary)" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
            {author.displayName || author.handle}
            {author.pronouns && (
              <span style={{ fontWeight: '400', color: 'var(--text-tertiary)', marginLeft: '0.5rem' }}>
                {author.pronouns}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
            @{author.handle}
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
      {embed?.$type === 'app.bsky.embed.video#view' && embed.video && (
        <div
          style={{
            position: 'relative',
            marginBottom: '1rem',
            background: 'var(--bg-tertiary)',
            overflow: 'hidden',
          }}
        >
          <video
            controls
            poster={embed.video.thumbnail}
            style={{
              width: '100%',
              maxHeight: '500px',
              display: 'block',
            }}
          >
            <source src={embed.video.playlist} type="application/x-mpegURL" />
            Your browser does not support the video tag.
          </video>
          {embed.video.alt && (
            <div style={{ 
              padding: '0.5rem', 
              fontSize: '0.875rem', 
              color: 'var(--text-tertiary)',
              background: 'var(--bg-secondary)',
            }}>
              {embed.video.alt}
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

          {embed.media?.$type === 'app.bsky.embed.video#view' && embed.media.video && (
            <div
              style={{
                position: 'relative',
                marginBottom: '1rem',
                background: 'var(--bg-tertiary)',
                overflow: 'hidden',
              }}
            >
              <video
                controls
                poster={embed.media.video.thumbnail}
                style={{
                  width: '100%',
                  maxHeight: '500px',
                  display: 'block',
                }}
              >
                <source src={embed.media.video.playlist} type="application/x-mpegURL" />
                Your browser does not support the video tag.
              </video>
              {embed.media.video.alt && (
                <div style={{ 
                  padding: '0.5rem', 
                  fontSize: '0.875rem', 
                  color: 'var(--text-tertiary)',
                  background: 'var(--bg-secondary)',
                }}>
                  {embed.media.video.alt}
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
  );
}

