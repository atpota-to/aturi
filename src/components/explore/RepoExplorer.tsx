'use client';

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import RepoStatusNotice from './RepoStatusNotice';
import {
  DEFAULT_REPO_SECTIONS,
  sectionHidden,
  type RepoSectionId,
} from '@/utils/exploreSections';
import { setSectionHidden } from '@/utils/preferences';
import Link from 'next/link';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { encodeRepo } from '@/utils/atproto/urls';
import { usePreferences } from '@/components/PreferencesProvider';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import ProfileHeader from './ProfileHeader';
import RelationshipStrip from './RelationshipStrip';
import RepoSpacesSection from './space/RepoSpacesSection';
import AccountStats from '@/components/account/AccountStats';
import CollectionsTab from './tabs/CollectionsTab';
import IdentityTab from './tabs/IdentityTab';
import AuditTab from './tabs/AuditTab';
import BacklinksTab from './tabs/BacklinksTab';
import NotFoundPanel from '@/components/NotFoundPanel';
import SkeletonSwap from './skeletons/SkeletonSwap';
import { RepoSkeleton } from './skeletons/pages';

const TABS = [
  { id: 'collections', label: 'Collections' },
  { id: 'identity', label: 'Identity' },
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
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That handle didn't resolve."
        body={`We tried to resolve "${repo}" and the AT Protocol resolver returned: ${error}. Try a handle, DID, or AT URI below.`}
        initialQuery={repo}
      />
    );
  }

  return (
    <SkeletonSwap loading={!identity} skeleton={<RepoSkeleton />}>
      {identity && <RepoView identity={identity} />}
    </SkeletonSwap>
  );
}

/**
 * The repo page proper. Split from the resolver above so the skeleton and the
 * loaded page are two states of one <SkeletonSwap> rather than two returns
 * that cut between each other.
 *
 * Two columns from 960px: the account (relationship strip, account card) in a
 * 300px sidebar, and the breadcrumb, glance stats and the tabbed repository
 * card in the main column. Stacked below that, sidebar first.
 */
function RepoView({ identity }: { identity: IdentityBundle }) {
  const { prefs, update, loading } = usePreferences();

  // The repo page renders the user's chosen sections in their chosen order
  // (configurable in Settings → Sections). Until prefs settle we use the
  // defaults so first paint matches SSR and avoids a hydration mismatch.
  const settled = !loading;
  const repoSections = settled ? prefs.repoSections : DEFAULT_REPO_SECTIONS;
  const profileHidden = sectionHidden(repoSections, 'profile');
  const identityHidden = sectionHidden(repoSections, 'identity');

  // The profile and the identity rows share one account card, placed where
  // the first of the two sits in the visitor's order. Profile keeps its
  // inline switch even when hidden, so it can be re-shown right on the page
  // (mirrors the record page's rich preview).
  const accountCard = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <AccountCard identity={identity} profileHidden={profileHidden} identityHidden={identityHidden} />
      <ProfileViewSwitch
        minimal={profileHidden}
        onToggle={() =>
          update((p) => setSectionHidden(p, 'repo', 'profile', !profileHidden))
        }
      />
    </div>
  );

  const sideRenderers: Partial<Record<RepoSectionId, () => ReactNode>> = {
    // Self-suppresses for own / signed-out visitors.
    relationship: () => <RelationshipStrip target={identity} />,
    profile: () => accountCard,
    identity: () => accountCard,
  };
  let accountPlaced = false;
  const sideNodes: ReactNode[] = [];
  repoSections.forEach(({ id, hidden }, i) => {
    const isAccount = id === 'profile' || id === 'identity';
    if (isAccount) {
      if (accountPlaced) return;
      accountPlaced = true;
    } else if (hidden) {
      return;
    }
    const render = sideRenderers[id as RepoSectionId];
    if (!render) return;
    sideNodes.push(
      <AppearIn key={isAccount ? 'account' : id} delay={Math.min(0.04 + i * 0.04, 0.2)}>
        {render()}
      </AppearIn>,
    );
  });
  const glanceSection = repoSections.find((s) => s.id === 'repoGlance');

  return (
    <div className="fx-explorer" data-page="repo">
      <div className="fx-head">
        {/* The collection and record pages carry a visible h1 title bar; here
            the account card is the title, so the page's h1 is for assistive
            tech only and the card keeps its h2. */}
        <h1 className="fn-sr-only">{identity.handle ? `@${identity.handle}` : identity.did}</h1>
        {/* Breadcrumb at the repo level shows pds → @handle — fixed at the
            top, not part of the configurable section list. */}
        <AppearIn rise>
          <Breadcrumb
            handle={identity.handle}
            did={identity.did}
            pds={identity.pds}
            flush
            // No share chip here: the account card's copy button carries the
            // profile's universal link.
          />
        </AppearIn>
        {/* Above everything else, and only when there's something to say:
            with the host refusing reads, half the page below comes back empty
            and the visitor deserves the reason before the blanks. */}
        {identity.repoStatus && (
          <AppearIn rise delay={0.02}>
            <RepoStatusNotice identity={identity} />
          </AppearIn>
        )}
      </div>

      <aside className="fx-side" aria-label="Account">
        {sideNodes}
      </aside>

      <div className="fx-main">
        {glanceSection && !glanceSection.hidden && (
          <AppearIn delay={0.16}>
            <RepoGlanceSection
              identity={identity}
              startCollapsed={settled && prefs.repoGlanceCollapsedByDefault}
            />
          </AppearIn>
        )}
        {/* Tabbed collections / identity / log / backlinks — core content,
            not configurable. */}
        <AppearIn delay={0.2}>
          <TabbedView identity={identity} />
        </AppearIn>
        {/* Permissioned data sits below the public repo entirely, and only
            for the account itself. Self-suppresses otherwise. */}
        <AppearIn delay={0.28}>
          <RepoSpacesSection identity={identity} />
        </AppearIn>
      </div>
    </div>
  );
}

