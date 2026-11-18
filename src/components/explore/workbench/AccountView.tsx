'use client';

import { useEffect } from 'react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { DEFAULT_REPO_SECTIONS, sectionHidden } from '@/utils/exploreSections';
import { usePreferences } from '@/components/PreferencesProvider';
import AccountStats from '@/components/account/AccountStats';
import AppearIn from '../AppearIn';
import AccountToolLinks from '../AccountToolLinks';
import { AccountCard } from '../RepoExplorer';
import RelationshipStrip from '../RelationshipStrip';
import RepoStatusNotice from '../RepoStatusNotice';
import RepoSpacesSection from '../space/RepoSpacesSection';
import AuditTab from '../tabs/AuditTab';
import BacklinksTab from '../tabs/BacklinksTab';
import IdentityTab from '../tabs/IdentityTab';
import GraphTab from '../graph/GraphTab';
import { HostedBacklinks, type BacklinksHost } from './LinksView';

/** The account-level views, named as the repo page's `?tab=` names them. */
export const ACCOUNT_TABS = ['overview', 'identity', 'audit', 'backlinks', 'graph'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

/**
 * The views the rail lists. Identity and Log are each a short page on their
 * own, both read from the same DID document, so here they are sections of
 * the overview rather than tabs as in Classic. Their `?tab=` names still
 * work: they open the overview at their section.
 */
export const ACCOUNT_VIEWS = ['overview', 'backlinks', 'graph'] as const;
export type AccountViewId = (typeof ACCOUNT_VIEWS)[number];

export const ACCOUNT_VIEW_LABELS: Record<AccountViewId, string> = {
  overview: 'Overview',
  backlinks: 'Backlinks',
  graph: 'Graph',
};

export function accountViewOf(tab: AccountTab): AccountViewId {
  return tab === 'backlinks' || tab === 'graph' ? tab : 'overview';
}

const IDENTITY_ID = 'fx-wb-identity';
const LOG_ID = 'fx-wb-log';

/**
 * How many operations the overview's log shows before "Show all": it sits
 * beside the identity card, and some accounts have dozens.
 */
const LOG_PREVIEW = 5;

/**
 * What the main pane shows when no collection is open: the account itself.
 *
 * These are the repo page's own pieces, recomposed. The overview is the
 * glance stats over the identity document and its log, still honouring the
 * visitor's section choices; Backlinks and Graph are its tabs, each on the
 * sheet a folder tab opens. The collections tree, the repo page's other tab, is the rail beside
 * this pane, and so is the account card, wherever the rail is on screen to
 * show it. Where it isn't (a drawer, or hidden), `card` puts the card back
 * here, beside the glance, so the account is never out of sight or on
 * screen twice.
 */
export default function AccountView({
  identity,
  tab,
  card,
  backlinks,
}: {
  identity: IdentityBundle;
  tab: AccountTab;
  /** Show the account card here, because the rail can't. */
  card: boolean;
  /**
   * How the shell hosts the Backlinks view: the open relationship in the
   * address, and a linking record opened beside the list (LinksView.tsx).
   */
  backlinks?: BacklinksHost;
}) {
  const { prefs, loading } = usePreferences();
  const sections = loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections;
  const view = accountViewOf(tab);

  // `?tab=identity` and `?tab=audit`, from Classic or an old link, name a
  // section of the overview: bring it into view.
  const target = tab === 'identity' ? IDENTITY_ID : tab === 'audit' ? LOG_ID : null;
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [target]);

  return (
    <div className="fx-wb-page">
      {/* `fx-main` for the repo page's own rules about what sits in its main
          column (the stats grid's tracks, the tree's spacing). */}
      <div className="fx-wb-page-inner fx-main" data-tab={view}>
        {identity.repoStatus && <RepoStatusNotice identity={identity} />}

        {view === 'overview' && (
          <div className="fx-wb-overview" data-card={card || undefined}>
            {card && (
              <div className="fx-wb-overview-side">
                {!sectionHidden(sections, 'relationship') && <RelationshipStrip target={identity} />}
                <AppearIn>
                  <AccountCard
                    identity={identity}
                    profileHidden={sectionHidden(sections, 'profile')}
                    identityHidden={sectionHidden(sections, 'identity')}
                  />
                </AppearIn>
              </div>
            )}
            <div className="fx-wb-overview-main">
              {!sectionHidden(sections, 'repoGlance') && (
                <AppearIn delay={0.06}>
                  <section className="fx-wb-section">
                    <h1 className="fx-wb-h">Repo at a glance</h1>
                    <AccountStats did={identity.did} handle={identity.handle} />
                    <AccountToolLinks did={identity.did} />
                  </section>
                </AppearIn>
              )}
              <AppearIn delay={0.1}>
                <div className="fx-wb-idgrid">
                  <section
                    id={IDENTITY_ID}
                    className="fx-tabpanel fx-wb-idcard"
                    aria-labelledby={`${IDENTITY_ID}-h`}
                  >
                    <h2 id={`${IDENTITY_ID}-h`} className="fx-wb-h">
                      Identity
                    </h2>
                    <IdentityTab identity={identity} />
                  </section>
                  <section id={LOG_ID} className="fx-tabpanel fx-wb-idcard" aria-labelledby={`${LOG_ID}-h`}>
                    <h2 id={`${LOG_ID}-h`} className="fx-wb-h">
                      Log
                    </h2>
                    <AuditTab identity={identity} limit={LOG_PREVIEW} />
                  </section>
                </div>
              </AppearIn>
              {/* Permissioned data, only for the account itself. */}
              <RepoSpacesSection identity={identity} />
            </div>
          </div>
        )}

        {view === 'backlinks' && (
          <AppearIn key={view}>
            <section className="fx-wb-section">
              <h1 className="fx-wb-h">{ACCOUNT_VIEW_LABELS.backlinks}</h1>
              <div className="fx-tabpanel">
                {backlinks ? (
                  <HostedBacklinks target={identity.did} host={backlinks} />
                ) : (
                  <BacklinksTab target={identity.did} />
                )}
              </div>
            </section>
          </AppearIn>
        )}

        {view === 'graph' && (
          <AppearIn key={view}>
            <section className="fx-wb-section">
              <h1 className="fx-wb-h">{ACCOUNT_VIEW_LABELS.graph}</h1>
              <div className="fx-tabpanel">
                <GraphTab key={identity.did} identity={identity} />
              </div>
            </section>
          </AppearIn>
        )}
      </div>
    </div>
  );
}
