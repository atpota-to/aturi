/**
 * ProfilePreview Component
 * Displays a rich preview card for Bluesky profiles
 */

import { BskyProfile } from '@/utils/profileFetcher';
import { User, Calendar, Users, MessageSquare } from 'lucide-react';

type ProfilePreviewProps = {
  profile: BskyProfile;
};

export default function ProfilePreview({ profile }: ProfilePreviewProps) {
  const {
    displayName,
    handle,
    description,
    avatar,
    banner,
    followersCount,
    followsCount,
    postsCount,
    createdAt,
    verification,
    associated,
  } = profile;

  // Format the join date
  const joinDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
      })
    : null;

  // Check if verified
  const isVerified =
    verification?.verifiedStatus === 'valid' && verification?.verifications?.some((v) => v.isValid);

  // Parse description with basic line breaks
  const renderDescription = () => {
    if (!description) return null;
    
    // Split by newlines and render
    const lines = description.split('\n');
    return (
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        marginBottom: '2rem',
        padding: 0,
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        transform: 'rotate(-0.3deg)',
        transition: 'all 0.4s ease',
      }}
      className="card"
    >
      {/* Banner */}
      {banner ? (
        <div
          style={{
            width: '100%',
            height: '200px',
            background: `url(${banner}) center/cover`,
            backgroundColor: 'var(--bg-tertiary)',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '200px',
            background: 'linear-gradient(135deg, var(--accent-moss) 0%, var(--accent-forest) 100%)',
          }}
        />
      )}

      <div style={{ padding: '1.5rem' }}>
        {/* Avatar and Name Section */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginTop: '-4rem', marginBottom: '1rem' }}>
          {avatar ? (
            <div
              style={{
                width: '96px',
                height: '96px',
                border: '2px solid var(--accent-stone)',
                overflow: 'hidden',
                flexShrink: 0,
                background: 'var(--bg-tertiary)',
              }}
            >
              <img
                src={avatar}
                alt={displayName || handle}
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
                width: '96px',
                height: '96px',
                border: '2px solid var(--accent-stone)',
                background: 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <User size={48} color="var(--text-tertiary)" />
            </div>
          )}
          
          <div style={{ flex: 1, minWidth: 0, paddingTop: '3.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                {displayName || handle}
              </h2>
              {isVerified && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" fill="var(--text-accent)" />
                  <path
                    d="M8 12.5L10.5 15L16 9"
                    stroke="var(--bg-secondary)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-tertiary)' }}>@{handle}</div>
          </div>
        </div>

        {/* Description */}
        {description && (
          <div
            style={{
              marginBottom: '1.5rem',
              color: 'var(--text-primary)',
              fontSize: '1rem',
              lineHeight: '1.5',
            }}
          >
            {renderDescription()}
          </div>
        )}

        {/* Stats */}
        <div className="profile-stats-container">
          <div className="profile-stats-row">
            {followersCount !== undefined && (
              <div className="profile-stat-item">
                <Users size={18} color="var(--text-tertiary)" />
                <div>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                    {followersCount.toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.25rem' }}>followers</span>
                </div>
              </div>
            )}
            {followsCount !== undefined && (
              <div className="profile-stat-item">
                <Users size={18} color="var(--text-tertiary)" />
                <div>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                    {followsCount.toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.25rem' }}>following</span>
                </div>
              </div>
            )}
            {postsCount !== undefined && (
              <div className="profile-stat-item">
                <MessageSquare size={18} color="var(--text-tertiary)" />
                <div>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                    {postsCount.toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.25rem' }}>posts</span>
                </div>
              </div>
            )}
          </div>
          {joinDate && (
            <div className="profile-join-date">
              <Calendar size={18} color="var(--text-tertiary)" />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                Joined {joinDate}
              </span>
            </div>
          )}
        </div>

        {/* Additional Info */}
        {associated && (
          (associated.lists && associated.lists > 0) || 
          (associated.feedgens && associated.feedgens > 0) || 
          (associated.starterPacks && associated.starterPacks > 0)
        ) && (
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              paddingTop: '1rem',
              marginTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            {associated.lists !== undefined && associated.lists > 0 && (
              <div>
                <span style={{ fontWeight: '600' }}>{associated.lists}</span> list{associated.lists !== 1 ? 's' : ''}
              </div>
            )}
            {associated.feedgens !== undefined && associated.feedgens > 0 && (
              <div>
                <span style={{ fontWeight: '600' }}>{associated.feedgens}</span> feed{associated.feedgens !== 1 ? 's' : ''}
              </div>
            )}
            {associated.starterPacks !== undefined && associated.starterPacks > 0 && (
              <div>
                <span style={{ fontWeight: '600' }}>{associated.starterPacks}</span> starter pack{associated.starterPacks !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