/**
 * The account card: the AppView profile (unless the visitor hid the rich
 * preview) with the repo's identity rows under it. Shared by the repo page and
 * the collection page's sidebar.
 */
export function AccountCard({
  identity,
  profileHidden,
  identityHidden = false,
}: {
  identity: IdentityBundle;
  profileHidden: boolean;
  identityHidden?: boolean;
}) {
  return (
    <ProfileHeader
      identity={identity}
      showProfile={!profileHidden}
      // Universal link for the profile — anyone can paste this anywhere and
      // the WaypointPicker on aturi.to handles client selection.
      shareUrl={`/profile/${identity.handle || identity.did}`}
    >
      {!identityHidden && <IdentityRow identity={identity} />}
    </ProfileHeader>
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h2 style={{ margin: 0 }}>
        <button
          type="button"
          onClick={() => setCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          className="fx-glance-toggle"
        >
          <ChevronRight size={14} aria-hidden />
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
    <button type="button" onClick={onToggle} className="fx-textlink">
      {minimal ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
      {minimal ? 'Show rich preview' : 'Hide rich preview'}
    </button>
  );
}

function IdentityRow({ identity }: { identity: IdentityBundle }) {
  const host = pdsHostname(identity.pds);
  return (
    <dl className="fx-dl">
      <dt>DID</dt>
      <dd>
        <code className="fx-mono fx-trunc" title={identity.did}>
          {identity.did}
        </code>
        <CopyButton value={identity.did} label="Copy did" compact variant="subtle" iconOnly />
      </dd>
      <dt>Handle</dt>
      <dd>
        {identity.handle ? (
          <>
            <code className="fx-mono fx-trunc" title={`@${identity.handle}`}>
              @{identity.handle}
            </code>
            <CopyButton
              value={identity.handle}
              label="Copy handle"
              compact
              variant="subtle"
              iconOnly
            />
          </>
        ) : (
          <span className="explore-muted">unknown</span>
        )}
      </dd>
      <dt>PDS</dt>
      <dd>
        <span className="fx-mono fx-trunc">
          <Link
            href={`/explore/pds/${encodeURIComponent(host)}`}
            prefetch={false}
            title={identity.pds}
          >
            {host}
          </Link>
        </span>
        <CopyButton value={identity.pds} label="Copy pds" compact variant="subtle" iconOnly />
      </dd>
    </dl>
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

  // The WAI-ARIA tabs pattern: the strip is one tab stop (the open tab), and
  // the arrow keys, Home and End move between tabs, opening each as it takes
  // focus.
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(TABS[next].id);
    document.getElementById(`repo-tab-${TABS[next].id}`)?.focus();
  }

  return (
    <section aria-label="Repository" className="fx-repo">
      <div
        role="tablist"
        aria-label="Repository views"
        className="fx-tabs"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              id={`repo-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="repo-tabpanel"
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              className="fx-tab explore-tab"
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="repo-tabpanel"
        aria-labelledby={`repo-tab-${tab}`}
        className="fx-tabpanel"
      >
        {tab === 'collections' && <CollectionsTab identity={identity} />}
        {tab === 'identity' && <IdentityTab identity={identity} />}
        {tab === 'audit' && <AuditTab identity={identity} />}
        {tab === 'backlinks' && <BacklinksTab target={identity.did} />}
      </div>
    </section>
  );
}

/**
 * The collection page's sidebar copy of the repository card: the same four
 * views, as links back to the repo page's tabs, over a compact collections
 * tree with the current collection highlighted.
 */
export function RepoNavCard({
  identity,
  collection,
}: {
  identity: IdentityBundle;
  collection: string;
}) {
  const repoPath = `/explore/${encodeRepo(identity.handle || identity.did)}`;
  return (
    <section aria-label="Repository" className="fx-repo">
      <nav aria-label="Repository views" className="fx-tabs">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'collections' ? repoPath : `${repoPath}?tab=${t.id}`}
            prefetch={false}
            className="fx-tab"
            // The collection being viewed belongs to the Collections view, but
            // the link leaves this page, so it's highlighted, not aria-current.
            data-active={t.id === 'collections' || undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="fx-tabpanel">
        <CollectionsTab identity={identity} variant="sidebar" current={collection} />
      </div>
    </section>
  );
}
