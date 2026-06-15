'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import {
  DEFAULT_REPO_SECTIONS,
  sectionHidden,
  type RepoSectionId,
} from '@/utils/exploreSections';
import { setSectionHidden } from '@/utils/preferences';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Server } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { usePreferences } from '@/components/PreferencesProvider';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import ProfileHeader from './ProfileHeader';
import RelationshipStrip from './RelationshipStrip';
import AccountStats from '@/components/account/AccountStats';
import CollectionsTab from './tabs/CollectionsTab';
import IdentityTab from './tabs/IdentityTab';
import AuditTab from './tabs/AuditTab';
import BacklinksTab from './tabs/BacklinksTab';
import NotFoundPanel from '@/components/NotFoundPanel';

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
  const { prefs, update, loading } = usePreferences();

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
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That handle didn't resolve."
        body={`We tried to resolve "${repo}" and the AT Protocol resolver returned: ${error}. Try a handle, DID, or AT URI below.`}
        initialQuery={repo}
      />
    );
  }
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

  // The repo page renders the user's chosen sections in their chosen order
  // (configurable in Settings → Sections). Until prefs settle we use the
  // defaults so first paint matches SSR and avoids a hydration mismatch.
  const settled = !loading;
  const repoSections = settled ? prefs.repoSections : DEFAULT_REPO_SECTIONS;
  const profileHidden = sectionHidden(repoSections, 'profile');

  const sectionRenderers: Record<RepoSectionId, () => ReactNode> = {
    // Self-suppresses for own / signed-out visitors.
    relationship: () => <RelationshipStrip target={identity} />,
    // Profile keeps its inline switch even when the card is hidden, so it can
    // be re-shown right on the page (mirrors the record page's rich preview).
    profile: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {!profileHidden && <ProfileHeader identity={identity} />}
        <ProfileViewSwitch
          minimal={profileHidden}
          onToggle={() =>
            update((p) => setSectionHidden(p, 'repo', 'profile', !profileHidden))
          }
        />
      </div>
    ),
    identity: () => <IdentityRow identity={identity} />,
    repoGlance: () => (
      <RepoGlanceSection
        identity={identity}
        startCollapsed={settled && prefs.repoGlanceCollapsedByDefault}
      />
    ),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Breadcrumb at the repo level shows pds → @handle — fixed at the top,
          not part of the configurable section list. */}
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          // Universal link for the profile — anyone can paste this anywhere
          // and the WaypointPicker on aturi.to handles client selection.
          shareUrl={`/profile/${identity.handle || identity.did}`}
        />
      </AppearIn>
      {repoSections.map(({ id, hidden }, i) => {
        // Profile keeps its switch even when collapsed; other sections go.
        if (id !== 'profile' && hidden) return null;
        const node = sectionRenderers[id as RepoSectionId]();
        if (node == null) return null;
        return (
          <AppearIn key={id} delay={Math.min(0.04 + i * 0.04, 0.2)}>
            {node}
          </AppearIn>
        );
      })}
      {/* Tabbed collections / identity / log / backlinks — core content,
          fixed at the bottom and not configurable. */}
      <AppearIn delay={0.24}>
        <TabbedView identity={identity} />
      </AppearIn>
    </div>
  );
}

/**
 * "Repo at a glance" stats, collapsible in place. The initial open/closed
 * state comes from the user's `repoGlanceCollapsedByDefault` preference; once
 * the user clicks the header the session override (`collapsed`) wins. Mirrors
 * the per-group collapse pattern in the Collections tab.
 */
function RepoGlanceSection({
  identity,
  startCollapsed,
}: {
  identity: IdentityBundle;
  startCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const isCollapsed = collapsed ?? startCollapsed;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <h2 style={{ margin: 0 }}>
        <button
          type="button"
          onClick={() => setCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: 0,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: 400,
            fontFamily: 'inherit',
            color: 'var(--text-primary)',
          }}
        >
          {isCollapsed ? (
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          ) : (
            <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          )}
          Repo at a glance
        </button>
      </h2>
      {!isCollapsed && <AccountStats did={identity.did} handle={identity.handle} />}
    </section>
  );
}

/**
 * Subtle inline "Hide / Show rich preview" control beneath the profile card —
 * the repo-page sibling of the record page's rich-preview switch. Hiding the
 * card leaves the always-present identity row. Persists the choice via the
 * preferences store so it carries across pages and devices.
 */
function ProfileViewSwitch({
  minimal,
  onToggle,
}: {
  minimal: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        alignSelf: 'flex-start',
        padding: 0,
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.75rem',
        letterSpacing: '0.04em',
        color: 'var(--text-tertiary)',
        transition: 'color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-tertiary)';
      }}
    >
      {minimal ? 'Show rich preview' : 'Hide rich preview'}
    </button>
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
