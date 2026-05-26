'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heart, Layers, Server, UserCheck, UserPlus, Users } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import {
  getProfileWithViewer,
  type AppViewProfileWithViewer,
} from '@/utils/atproto/appview';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { encodeRepo } from '@/utils/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { useMyCollections, useRepoCollections } from './useRepoCollections';

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
  const targetCollections = useRepoCollections(targetDid, targetPds);
  const myCollections = useMyCollections(targetDid);
  const inCommonCount = useMemo(() => {
    if (!targetCollections || !myCollections) return 0;
    let n = 0;
    for (const c of myCollections) if (targetCollections.has(c)) n++;
    return n;
  }, [targetCollections, myCollections]);

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
  // `viewer.following` is an AT URI like
  // `at://<myDid>/app.bsky.graph.follow/<tid-rkey>`. TIDs encode the
  // creation microsecond in their first 53 bits — decode to surface
  // "You followed them on Mar 14, 2024" without a second network call.
  const youFollowedOn = dateFromFollowUri(profile?.viewer?.following);
  const theyFollowedOn = dateFromFollowUri(profile?.viewer?.followedBy);
  const mutualCount = profile?.knownFollowers?.count ?? 0;
  const mutualLink = `/explore/${encodeRepo(target.handle || target.did)}?tab=identity`;
  const collectionsLink = `/explore/${encodeRepo(target.handle || target.did)}?tab=collections`;

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
            {youFollowedOn && (
              <span style={{ opacity: 0.75, marginLeft: '0.25rem' }}>
                · since {formatShortDate(youFollowedOn)}
              </span>
            )}
          </Chip>
        ) : (
          <>
            {youFollow && (
              <Chip icon={<UserPlus size={11} aria-hidden />} tone="neutral">
                You follow them
                {youFollowedOn && (
                  <span style={{ opacity: 0.75, marginLeft: '0.25rem' }}>
                    · {formatShortDate(youFollowedOn)}
                  </span>
                )}
              </Chip>
            )}
            {followsYou && (
              <Chip icon={<Heart size={11} aria-hidden />} tone="neutral">
                They follow you
                {theyFollowedOn && (
                  <span style={{ opacity: 0.75, marginLeft: '0.25rem' }}>
                    · {formatShortDate(theyFollowedOn)}
                  </span>
                )}
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
        {inCommonCount > 0 && (
          <Link
            href={collectionsLink}
            style={{ textDecoration: 'none' }}
          >
            <Chip icon={<Layers size={11} aria-hidden />} tone="neutral">
              {inCommonCount.toLocaleString()}{' '}
              {inCommonCount === 1 ? 'lexicon' : 'lexicons'} in common
            </Chip>
          </Link>
        )}
        {!samePds && !followsYou && !youFollow && mutualCount === 0 && inCommonCount === 0 && (
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

/**
 * Extract the creation date of a follow record from its AT URI by
 * decoding the TID rkey. TIDs are 13-char base32-sortable strings whose
 * upper 53 bits encode microseconds since the UNIX epoch — accurate
 * enough that we can avoid a second getRecord round-trip for createdAt.
 */
function dateFromFollowUri(uri: string | undefined): Date | null {
  if (!uri) return null;
  const parts = uri.split('/');
  const rkey = parts[parts.length - 1];
  if (!rkey || rkey.length !== 13) return null;
  return tidToDate(rkey);
}

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

function tidToDate(tid: string): Date | null {
  // Decode directly into milliseconds: shift the bottom 10 clock-id bits
  // off first by skipping them, then accumulate as a plain Number. The
  // resulting epoch-ms value fits well inside JS's safe-integer range
  // (current time is ~1.7e12, MAX_SAFE_INTEGER is ~9e15), so no need
  // for BigInt — which would push the TS lib target up to ES2020.
  let micros = 0;
  for (const ch of tid) {
    const i = TID_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    micros = micros * 32 + i;
  }
  // Strip the bottom 10 bits (clock identifier) by dividing — equivalent
  // to `>> 10n` on a BigInt, but stays inside Number precision because
  // we never observe the bottom bits as a separate value.
  const ms = Math.floor(micros / 1024 / 1000);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
