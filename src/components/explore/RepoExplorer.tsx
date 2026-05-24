'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import Link from 'next/link';
import { Server } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import AppearIn from './AppearIn';
import CopyButton from './CopyButton';
import ProfileHeader from './ProfileHeader';
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
      {/* No breadcrumb at the repo level — the ProfileHeader (or the
          technical identity row below it for non-Bluesky DIDs) already
          tells the user which account they're inspecting. The Breadcrumb
          component is rendered by CollectionExplorer / RecordExplorer
          when there are nested segments to navigate back through. */}
      <AppearIn rise>
        <ProfileHeader identity={identity} />
      </AppearIn>
      <AppearIn delay={0.06}>
        <IdentityRow identity={identity} />
      </AppearIn>
      <AppearIn delay={0.12}>
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
      <Cell label="handle" value={identity.handle ? `@${identity.handle}` : null} />
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

function Cell({ label, value, copy }: { label: string; value: string | null; copy?: boolean }) {
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
        {copy && value && <CopyButton value={value} label={`Copy ${label}`} compact variant="subtle" />}
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
