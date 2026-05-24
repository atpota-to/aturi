'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import Link from 'next/link';
import { Server } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import ProfileHeader from './ProfileHeader';
import AccountStats from '@/components/account/AccountStats';
import CollectionsTab from './tabs/CollectionsTab';
import IdentityTab from './tabs/IdentityTab';
import AuditTab from './tabs/AuditTab';
import BacklinksTab from './tabs/BacklinksTab';

const TABS = [
  { id: 'collections', label: 'Lexicons' },
  { id: 'identity', label: 'ID' },
  { id: 'audit', label: 'Log' },
  { id: 'backlinks', label: 'Backlinks' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function RepoExplorer({ repo }: { repo: string }) {
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setError(null);
    resolveIdentifier(repo)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (error) {
    return (
      <div>
        <p className="explore-error">{error}</p>
        <p className="explore-hint">
          Try a handle (<code>aturi.to</code>), a DID (<code>did:plc:…</code>), or an{' '}
          <code>at://</code> URI.
        </p>
      </div>
    );
  }
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Breadcrumb at the repo level shows pds → @handle. The PDS segment
          earns the slot here even though there's nothing nested below it
          on this view — it's the only \"drill up\" affordance at the top
          of the explorer hierarchy. */}
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          // Universal link for the profile — anyone can paste this anywhere
          // and the WaypointPicker on aturi.to handles client selection.
          shareUrl={`/${identity.handle || identity.did}`}
        />
      </AppearIn>
      <AppearIn delay={0.04}>
        <ProfileHeader identity={identity} />
      </AppearIn>
      <AppearIn delay={0.1}>
        <IdentityRow identity={identity} />
      </AppearIn>
      {/* High-level stats — same tile grid the account-settings page
          uses, dropped in here so anyone viewing a repo (not just its
          owner) sees how big it is, when it was created, and how much
          inbound activity it has. */}
      <AppearIn delay={0.16}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 400,
              color: 'var(--text-primary)',
            }}
          >
            Repo at a glance
          </h2>
          <AccountStats did={identity.did} handle={identity.handle} />
        </section>
      </AppearIn>
      <AppearIn delay={0.22}>
        <TabbedView identity={identity} />
      </AppearIn>
    </div>
  );
}

function IdentityRow({ identity }: { identity: IdentityBundle }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
        gap: '1rem',
        padding: '1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        margin: 0,
      }}
    >
      <Cell
        label="handle"
        value={identity.handle ? `@${identity.handle}` : null}
        copy={!!identity.handle}
        copyValue={identity.handle || undefined}
      />
      <Cell label="did" value={identity.did} copy />
      <PdsCell pds={identity.pds} />
    </dl>
  );
}

function PdsCell({ pds }: { pds: string }) {
  const host = pdsHostname(pds);
  return (
    <div>
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        pds
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
        <Link
          href={`/explore/pds/${encodeURIComponent(host)}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
        >
          <Server size={12} aria-hidden style={{ opacity: 0.7 }} />
          <code
            style={{ background: 'transparent', padding: 0, color: 'inherit' }}
          >
            {pds}
          </code>
        </Link>
        <CopyButton value={pds} label="Copy pds" compact variant="subtle" />
      </dd>
    </div>
  );
}

function Cell({
  label,
  value,
  copy,
  copyValue,
}: {
  label: string;
  value: string | null;
  copy?: boolean;
  copyValue?: string;
}) {
  return (
    <div>
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
        {value ? (
          <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
            {value}
          </code>
        ) : (
          <span className="explore-muted">unknown</span>
        )}
        {copy && value && (
          <CopyButton
            value={copyValue ?? value}
            label={`Copy ${label}`}
            compact
            variant="subtle"
          />
        )}
      </dd>
    </div>
  );
}

function TabbedView({ identity }: { identity: IdentityBundle }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get('tab') || 'collections') as TabId;
  const tab: TabId = TABS.find((t) => t.id === tabParam) ? tabParam : 'collections';

  function selectTab(id: TabId) {
    const next = new URLSearchParams(searchParams.toString());
    if (id === 'collections') next.delete('tab');
    else next.set('tab', id);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.25rem',
          borderBottom: '1px solid var(--border-medium)',
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              className="explore-tab"
              data-active={active}
              style={{
                background: 'transparent',
                border: 0,
                padding: '0.625rem 0.875rem',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.875rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                borderBottom: `2px solid ${active ? 'var(--text-accent)' : 'transparent'}`,
                marginBottom: '-1px',
                transition: 'color 0.2s ease, border-color 0.2s ease',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        {tab === 'collections' && <CollectionsTab identity={identity} />}
        {tab === 'identity' && <IdentityTab identity={identity} />}
        {tab === 'audit' && <AuditTab identity={identity} />}
        {tab === 'backlinks' && <BacklinksTab target={identity.did} />}
      </div>
    </div>
  );
}
