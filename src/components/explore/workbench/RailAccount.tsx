'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { shortDid } from '@/utils/atproto/urls';
import { DEFAULT_REPO_SECTIONS, sectionHidden } from '@/utils/exploreSections';
import { usePreferences } from '@/components/PreferencesProvider';
import CopyButton from '../CopyButton';
import RelationshipStrip from '../RelationshipStrip';
import { AccountCard } from '../RepoExplorer';

/**
 * The account, at the head of the rail. Where the rail is a column on screen
 * (`card`), this is the account card itself, the one the classic page keeps
 * in its sidebar: the profile, the identity rows, where to open the profile,
 * and how the visitor relates to the account. It folds to one line while a
 * collection or a folder is open (`browsing`), so the tree under it has the
 * room, and the visitor can fold or unfold it either way, a choice that
 * holds until they change it. As a drawer the rail keeps the line, and the
 * overview shows the card instead (AccountView).
 */
export default function RailAccount({
  identity,
  base,
  card,
  browsing,
  onDone,
  footer,
}: {
  identity: IdentityBundle;
  base: string;
  card: boolean;
  browsing: boolean;
  /** Closes the rail when it is a drawer; the button is hidden when it isn't. */
  onDone: () => void;
  /** Drawn under the unfolded card: Classic's switch for the rich preview. */
  footer?: ReactNode;
}) {
  const [profile, setProfile] = useState<AppViewProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    getProfile(identity.did).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [identity.did]);

  const { prefs, loading } = usePreferences();
  const sections = loading ? DEFAULT_REPO_SECTIONS : prefs.repoSections;
  const profileHidden = sectionHidden(sections, 'profile');
  const identityHidden = sectionHidden(sections, 'identity');

  // The card would say no more than the line when the visitor hid the
  // identity rows and there is no profile to show in their place.
  const hasProfile = Boolean(
    profile && (profile.displayName?.trim() || profile.description?.trim() || profile.avatar),
  );
  const foldable = card && !(identityHidden && (profileHidden || !hasProfile));
  const [foldChoice, setFoldChoice] = useState<boolean | null>(null);
  const folded = !foldable || (foldChoice ?? browsing);

  // Folding swaps one toggle for the other: keep the focus on it, but only
  // when the visitor pressed it, not when opening a collection folded it.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    toggleRef.current?.focus();
  }, [folded]);
  const toggle = () => {
    refocus.current = true;
    setFoldChoice(!folded);
  };

  if (!folded) {
    return (
      <div className="fx-wb-acct-card">
        <button
          ref={toggleRef}
          type="button"
          className="fx-wb-icon fx-wb-fold"
          onClick={toggle}
          aria-expanded
          aria-label="Fold the account card"
          title="Fold"
        >
          <ChevronUp size={16} aria-hidden />
        </button>
        <AccountCard identity={identity} profileHidden={profileHidden} identityHidden={identityHidden} />
        {!sectionHidden(sections, 'relationship') && (
          <div className="fx-wb-acct-strip">
            <RelationshipStrip target={identity} />
          </div>
        )}
        {footer && <div className="fx-wb-acct-foot">{footer}</div>}
      </div>
    );
  }

  const handle = identity.handle || profile?.handle || null;
  const name = profile?.displayName?.trim() || null;
  const title = name || (handle ? `@${handle}` : shortDid(identity.did));
  const initial = (name || handle || '?').replace(/^@/, '').charAt(0);

  return (
    <div className="fx-wb-acct">
      {profile?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar} alt="" width={36} height={36} className="fx-avatar" />
      ) : (
        <div aria-hidden className="fx-avatar">
          {initial}
        </div>
      )}
      <div className="fx-wb-acct-names">
        <Link href={base} prefetch={false} className="fx-wb-acct-name" title={title}>
          {title}
        </Link>
        {name && handle && <span className="fx-wb-acct-handle">@{handle}</span>}
      </div>
      <CopyButton value={identity.did} label="Copy DID" compact variant="subtle" iconOnly />
      {foldable && (
        <button
          ref={toggleRef}
          type="button"
          className="fx-wb-icon"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Unfold the account card"
          title="Unfold"
        >
          <ChevronDown size={16} aria-hidden />
        </button>
      )}
      <button type="button" className="fx-btn fx-btn-sm fx-wb-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
