'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { IdentityBundle } from '@/utils/atproto/identity';
import RepoStatusNotice from './RepoStatusNotice';
import { DEFAULT_REPO_SECTIONS, sectionHidden } from '@/utils/exploreSections';
import { setSectionHidden } from '@/utils/preferences';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { usePreferences } from '@/components/PreferencesProvider';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import { HandleCheckMark } from './HandleCheck';
import AccountChecks, { CheckNavBadge } from './AccountChecks';
import dynamic from 'next/dynamic';
import { ToolSkeleton } from '@/components/tools/ToolFrame';
import ProfileHeader from './ProfileHeader';
import RelationshipStrip from './RelationshipStrip';
import { STACKED_QUERY, useMediaQuery } from './useIsNarrow';
import RepoSpacesSection from './space/RepoSpacesSection';
import { useRepoIdentity } from './useRepoIdentity';
import AccountStats from '@/components/account/AccountStats';
import CollectionsTab from './tabs/CollectionsTab';
import IdentityTab from './tabs/IdentityTab';
import AuditTab from './tabs/AuditTab';
import BacklinksTab from './tabs/BacklinksTab';
import GraphTab from './graph/GraphTab';
import NotFoundPanel from '@/components/NotFoundPanel';
import SkeletonSwap from './skeletons/SkeletonSwap';
import { useFadeOnChange } from '@/components/useFadeOnChange';
import { RepoSkeleton } from './skeletons/pages';

const TABS = [
  { id: 'collections', label: 'Collections' },
  { id: 'glance', label: 'Stats' },
  { id: 'labels', label: 'Labels' },
  { id: 'visibility', label: 'Visibility' },
  { id: 'identity', label: 'Identity' },
  { id: 'audit', label: 'Log' },
  { id: 'backlinks', label: 'Backlinks' },
  { id: 'graph', label: 'Graph' },
] as const;

/**
 * Two tools that read the whole account, opened from the sidebar's Tools
 * list as tabs of this page. They join the strip only while one is open, so
 * the strip keeps to the repository's own views.
 */
const TOOL_TABS = [
  { id: 'lists', label: 'Lists and verifications' },
  { id: 'activity', label: 'Activity calendar' },
] as const;

/** The page's tabs, as the account's sidebar (AccountFrame) lists them. */
export const REPO_TABS = TABS;
export const REPO_TOOL_TABS = TOOL_TABS;
export type RepoTabId = (typeof TABS)[number]['id'] | (typeof TOOL_TABS)[number]['id'];
type TabId = RepoTabId;

/** The account card's two checks in full, as tabs carrying the checks' badges. */
const CHECK_TABS: ReadonlySet<TabId> = new Set(['labels', 'visibility']);

// Loaded when their tab opens; the card's rows need only the runs.
const toolLoading = () => <ToolSkeleton rows={4} />;
const LabelChecker = dynamic(() => import('@/components/tools/LabelChecker'), { loading: toolLoading });
const ShadowbanChecker = dynamic(() => import('@/components/tools/ShadowbanChecker'), { loading: toolLoading });
const Memberships = dynamic(() => import('@/components/tools/Memberships'), { loading: toolLoading });
const ActivityCalendar = dynamic(() => import('@/components/tools/ActivityCalendar'), { loading: toolLoading });

