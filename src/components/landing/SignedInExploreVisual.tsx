'use client';

import {
  Cloud,
  Layers,
  Server,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * Static mock of what /explore/<repo> looks like once you sign in:
 *   - A "Synced" pill in the header — preferences (pins, custom
 *     waypoints, theme) ride along with your PDS so every device
 *     stays in lockstep.
 *   - The "You + @them" relationship strip just above the profile
 *     header, with same-PDS, mutual-follow, mutuals, and shared
 *     lexicons chips.
 */
export default function SignedInExploreVisual() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '460px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        transform: 'rotate(-0.3deg)',
      }}
    >
      {/* Header strip with signed-in pill + Synced indicator. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background:
            'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          Explore · signed in as @you.bsky.social
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            border: '1px solid var(--text-accent)',
            color: 'var(--text-accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            letterSpacing: '0.04em',
            background: 'var(--bg-tertiary)',
          }}
          title="Preferences sync to your PDS"
        >
          <Cloud size={10} aria-hidden />
          Synced
        </span>
      </div>

      {/* You + @them relationship strip. */}
      <section
        style={{
          margin: '10px',
          padding: '10px 12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '0.6rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          You + @example.bsky.social
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          <Chip icon={<Server size={10} aria-hidden />}>
            Same PDS · pds.example.host
          </Chip>
          <Chip icon={<UserCheck size={10} aria-hidden />} accent>
            Mutual follow
            <span style={{ opacity: 0.7, marginLeft: '0.3rem' }}>
              · since Mar 14, 2024
            </span>
          </Chip>
          <Chip icon={<Users size={10} aria-hidden />}>
            42 mutuals
          </Chip>
          <Chip icon={<Layers size={10} aria-hidden />}>
            6 lexicons in common
          </Chip>
        </div>
      </section>

      {/* Profile header preview beneath, so the strip reads as a banner
          on top of an account page rather than a floating chip group. */}
      <div
        style={{
          margin: '0 10px 10px',
          padding: '10px 12px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background:
              'linear-gradient(135deg, var(--text-accent), var(--bg-elevated, var(--bg-secondary)))',
            border: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}
          >
            example.bsky.social
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            did:plc:abc
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  icon,
  accent,
  children,
}: {
  icon: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 7px',
        background: 'var(--bg-tertiary)',
        border: `1px solid ${accent ? 'var(--text-accent)' : 'var(--border-subtle)'}`,
        color: accent ? 'var(--text-accent)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.68rem',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </span>
  );
}
