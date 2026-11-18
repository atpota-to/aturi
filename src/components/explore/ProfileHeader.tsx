'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { getRecord } from '@/utils/atproto/pdsClient';
import type { IdentityBundle } from '@/utils/atproto/identity';
import ShareLinkChip from './ShareLinkChip';

type Props = {
  identity: IdentityBundle;
  /**
   * False skips the AppView profile entirely (the visitor hid the rich
   * preview) and renders only `children`, so the card still carries the
   * technical identity rows.
   */
  showProfile?: boolean;
  /**
   * Rendered inside the same card under the profile — the explorer's
   * DID / PDS list. With children, the card renders even for accounts with
   * no Bluesky profile.
   */
  children?: ReactNode;
  /** Adds an icon button beside "Open profile in…" that copies this link. */
  shareUrl?: string;
};

type ProfileRecordExtras = {
  website?: string;
  pronouns?: string;
};

/**
 * Profile header for the explore repo page, and the rich preview card on the
 * `app.bsky.actor.profile/self` record page. Pulls from two sources:
 *
 *   1. app.bsky.actor.getProfile (AppView) — gives us avatar URL, display
 *      name, description, pronouns, follower/post counts.
 *   2. app.bsky.actor.profile record (PDS) — surfaces extension fields like
 *      `website` that don't round-trip through the AppView.
 *
 * Either fetch failing is non-fatal: the header degrades to whatever it
 * has, and the identity row below it still renders the technical bits.
 */
export default function ProfileHeader({
  identity,
  showProfile = true,
  children,
  shareUrl,
}: Props) {
  const [profile, setProfile] = useState<AppViewProfile | null | undefined>(undefined);
  const [extras, setExtras] = useState<ProfileRecordExtras>({});

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setExtras({});
    if (!showProfile) return undefined;

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
  }, [identity.did, identity.pds, showProfile]);

  const handle = identity.handle || profile?.handle;
  const actions = (
    // "Open profile in…" is the universal link page, where the visitor picks
    // which client to open the profile in.
    <div className="fx-acct-actions">
      <Link
        href={`/profile/${handle || identity.did}`}
        prefetch={false}
        className="fx-btn fx-btn-lg profile-explorer-link"
      >
        Open profile in…
      </Link>
      {shareUrl && <ShareLinkChip url={shareUrl} label="Copy universal link" iconOnly />}
    </div>
  );

  // No profile to show (hidden, still loading, a non-Bluesky DID, or an
  // account with no profile record): the card is just its children, when the
  // caller gave it any.
  const bare = children ? (
    <section aria-label="Account" className="fx-card fx-acct">
      {children}
      {shareUrl && actions}
    </section>
  ) : null;

  if (!showProfile || profile === undefined || profile === null) return bare;

  const displayName = profile.displayName?.trim();
  const description = profile.description?.trim();
  const pronouns = profile.pronouns?.trim() || extras.pronouns?.trim();
  const website = extras.website?.trim();
  // Website resolution: prefer the explicit `website` field on the profile
  // record; otherwise fall back to `https://<handle>` when the handle looks
  // like a real domain. Many self-hosted handles (certified.app, dame.is,
  // anisota.net) ARE their own website and never bother to fill in the
  // separate field. *.bsky.social / *.bsky.network users get the same
  // treatment — those subdomains may not host much, but the affordance is
  // consistent and the worst case is one extra tab that resolves to
  // Bluesky's umbrella page.
  const websiteHref =
    normalizeUrl(website) ?? handleAsWebsite(handle);
  const websiteLabel = websiteHref ? prettyHostname(websiteHref) : null;

  // Bail entirely if there's nothing interesting to show — this is the
  // signal that this DID isn't a Bluesky-style account.
  if (!displayName && !description && !profile.avatar && !pronouns && !website) {
    return bare;
  }

  const initial = (displayName || handle || '?').replace(/^@/, '').charAt(0);

  return (
    <section aria-label="Account" className="fx-card fx-acct">
      <div className="fx-acct-top">
        {profile.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar}
            alt={displayName || handle || ''}
            width={44}
            height={44}
            className="fx-avatar"
          />
        ) : (
          <div aria-hidden className="fx-avatar">
            {initial}
          </div>
        )}
        <div className="fx-acct-names">
          <div className="fx-acct-name-row">
            {displayName && <h2 className="fx-acct-name">{displayName}</h2>}
            {pronouns && <span className="fx-acct-pronouns">{pronouns}</span>}
          </div>
          {handle && (
            <div className="fx-acct-handle">
              {websiteHref ? (
                // Handle doubles as the website link when the profile has one.
                // The trailing ExternalLink icon signals that the tap leaves
                // the site, since the handle alone reads as an identifier.
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={websiteLabel ?? websiteHref}
                >
                  <span>@{handle}</span>
                  <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                <>@{handle}</>
              )}
            </div>
          )}
        </div>
      </div>

      {description && <p className="fx-acct-bio">{description}</p>}

      {hasStats(profile) && (
        <div className="fx-stats">
          {profile.followersCount != null && (
            <Stat value={profile.followersCount} label="followers" />
          )}
          {profile.followsCount != null && (
            <Stat value={profile.followsCount} label="following" />
          )}
          {profile.postsCount != null && <Stat value={profile.postsCount} label="posts" />}
        </div>
      )}

      {children}

      {actions}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="fx-stat">
      <span className="fx-stat-value">{value.toLocaleString()}</span>
      <span className="fx-stat-label">{label}</span>
    </div>
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

/**
 * Treat the handle as a potential website when it parses as a domain.
 * Filters out: nulls, DIDs (`did:plc:...`), and bare strings without a dot
 * (single-segment handles can't be a valid hostname). Everything else
 * tries `https://<handle>` — the URL constructor + an http(s) protocol
 * guard does the rest of the sanity check.
 */
function handleAsWebsite(handle: string | null | undefined): string | null {
  if (!handle) return null;
  if (handle.startsWith('did:')) return null;
  if (!handle.includes('.')) return null;
  try {
    const url = new URL(`https://${handle}`);
    if (url.protocol !== 'https:') return null;
    // Reject anything where the hostname doesn't round-trip — guards
    // against handles with characters that aren't valid in a hostname.
    if (url.hostname.toLowerCase() !== handle.toLowerCase()) return null;
    return url.toString();
  } catch {
    return null;
  }
}
