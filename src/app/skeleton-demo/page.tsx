/**
 * Skeleton Demo Page
 * Visual showcase of all skeleton loading states
 * Access at /skeleton-demo (for development testing)
 */

'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import ProfilePreview from '@/components/ProfilePreview';
import ProfilePreviewSkeleton from '@/components/ProfilePreviewSkeleton';
import PostPreview from '@/components/PostPreview';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import RecordPreviewSkeleton from '@/components/RecordPreviewSkeleton';
import PageSkeleton, { CardListSkeleton } from '@/components/PageSkeleton';

export default function SkeletonDemoPage() {
  const [showSkeletons, setShowSkeletons] = useState(true);

  // Mock data for demo
  const mockProfile = {
    did: 'did:plc:demo123',
    displayName: 'Alice Smith',
    handle: 'alice.bsky.social',
    description: 'Software engineer & designer building cool things on the AT Protocol.\n\nLove minimalist interfaces and organic aesthetics.',
    avatar: 'https://picsum.photos/96',
    banner: 'https://picsum.photos/800/200',
    followersCount: 1234,
    followsCount: 567,
    postsCount: 890,
    createdAt: '2023-04-15T10:00:00Z',
  };

  const mockPost = {
    uri: 'at://did:plc:demo456/app.bsky.feed.post/demo123',
    cid: 'bafyreighdemo123',
    indexedAt: '2024-12-27T12:00:00Z',
    author: {
      did: 'did:plc:demo456',
      displayName: 'Bob Johnson',
      handle: 'bob.bsky.social',
      avatar: 'https://picsum.photos/48',
      pronouns: 'he/him',
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'Just discovered aturi.to and it is amazing! Universal links for the ATmosphere 🦋\n\nThis makes sharing content so much easier.',
      createdAt: '2024-12-27T12:00:00Z',
      facets: [],
    },
    embed: {
      $type: 'app.bsky.embed.images#view',
      images: [
        {
          thumb: 'https://picsum.photos/400/300',
          fullsize: 'https://picsum.photos/800/600',
          alt: 'A beautiful landscape',
        },
      ],
    },
    replyCount: 12,
    repostCount: 34,
    likeCount: 156,
    quoteCount: 8,
  };

  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      <Header simple />

      <div style={{ marginBottom: '4rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--text-accent)', marginBottom: '1rem', fontSize: '2rem' }}>
          Skeleton Loading Demo
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '1.125rem' }}>
          Toggle between loading skeletons and actual content to see the smooth transitions.
        </p>
        <button
          onClick={() => setShowSkeletons(!showSkeletons)}
          className="waypoint-button"
          style={{
            maxWidth: '400px',
            margin: '0 auto',
            cursor: 'pointer',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '1.125rem', fontWeight: '400' }}>
            {showSkeletons ? '✨ Show Content' : '⏳ Show Skeletons'}
          </span>
        </button>
      </div>

      {/* Profile Preview Demo */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Profile Preview
        </h3>
        {showSkeletons ? (
          <ProfilePreviewSkeleton />
        ) : (
          <div className="content-fade-in">
            <ProfilePreview profile={mockProfile} />
          </div>
        )}
      </section>

      {/* Post Preview Demo (without image) */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Post Preview (Text Only)
        </h3>
        {showSkeletons ? (
          <PostPreviewSkeleton />
        ) : (
          <div className="content-fade-in">
            <PostPreview
              post={{
                ...mockPost,
                embed: undefined,
              }}
            />
          </div>
        )}
      </section>

      {/* Post Preview Demo (with image) */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Post Preview (With Image)
        </h3>
        {showSkeletons ? (
          <PostPreviewSkeleton withImage />
        ) : (
          <div className="content-fade-in">
            <PostPreview post={mockPost} />
          </div>
        )}
      </section>

      {/* Record Preview Demo */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Generic Record Preview
        </h3>
        {showSkeletons ? (
          <RecordPreviewSkeleton />
        ) : (
          <div className="content-fade-in">
            <div
              style={{
                marginBottom: '2rem',
                padding: '1.5rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
              }}
            >
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                Generic record content would appear here
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Page Skeleton Demo */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          General Page Skeleton
        </h3>
        {showSkeletons ? (
          <PageSkeleton showHeader sections={2} showCard />
        ) : (
          <div className="content-fade-in">
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <h2 style={{ marginBottom: '0.5rem' }}>Page Title</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Page subtitle or description</p>
            </div>
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Section One</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Section content goes here...</p>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: '0.5rem' }}>Section Two</h3>
              <p style={{ color: 'var(--text-secondary)' }}>More content here...</p>
            </div>
          </div>
        )}
      </section>

      {/* Card List Skeleton Demo */}
      <section style={{ marginBottom: '4rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Card List Skeleton
        </h3>
        {showSkeletons ? (
          <CardListSkeleton count={3} />
        ) : (
          <div className="content-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>✨</span>
                  <span>Card Item {i}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div
        className="card"
        style={{
          marginTop: '3rem',
          textAlign: 'center',
          background: 'var(--bg-tertiary)',
        }}
      >
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          Design Notes
        </h3>
        <div style={{ color: 'var(--text-secondary)', lineHeight: '1.8', textAlign: 'left' }}>
          <p style={{ marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Shimmer Animation:</strong> Organic 2.5s gradient sweep using the app&apos;s natural glow colors
          </p>
          <p style={{ marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Fade Transitions:</strong> Content fades in smoothly after loading with subtle vertical shift
          </p>
          <p style={{ marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Color Palette:</strong> Uses --bg-tertiary and --glow-medium to match the moody, natural aesthetic
          </p>
        </div>
      </div>
    </div>
  );
}

