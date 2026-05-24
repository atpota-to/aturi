'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Heart, MessageSquare, Users } from 'lucide-react';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { getRecord } from '@/utils/atproto/pdsClient';
import type { IdentityBundle } from '@/utils/atproto/identity';

type Props = {
  identity: IdentityBundle;
};

type ProfileRecordExtras = {
  website?: string;
  pronouns?: string;
};

/**
 * Profile header for the explore repo page. Pulls from two sources:
 *
 *   1. app.bsky.actor.getProfile (AppView) — gives us avatar URL, display
 *      name, description, pronouns, follower/post counts.
 *   2. app.bsky.actor.profile record (PDS) — surfaces extension fields like
 *      `website` that don't round-trip through the AppView.
 *
 * Either fetch failing is non-fatal: the header degrades to whatever it
 * has, and the identity row below it still renders the technical bits.
 */
export default function ProfileHeader({ identity }: Props) {
  const [profile, setProfile] = useState<AppViewProfile | null | undefined>(undefined);
  const [extras, setExtras] = useState<ProfileRecordExtras>({});

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setExtras({});

    getProfile(identity.did).then((p) => {
      if (cancelled) return;
      setProfile(p);
    });

    // Read the raw profile record from the PDS for extension fields.
    // Fails silently if the account has no profile record.
    getRecord(identity.pds, {
      repo: identity.did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
    })
      .then((rec) => {
        if (cancelled) return;
        const v = (rec?.value || {}) as Record<string, unknown>;
        const next: ProfileRecordExtras = {};
        if (typeof v.website === 'string') next.website = v.website;
        if (typeof v.pronouns === 'string') next.pronouns = v.pronouns;
        setExtras(next);
      })
      .catch(() => {
        // Account may have no profile record; that's fine.
      });

    return () => {
      cancelled = true;
    };
  }, [identity.did, identity.pds]);

  // Don't render anything at all for non-Bluesky DIDs / accounts with no
  // profile — the technical identity row below covers them.
  if (profile === undefined) return null;
  if (profile === null) return null;

  const displayName = profile.displayName?.trim();
  const description = profile.description?.trim();
  const pronouns = profile.pronouns?.trim() || extras.pronouns?.trim();
  const website = extras.website?.trim();
  const handle = identity.handle || profile.handle;
  const websiteHref = normalizeUrl(website);
  const websiteLabel = websiteHref ? prettyHostname(websiteHref) : null;

  // Bail entirely if there's nothing interesting to show — this is the
  // signal that this DID isn't a Bluesky-style account.
  if (!displayName && !description && !profile.avatar && !pronouns && !website) {
    return null;
  }

  return (
    <section
      style={{
        display: 'flex',
        gap: '1.25rem',
        alignItems: 'flex-start',
        padding: '1.25rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        flexWrap: 'wrap',
      }}
    >
      {profile.avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatar}
          alt={displayName || handle || ''}
          width={72}
          height={72}
          style={{
            width: '72px',
            height: '72px',
            objectFit: 'cover',
            border: '1px solid var(--border-medium)',
            flexShrink: 0,
            background: 'var(--bg-tertiary)',
          }}
        />
      )}

      <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: '0.5rem 0.75rem',
            marginBottom: '0.25rem',
          }}
        >
          {displayName && (
            <h2
              style={{
                margin: 0,
                fontSize: '1.375rem',
                fontWeight: 400,
                color: 'var(--text-primary)',
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </h2>
          )}
          {pronouns && (
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
              }}
            >
              {pronouns}
            </span>
          )}
        </div>

        {handle && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              color: 'var(--text-tertiary)',
              marginBottom: description ? '0.75rem' : 0,
              wordBreak: 'break-all',
            }}
          >
            @{handle}
          </div>
        )}

        {description && (
          <p
            style={{
              margin: 0,
              fontSize: '0.95rem',
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {description}
          </p>
        )}

        {(websiteHref || hasStats(profile)) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '0.875rem',
              fontSize: '0.8125rem',
              color: 'var(--text-tertiary)',
              // Collapse line-height so the row's icons align with their
              // text midline — body's 1.7 line-height was inflating each
              // span's box and floating the icons above center.
              lineHeight: 1,
            }}
          >
            {websiteHref && (
              <a
                href={websiteHref}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                  lineHeight: 1,
                }}
              >
                <Globe size={13} />
                <span>{websiteLabel}</span>
                <ExternalLink size={11} aria-hidden style={{ opacity: 0.6 }} />
              </a>
            )}
            {profile.followersCount != null && (
              <Stat
                icon={<Heart size={13} />}
                value={profile.followersCount}
                label="followers"
              />
            )}
            {profile.followsCount != null && (
              <Stat
                icon={<Users size={13} />}
                value={profile.followsCount}
                label="following"
              />
            )}
            {profile.postsCount != null && (
              <Stat
                icon={<MessageSquare size={13} />}
                value={profile.postsCount}
                label="posts"
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          color: 'var(--text-tertiary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
        }}
      >
        {value.toLocaleString()}
      </span>
      <span>{label}</span>
    </span>
  );
}

function hasStats(p: AppViewProfile): boolean {
  return (
    p.followersCount != null || p.followsCount != null || p.postsCount != null
  );
}

/**
 * Normalize a user-supplied URL. Accepts `example.com`, `https://example.com`,
 * `//example.com`. Rejects javascript:, data:, mailto: etc.
 */
function normalizeUrl(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const candidate =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed.replace(/^\/+/, '')}`;
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function prettyHostname(href: string): string {
  try {
    const url = new URL(href);
    return (url.hostname + url.pathname).replace(/\/$/, '');
  } catch {
    return href;
  }
}
