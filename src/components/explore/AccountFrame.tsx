'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  CalendarDays,
  ChartColumn,
  ExternalLink,
  EyeOff,
  FolderTree,
  Fingerprint,
  History,
  Link2,
  Orbit,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { parseExplorerPath } from '@/lib/explorerView';
import { toolBySlug } from '@/lib/tools/catalog';
import { toolLinksForAccount } from '@/lib/tools/recordLinks';
import { DEFAULT_REPO_SECTIONS, sectionHidden } from '@/utils/exploreSections';
import { setSectionHidden } from '@/utils/preferences';
import { usePreferences } from '@/components/PreferencesProvider';
import { CheckNavBadge } from './AccountChecks';
import { useBreadcrumbTrail } from './BreadcrumbContext';
import { ProfileViewSwitch, REPO_TABS, REPO_TOOL_TABS, useRepoTabs, type RepoTabId } from './RepoExplorer';
import { SkeletonAccountCard, SkeletonBar, SkeletonTreePane } from './skeletons/primitives';
import CollectionsTab from './tabs/CollectionsTab';
import { STACKED_QUERY, useMediaQuery } from './useIsNarrow';
import { FrameContext, type FrameAccount } from './useRepoIdentity';
import RailAccount from './workbench/RailAccount';
import { useExplorerView } from './workbench/useExplorerView';

const VIEW_ICONS: Record<RepoTabId, LucideIcon> = {
  collections: FolderTree,
  glance: ChartColumn,
  labels: Tags,
  visibility: EyeOff,
  identity: Fingerprint,
  audit: History,
  backlinks: Link2,
  graph: Orbit,
  lists: BadgeCheck,
  activity: CalendarDays,
};

/** Tools in the rail that open their own page rather than a tab here. */
const LINKED_TOOLS: ReadonlySet<string> = new Set(['mutuals', 'car']);

type Level = 'repo' | 'collection' | 'record';

/**
 * What /explore/{repo}, its collections and their records are drawn inside:
 * the account's sidebar on the left and the page beside it.
 *
 * It is the route group's layout (app/explore/[repo]/(account)/layout.tsx),
 * so Next keeps it mounted while the visitor moves between those three
 * pages: the sidebar stays where it was, with its tree folded and scrolled
 * as it was left, and only the page beside it changes. PageTransition holds
 * its key across those moves for the same reason.
 *
 * Only the classic layout has the frame. The Workbench and Files views draw
 * a full-window shell of their own, rail included (ExplorerShell).
 */
export default function AccountFrame({ repo, children }: { repo: string; children: ReactNode }) {
  const view = useExplorerView();
  if (view !== 'classic') return <>{children}</>;
  return <ClassicFrame repo={repo}>{children}</ClassicFrame>;
}

