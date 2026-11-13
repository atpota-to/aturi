'use client';

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
import { HostedBacklinks, type BacklinksHost } from './LinksView';

/** The account-level views, named as the repo page's `?tab=` names them. */
export const ACCOUNT_TABS = ['overview', 'identity', 'audit', 'backlinks'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export const ACCOUNT_TAB_LABELS: Record<AccountTab, string> = {
  overview: 'Overview',
  identity: 'Identity',
  audit: 'Log',
  backlinks: 'Backlinks',
};

/**
 * What the main pane shows when no collection is open: the account itself.
 *
 * These are the repo page's own pieces, recomposed. Overview is its sidebar
 * and glance stats (the account card, the relationship strip, the spaces
 * section), still honouring the visitor's section choices; Identity, Log and
 * Backlinks are its tabs, each on the sheet a folder tab opens. The
 * collections tree, the fourth of those tabs, is the rail beside this pane.
 */
export default function AccountView({
  identity,
  tab,
  backlinks,
}: {
  identity: IdentityBundle;
  tab: AccountTab;
  /**
   * How the shell hosts the Backlinks view: the open relationship in the
   * address, and a linking record opened beside the list (LinksView.tsx).
   */
  backlinks?: BacklinksHost;
}) {
  const { prefs, loading } = usePreferences();
  const sections = loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections;

  return (
    <div className="fx-wb-page">
      {/* `fx-main` for the repo page's own rules about what sits in its main
          column (the stats grid's tracks, the tree's spacing). */}
      <div className="fx-wb-page-inner fx-main" data-tab={tab}>
        {identity.repoStatus && <RepoStatusNotice identity={identity} />}

        {tab === 'overview' && (
          <div className="fx-wb-overview">
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
              {/* Permissioned data, only for the account itself. */}
              <RepoSpacesSection identity={identity} />
            </div>
          </div>
        )}

        {tab !== 'overview' && (
          <AppearIn key={tab}>
            <section className="fx-wb-section">
              <h1 className="fx-wb-h">{ACCOUNT_TAB_LABELS[tab]}</h1>
              <div className="fx-tabpanel">
                {tab === 'identity' && <IdentityTab identity={identity} />}
                {tab === 'audit' && <AuditTab identity={identity} />}
                {tab === 'backlinks' &&
                  (backlinks ? (
                    <HostedBacklinks target={identity.did} host={backlinks} />
                  ) : (
                    <BacklinksTab target={identity.did} />
                  ))}
              </div>
            </section>
          </AppearIn>
        )}
      </div>
    </div>
  );
}
