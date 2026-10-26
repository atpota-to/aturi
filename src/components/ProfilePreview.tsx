/**
 * ProfilePreview Component
 * Displays a rich preview card for Bluesky profiles
 */

import Link from 'next/link';
import { BskyProfile } from '@/utils/profileFetcher';
import { sanitizeUrl } from '@/utils/sanitize';
import { User, Calendar, Telescope } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';

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

  const stats = [
    { value: followersCount, label: 'followers' },
    { value: followsCount, label: 'following' },
    { value: postsCount, label: 'posts' },
  ].filter((stat): stat is { value: number; label: string } => stat.value !== undefined);

  const extras = [
    { value: associated?.lists, one: 'list', many: 'lists' },
    { value: associated?.feedgens, one: 'feed', many: 'feeds' },
    { value: associated?.starterPacks, one: 'starter pack', many: 'starter packs' },
  ].filter((extra): extra is { value: number; one: string; many: string } =>
    extra.value !== undefined && extra.value > 0,
  );

  return (
    <section aria-label="Profile" className="card fn-lp-preview fn-lp-profile">
      {/* Banner: only when the account has one. The Field Notes card is a
          plain white panel, so there's no stand-in gradient. */}
      {banner && (
        <div
          className="profile-preview-banner"
          style={{
            background: `url(${sanitizeUrl(banner)}) center/cover`,
            backgroundColor: 'var(--bg-tertiary)',
          }}
        />
      )}

      <div className="fn-lp-profile-body">
        <div className="fn-lp-profile-id">
          <div className="fn-lp-avatar">
            {avatar ? (
              <img src={sanitizeUrl(avatar)} alt={displayName || handle} />
            ) : (
              <User size={24} color="var(--accent-forest)" aria-hidden />
            )}
          </div>

          <div className="fn-lp-profile-names">
            {/* Not a heading: the card sits above the page's h1 ("Open … in"),
                so an h2 here would break the outline. */}
            <p className="fn-lp-profile-name">
              <span>{displayName || handle}</span>
              {isVerified && (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ flexShrink: 0 }}
                  aria-label="Verified"
                  role="img"
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
            </p>
            <span className="fn-lp-handle">@{handle}</span>
          </div>
        </div>

        {description && <div className="fn-lp-profile-bio">{renderDescription()}</div>}

        {(stats.length > 0 || joinDate) && (
          <div className="fn-lp-profile-stats">
            {stats.map((stat, i) => (
              <span key={stat.label}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                <strong>{stat.value.toLocaleString()}</strong> {stat.label}
              </span>
            ))}
            {joinDate && (
              <span className="fn-lp-profile-joined">
                <Calendar size={13} aria-hidden />
                Joined {joinDate}
              </span>
            )}
          </div>
        )}

        {extras.length > 0 && (
          <div className="fn-lp-profile-extras">
            {extras.map((extra) => (
              <span key={extra.one}>
                <strong>{extra.value}</strong> {extra.value !== 1 ? extra.many : extra.one}
              </span>
            ))}
          </div>
        )}

        {/* Cross-product: view this profile's raw repo in the explorer */}
        <div className="fn-lp-preview-foot">
          <Link
            href={`/explore/${encodeRepo(handle)}`}
            prefetch={false}
            className="profile-explorer-link"
          >
            <Telescope size={13} aria-hidden />
            View repo in the Explorer →
          </Link>
        </div>
      </div>
    </section>
  );
}