function ClassicFrame({ repo, children }: { repo: string; children: ReactNode }) {
  const [account, setAccount] = useState<FrameAccount | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveIdentifier(repo)
      .then((identity) => {
        if (!cancelled) setAccount({ repo, identity, error: null });
      })
      .catch((err) => {
        if (!cancelled) setAccount({ repo, identity: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const value: FrameAccount = account && account.repo === repo ? account : { repo, identity: null, error: null };

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const at = parseExplorerPath(pathname);
  const here = at && at.repo === repo ? at : { repo, collection: null, rkey: null };
  const level: Level = here.collection && here.rkey ? 'record' : here.collection ? 'collection' : 'repo';
  const tabParam = searchParams.get('tab');
  const tab: RepoTabId =
    level === 'repo' && [...REPO_TABS, ...REPO_TOOL_TABS].some((t) => t.id === tabParam)
      ? (tabParam as RepoTabId)
      : 'collections';
  // "/explore/{repo}", spelled as the address bar has it.
  const base = (pathname ?? `/explore/${repo}`).split('/').slice(0, 3).join('/');
  // The tree is the way around the repository from anywhere but the repo
  // page's own Collections tab, which is the same tree at full size.
  const tree = !(level === 'repo' && tab === 'collections');
  // The condensed breadcrumb drops out of the site header once the page's
  // own has scrolled away; the sidebar moves down out from under it.
  const { scrolledPast } = useBreadcrumbTrail();
  // Stacked (below 960px) the page comes first, so the trail stays the top
  // of the screen, and on the repo page the account card is the page's own
  // (RepoView): the sidebar under the page leaves it out.
  const stacked = useMediaQuery(STACKED_QUERY);
  const railAccount = !(stacked && level === 'repo');

  // An account that didn't resolve has nothing for a sidebar; the page says
  // why on its own.
  if (value.error) return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;

  return (
    <FrameContext.Provider value={value}>
      <div className="fx-frame" data-level={level}>
        <aside
          className="fx-rail fx-side"
          aria-label="Account"
          data-tree={tree || undefined}
          data-crumbs={scrolledPast || undefined}
        >
          {value.identity ? (
            <AccountRail
              identity={value.identity}
              base={base}
              level={level}
              tab={tab}
              collection={here.collection}
              tree={tree}
              account={railAccount}
            />
          ) : (
            <RailSkeleton card={level === 'repo'} account={railAccount} tree={tree} />
          )}
        </aside>
        <div className="fx-frame-main">{children}</div>
      </div>
    </FrameContext.Provider>
  );
}

/**
 * The sidebar's contents, the same at every level: the account, its views
 * (the repo page's tabs, as links from anywhere in the repository), the
 * tools that read it, and the collections tree. The account is its full
 * card on the repo page and folds to a line inside a collection, where the
 * tree needs the room; the visitor can fold or unfold it either way.
 */
function AccountRail({
  identity,
  base,
  level,
  tab,
  collection,
  tree,
  account,
}: {
  identity: IdentityBundle;
  base: string;
  level: Level;
  tab: RepoTabId;
  collection: string | null;
  tree: boolean;
  /** Draw the account at the head; the stacked repo page has it already. */
  account: boolean;
}) {
  const { prefs, update, loading } = usePreferences();
  const sections = loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections;
  const profileHidden = sectionHidden(sections, 'profile');
  const tabs = useRepoTabs();
  const hrefFor = (id: RepoTabId) => (id === 'collections' ? base : `${base}?tab=${id}`);
  // Inside a collection or a record, Collections is where you are.
  const currentView: RepoTabId = level === 'repo' ? tab : 'collections';

  return (
    <>
      {account && (
        <RailAccount
          identity={identity}
          base={base}
          card
          browsing={level !== 'repo'}
          onDone={() => {}}
          footer={
            <ProfileViewSwitch
              minimal={profileHidden}
              onToggle={() => update((p) => setSectionHidden(p, 'repo', 'profile', !profileHidden))}
            />
          }
        />
      )}
      <nav aria-label="Account views" className="fx-wb-views fx-rail-views">
        {tabs.map((t) => {
          const Icon = VIEW_ICONS[t.id];
          return (
            <Link
              key={t.id}
              href={hrefFor(t.id)}
              prefetch={false}
              className="fx-wb-view"
              aria-current={currentView === t.id ? 'page' : undefined}
            >
              <Icon size={14} aria-hidden />
              {t.label}
              {(t.id === 'labels' || t.id === 'visibility') && (
                <CheckNavBadge did={identity.did} check={t.id} />
              )}
            </Link>
          );
        })}
      </nav>
      {/* The tools that read the whole account. Lists and Activity open as
          tabs of the repo page; the others have a page of their own (a
          download, a map of blocks), so they open it. */}
      <nav aria-labelledby="fx-rail-tools-h" className="fx-wb-views fx-wb-tools">
        <h2 id="fx-rail-tools-h" className="fx-wb-label">
          Tools
        </h2>
        {REPO_TOOL_TABS.map((t) => {
          const Icon = VIEW_ICONS[t.id];
          return (
            <Link
              key={t.id}
              href={hrefFor(t.id)}
              prefetch={false}
              className="fx-wb-view"
              aria-current={currentView === t.id ? 'page' : undefined}
            >
              <Icon size={14} aria-hidden />
              {t.label}
            </Link>
          );
        })}
        {toolLinksForAccount(identity.did)
          .filter((tool) => LINKED_TOOLS.has(tool.slug))
          .map((tool) => {
            const { Icon } = toolBySlug(tool.slug);
            return (
              // A static tool page, so this keeps its prefetch; nofollow
              // because it carries a DID.
              <Link key={tool.slug} href={tool.href} rel="nofollow" className="fx-wb-view" title={tool.title}>
                <Icon size={14} aria-hidden />
                {tool.label}
                <ExternalLink size={12} className="fx-wb-view-end" aria-hidden />
              </Link>
            );
          })}
      </nav>
      {tree && (
        <div className="fx-wb-tree">
          <h2 className="fx-wb-label">Collections</h2>
          <CollectionsTab identity={identity} variant="sidebar" current={collection ?? undefined} pinnable />
        </div>
      )}
    </>
  );
}

/** The sidebar before the account has resolved, in the sidebar's own rows. */
function RailSkeleton({ card, account, tree }: { card: boolean; account: boolean; tree: boolean }) {
  return (
    <>
      {!account ? null : card ? (
        <div className="fx-wb-acct-card" aria-hidden>
          <SkeletonAccountCard flat />
        </div>
      ) : (
        <div className="fx-wb-acct" aria-hidden>
          <SkeletonBar width="36px" height="36px" shape="circle" style={{ flex: 'none' }} />
          <div className="fx-wb-acct-names" style={{ gap: 7 }}>
            <SkeletonBar width="7rem" height="0.85rem" />
            <SkeletonBar width="5.5rem" height="0.6rem" />
          </div>
        </div>
      )}
      <div className="fx-wb-views fx-rail-views" aria-hidden>
        {['5.5rem', '2.5rem', '3rem', '4rem', '3.75rem', '2rem', '4.5rem', '3rem'].map((width, i) => (
          <span key={i} className="fx-wb-view" data-skeleton>
            <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
            <SkeletonBar width={width} height="0.6rem" />
          </span>
        ))}
      </div>
      <div className="fx-wb-views fx-wb-tools" aria-hidden>
        <h2 className="fx-wb-label">Tools</h2>
        {['9rem', '7rem', '6.5rem', '6rem'].map((width, i) => (
          <span key={i} className="fx-wb-view" data-skeleton>
            <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
            <SkeletonBar width={width} height="0.6rem" />
          </span>
        ))}
      </div>
      {tree && (
        <div className="fx-wb-tree" aria-hidden>
          <h2 className="fx-wb-label">Collections</h2>
          <SkeletonTreePane rows={10} sidebar />
        </div>
      )}
    </>
  );
}