export default function RepoExplorer({ repo }: { repo: string }) {
  const { identity, error } = useRepoIdentity(repo);

  if (error) {
    return (
      <NotFoundPanel
        eyebrow="Couldn’t resolve"
        headline="That handle didn’t resolve."
        body={`We couldn’t find an account for “${repo}”. Check the spelling, or try a DID or an at:// URI below.`}
        details={error}
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
 * The breadcrumb, the glance stats and the tabbed repository card. The
 * account itself (its card, how the visitor relates to it, its tools) is in
 * the sidebar the frame draws beside every page of the repository
 * (AccountFrame), so it stays put as the visitor moves through it. Stacked,
 * the sidebar goes under the page, so the card comes here instead, under
 * the breadcrumb, where the account leads the page as it always has.
 */
function RepoView({ identity }: { identity: IdentityBundle }) {
  const { prefs, update, loading } = usePreferences();
  const stacked = useMediaQuery(STACKED_QUERY);

  // Until prefs settle we use the defaults so first paint matches SSR and
  // avoids a hydration mismatch.
  const repoSections = loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections;
  const profileHidden = sectionHidden(repoSections, 'profile');

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

      <div className="fx-main">
        {stacked && (
          <AppearIn delay={0.04}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {!sectionHidden(repoSections, 'relationship') && <RelationshipStrip target={identity} />}
              <AccountCard
                identity={identity}
                profileHidden={profileHidden}
                identityHidden={sectionHidden(repoSections, 'identity')}
              />
              <ProfileViewSwitch
                minimal={profileHidden}
                onToggle={() => update((p) => setSectionHidden(p, 'repo', 'profile', !profileHidden))}
              />
            </div>
          </AppearIn>
        )}
        {/* Tabbed collections / stats / identity / log / backlinks / graph —
            core content. The collections lead the page: the glance stats
            that used to sit above them are the Stats tab. */}
        <AppearIn delay={0.16}>
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
 * preview) with the repo's identity rows under it, then its label and
 * visibility checks. Shared by the repo page and the collection page's
 * sidebar, and drawn by the Workbench and Files rails too, so the checks are
 * on every layout's card.
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
      <AccountChecks identity={identity} />
    </ProfileHeader>
  );
}

/**
 * Subtle inline "Hide / Show rich preview" control beneath the profile card —
 * the repo-page sibling of the record page's rich-preview switch. Hiding the
 * card leaves the always-present identity row. Persists the choice via the
 * preferences store so it carries across pages and devices.
 */
export function ProfileViewSwitch({
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
            <HandleCheckMark did={identity.did} handle={identity.handle} />
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

/**
 * The tabs a visitor sees: Stats goes with the "Repo at a glance" section
 * when they hide it in Settings.
 */
export function useRepoTabs(): readonly { id: RepoTabId; label: string }[] {
  const { prefs, loading } = usePreferences();
  const glanceHidden = sectionHidden(loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections, 'repoGlance');
  return glanceHidden ? TABS.filter((t) => t.id !== 'glance') : TABS;
}

function TabbedView({ identity }: { identity: IdentityBundle }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = useRepoTabs();
  const tabParam = (searchParams.get('tab') || 'collections') as TabId;
  const openTool = TOOL_TABS.find((t) => t.id === tabParam);
  const tab: TabId = tabs.find((t) => t.id === tabParam) || openTool ? tabParam : 'collections';
  const strip: readonly { id: TabId; label: string }[] = openTool ? [...tabs, openTool] : tabs;
  // The open folder's sheet fades its new contents in as the tab rises.
  const panelRef = useRef<HTMLDivElement>(null);
  useFadeOnChange(panelRef, tab);

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
    const at = strip.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight'
        ? (at + 1) % strip.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + strip.length) % strip.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? strip.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(strip[next].id);
    document.getElementById(`repo-tab-${strip[next].id}`)?.focus();
  }

  return (
    <section aria-label="Repository" className="fx-repo">
      <div
        role="tablist"
        aria-label="Repository views"
        className="fx-tabs"
        onKeyDown={onTabKeyDown}
      >
        {strip.map((t) => {
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
              <span className="fx-tab-label" data-label={t.label}>
                {t.label}
              </span>
              {CHECK_TABS.has(t.id) && <CheckNavBadge did={identity.did} check={t.id as 'labels' | 'visibility'} />}
            </button>
          );
        })}
      </div>

      <div
        ref={panelRef}
        role="tabpanel"
        id="repo-tabpanel"
        aria-labelledby={`repo-tab-${tab}`}
        className="fx-tabpanel"
      >
        {tab === 'collections' && <CollectionsTab identity={identity} />}
        {tab === 'glance' && (
          <div className="fx-tabpanel-tool">
            <AccountStats did={identity.did} handle={identity.handle} />
          </div>
        )}
        {tab === 'labels' && (
          <div className="fx-tabpanel-tool">
            <LabelChecker subject={identity.did} />
          </div>
        )}
        {tab === 'visibility' && (
          <div className="fx-tabpanel-tool">
            <ShadowbanChecker subject={identity.did} />
          </div>
        )}
        {tab === 'identity' && <IdentityTab identity={identity} />}
        {tab === 'audit' && <AuditTab identity={identity} />}
        {tab === 'backlinks' && <BacklinksTab target={identity.did} />}
        {tab === 'graph' && <GraphTab key={identity.did} identity={identity} />}
        {tab === 'lists' && (
          <div className="fx-tabpanel-tool">
            <Memberships subject={identity.did} />
          </div>
        )}
        {tab === 'activity' && (
          <div className="fx-tabpanel-tool">
            <ActivityCalendar subject={identity.did} />
          </div>
        )}
      </div>
    </section>
  );
}
