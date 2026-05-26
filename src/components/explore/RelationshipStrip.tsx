'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Server, UserCheck, UserPlus, Users } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import {
  getProfileWithViewer,
  type AppViewProfileWithViewer,
} from '@/utils/atproto/appview';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { encodeRepo } from '@/utils/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';

type Props = {
  /** The repo the visitor is currently viewing. */
  target: IdentityBundle;
};

/**
 * "You + @them" relationship strip shown above the profile header on
 * /explore/<repo> when a signed-in visitor is viewing somebody else's
 * repo. Surfaces three signals:
 *
 *   - Same PDS host (free — both PDS endpoints are already on hand).
 *   - Bidirectional follow status from the AppView's `viewer` block.
 *   - Mutual followers count from `knownFollowers.count`.
 *
 * Both viewer state and known-followers are AppView-authenticated
 * fields, so we route through the session agent (the unauth public.api
 * endpoint silently omits them).
 *
 * Bidirectional backlink counts (you -> them, them -> you) were on the
 * original ask but skipped for v1 — Constellation can count inbound
 * links by target but doesn't expose a "from did X" filter, so deriving
 * per-pair counts requires paginating every (collection, path) source
 * and filtering client-side. Heavyweight enough that we kicked it down
 * the road; the existing BacklinksTab still surfaces the full set.
 */
export default function RelationshipStrip({ target }: Props) {
  const { agent, did: myDid } = useAtprotoSession();
  const [profile, setProfile] = useState<AppViewProfileWithViewer | null>(null);
  const [myPds, setMyPds] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const targetDid = target.did;
  const targetPds = target.pds;
  const showStrip = Boolean(myDid) && Boolean(agent) && myDid !== targetDid;

  useEffect(() => {
    if (!showStrip || !agent || !myDid) {
      setProfile(null);
      setMyPds(null);
      setLoaded(false);
      return undefined;
    }
    let cancelled = false;
    setLoaded(false);
    // Fan-out: authed profile (viewer + knownFollowers) AND my own
    // identity (to compare PDS hosts). Both are cached so a second
    // visit to the same repo is instant.
    Promise.all([
      getProfileWithViewer(agent, targetDid),
      resolveIdentifier(myDid).then((id) => id.pds).catch(() => null),
    ]).then(([p, pds]) => {
      if (cancelled) return;
      setProfile(p);
      setMyPds(pds);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showStrip, agent, targetDid, myDid]);

  if (!showStrip) return null;
  if (!loaded) {
    return (
      <section style={shellStyle}>
        <div style={titleStyle}>You + {targetLabel(target)}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Loading relationship…
        </div>
      </section>
    );
  }

  const samePds =
    myPds && targetPds && pdsHostname(myPds) === pdsHostname(targetPds);
  const followsYou = Boolean(profile?.viewer?.followedBy);
  const youFollow = Boolean(profile?.viewer?.following);
  const mutualCount = profile?.knownFollowers?.count ?? 0;
  const mutualLink = `/explore/${encodeRepo(target.handle || target.did)}?tab=identity`;

  return (
    <section style={shellStyle}>
      <div style={titleStyle}>You + {targetLabel(target)}</div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center',
        }}
      >
        {samePds && (
          <Chip icon={<Server size={11} aria-hidden />} tone="neutral">
            Same PDS · {pdsHostname(targetPds)}
          </Chip>
        )}
        {followsYou && youFollow ? (
          <Chip icon={<UserCheck size={11} aria-hidden />} tone="accent">
            Mutual follow
          </Chip>
        ) : (
          <>
            {youFollow && (
              <Chip icon={<UserPlus size={11} aria-hidden />} tone="neutral">
                You follow them
              </Chip>
            )}
            {followsYou && (
              <Chip icon={<Heart size={11} aria-hidden />} tone="neutral">
                They follow you
              </Chip>
            )}
          </>
        )}
        {mutualCount > 0 && (
          <Link
            href={mutualLink}
            style={{ textDecoration: 'none' }}
          >
            <Chip icon={<Users size={11} aria-hidden />} tone="neutral">
              {mutualCount.toLocaleString()}{' '}
              {mutualCount === 1 ? 'mutual' : 'mutuals'}
            </Chip>
          </Link>
        )}
        {!samePds && !followsYou && !youFollow && mutualCount === 0 && (
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            No public signals between your accounts.
          </span>
        )}
      </div>
    </section>
  );
}

function Chip({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: 'accent' | 'neutral';
  children: React.ReactNode;
}) {
  const accent = tone === 'accent';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.55rem',
        background: accent ? 'var(--bg-tertiary)' : 'var(--bg-tertiary)',
        border: `1px solid ${
          accent ? 'var(--text-accent)' : 'var(--border-subtle)'
        }`,
        color: accent ? 'var(--text-accent)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.75rem',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function targetLabel(target: IdentityBundle): string {
  if (target.handle) return `@${target.handle}`;
  return target.did.length > 24 ? `${target.did.slice(0, 24)}…` : target.did;
}

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.625rem',
  padding: '0.75rem 1rem',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-medium)',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};
