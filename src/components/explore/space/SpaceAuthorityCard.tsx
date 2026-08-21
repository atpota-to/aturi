'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Server } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { resolveSpaceAuthority, type SpaceAuthority } from '@/utils/atproto/spaceIdentity';
import CopyButton from '../CopyButton';

/**
 * Tier 0 for the space authority: who runs the space, where its space-host
 * requests go, and which published key signs its credentials. All of it comes
 * out of the authority's DID document, so it renders for a signed-out visitor
 * exactly as it does for a member.
 *
 * The two "how we found it" flags are the point of the card rather than
 * decoration. An authority that publishes a dedicated `#atproto_space_host`
 * service and a dedicated `#atproto_space` key is running spaces deliberately;
 * one reached through the ordinary PDS entry and the ordinary signing key is
 * being addressed by the protocol's fallbacks, which is legal but worth seeing.
 */
export default function SpaceAuthorityCard({
  did,
  handle,
}: {
  did: string;
  handle: string | null;
}) {
  const [authority, setAuthority] = useState<SpaceAuthority | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAuthority(null);
    setResolved(false);
    resolveSpaceAuthority(did).then((result) => {
      if (cancelled) return;
      setAuthority(result);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  const spaceHostName = authority ? pdsHostname(authority.spaceHost) : null;

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: '1rem',
          color: 'var(--text-primary)',
        }}
      >
        Space authority
      </h2>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: '1rem',
          margin: 0,
        }}
      >
        <Field label="authority">
          <Link href={`/explore/${did}`} style={valueLinkStyle}>
            <code style={codeStyle}>{handle ? `@${handle}` : did}</code>
          </Link>
          <CopyButton value={did} label="Copy did" compact variant="subtle" />
        </Field>

        <Field label="space host">
          {!resolved ? (
            <span className="explore-muted">resolving…</span>
          ) : authority && spaceHostName ? (
            <>
              <Link
                href={`/explore/pds/${encodeURIComponent(spaceHostName)}`}
                style={valueLinkStyle}
              >
                <Server size={12} aria-hidden style={{ opacity: 0.7 }} />
                <code style={codeStyle}>{authority.spaceHost}</code>
              </Link>
              <CopyButton value={authority.spaceHost} label="Copy space host" compact variant="subtle" />
            </>
          ) : (
            <span className="explore-muted">unknown</span>
          )}
        </Field>

        <Field label="space key">
          {!resolved ? (
            <span className="explore-muted">resolving…</span>
          ) : authority ? (
            <code style={codeStyle}>{authority.spaceKeyId}</code>
          ) : (
            <span className="explore-muted">unknown</span>
          )}
        </Field>
      </dl>

      {resolved && authority && (
        <p style={noteStyle}>
          {authority.dedicatedHost
            ? 'Reached at a dedicated #atproto_space_host service entry.'
            : 'No #atproto_space_host entry is published, so requests go to the account’s PDS — the protocol’s fallback.'}{' '}
          {authority.spaceKeyId === '#atproto_space'
            ? 'Credentials are signed by a dedicated #atproto_space key.'
            : 'Credentials are signed by the account’s ordinary #atproto signing key.'}
        </p>
      )}
      {resolved && !authority && (
        <p style={noteStyle}>
          This DID document couldn’t be resolved, or publishes no service entry a
          space host could be reached at. Nothing in this space will load.
        </p>
      )}
    </section>
  );
}

const codeStyle: React.CSSProperties = {
  background: 'transparent',
  padding: 0,
  color: 'inherit',
};

const valueLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  minWidth: 0,
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          wordBreak: 'break-all',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {children}
      </dd>
    </div>
  );
}
