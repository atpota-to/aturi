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
    <section className="fx-card fx-sp-section">
      <div className="fx-sp-head">
        <h2 className="fx-sp-h2">Space authority</h2>
      </div>

      <div className="fx-sp-body">
        <dl className="fx-sp-fields">
          <Field label="Authority">
            <Link href={`/explore/${did}`} prefetch={false}>
              <code>{handle ? `@${handle}` : did}</code>
            </Link>
            <CopyButton value={did} label="Copy did" compact variant="subtle" iconOnly />
          </Field>

          <Field label="Space host">
            {!resolved ? (
              <span className="explore-muted">resolving…</span>
            ) : authority && spaceHostName ? (
              <>
                <Link
                  href={`/explore/pds/${encodeURIComponent(spaceHostName)}`}
                  prefetch={false}
                >
                  <Server size={12} aria-hidden />
                  <code>{authority.spaceHost}</code>
                </Link>
                <CopyButton
                  value={authority.spaceHost}
                  label="Copy space host"
                  compact
                  variant="subtle"
                  iconOnly
                />
              </>
            ) : (
              <span className="explore-muted">unknown</span>
            )}
          </Field>

          <Field label="Space key">
            {!resolved ? (
              <span className="explore-muted">resolving…</span>
            ) : authority ? (
              <code>{authority.spaceKeyId}</code>
            ) : (
              <span className="explore-muted">unknown</span>
            )}
          </Field>
        </dl>

        {resolved && authority && (
          <p className="fx-sp-note">
            {authority.dedicatedHost
              ? 'Reached at a dedicated #atproto_space_host service entry.'
              : 'No #atproto_space_host entry is published, so requests go to the account’s PDS, which is the protocol’s fallback.'}{' '}
            {authority.spaceKeyId === '#atproto_space'
              ? 'Credentials are signed by a dedicated #atproto_space key.'
              : 'Credentials are signed by the account’s ordinary #atproto signing key.'}
          </p>
        )}
        {resolved && !authority && (
          <p className="fx-sp-note">
            This DID document couldn’t be resolved, or publishes no service entry a
            space host could be reached at. Nothing in this space will load.
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
