'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Copy, FolderOpen, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { statusMeaning } from '@/lib/pdsExplorer';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { formatCount } from '@/utils/ufos/format';
import AppearIn from '../AppearIn';
import CopyButton from '../CopyButton';
import { SkeletonBar } from '../skeletons/primitives';
import LexiconFavicon from '../tabs/LexiconFavicon';
import { namespaceOf } from '../workbench/FilesBrowser';
import { AccountAvatar, CommitTime, StatusMark } from './parts';
import { nameOf, useDescribedRepo, useFullProfile, useHostHandle, useNamesVersion, type AccountRow } from './usePdsData';

/**
 * One account on the host, in the inspector beside the list: who it is,
 * what the host holds of it, and what it has written, with the way into its
 * repository. The frame is the record inspector's (RecordPane): the name and
 * the stepping controls in the head, the actions under it, and a body that
 * scrolls. Given the full width, who it is sits beside what it has written.
 */
export default function AccountPane({
  base,
  did,
  row,
  controls,
  wide,
}: {
  base: string;
  did: string;
  /** The account as the host listed it; null when it isn't among what's been listed. */
  row: AccountRow | null;
  controls: ReactNode;
  wide: boolean;
}) {
  useNamesVersion();
  const name = nameOf(did);
  const described = useDescribedRepo(base, did);
  const handle = name?.handle ?? described.data?.handle ?? null;
  useHostHandle(base, did, name !== undefined && !name.handle);
  const label = handle ? `@${handle}` : shortDid(did);
  const repoPath = `/explore/${encodeRepo(handle || did)}`;

  const actions = (
    <div className="fn-rec-actions">
      <Link
        href={repoPath}
        prefetch={false}
        rel="nofollow"
        className="fn-rec-btn"
        data-variant="primary"
        aria-label="Open this account’s repository"
        title="Its collections and records, in the explorer"
      >
        <FolderOpen size={14} aria-hidden />
        Open repo
      </Link>
      <CopyDid did={did} />
      {/* The universal profile link: whichever app the visitor prefers. */}
      <Link
        href={`/profile/${encodeURIComponent(handle || did)}`}
        prefetch={false}
        rel="nofollow"
        className="fn-rec-btn"
        aria-label="Open the profile in an app"
        title="Open the profile in the app of your choice"
      >
        <UserRound size={14} aria-hidden />
        Profile
      </Link>
    </div>
  );

  const who = <Who did={did} handle={handle} />;
  const holds = <Holds did={did} row={row} handle={handle} described={described} />;
  const collections = <Collections repoPath={repoPath} described={described} row={row} />;

  return (
    <div className="fn-rec fx-wb-rec fx-pd-insp" data-wide={wide || undefined}>
      <div className="fx-wb-insp-head">
        <AccountAvatar avatar={name?.avatar ?? null} label={label} size={24} />
        <h2 className="fx-wb-insp-rkey fx-pd-insp-name" title={handle ? `${label} · ${did}` : did}>
          {label}
        </h2>
        {row && <StatusMark standing={row.standing} />}
        {wide && actions}
        <div className="fx-wb-insp-ctl">{controls}</div>
      </div>
      {!wide && <div className="fx-wb-insp-bar">{actions}</div>}
      <div className="fx-wb-insp-body">
        <AppearIn key={did}>
          {wide ? (
            <div className="fx-lx-wide">
              <div className="fx-lx-wide-col">
                {who}
                {holds}
              </div>
              <div className="fx-lx-wide-col">{collections}</div>
            </div>
          ) : (
            <div className="fx-lx-overview">
              {who}
              {holds}
              {collections}
            </div>
          )}
        </AppearIn>
      </div>
    </div>
  );
}

function CopyDid({ did }: { did: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="fn-rec-btn"
      data-copied={copied || undefined}
      aria-label={copied ? 'DID copied' : 'Copy DID'}
      title="Copy the DID"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(did);
        } catch {
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Copied' : 'Copy DID'}
    </button>
  );
}

/** Who the account is, from its AppView profile. */
function Who({ did, handle }: { did: string; handle: string | null }) {
  const profile = useFullProfile(did);
  if (profile.data === undefined && !profile.error) {
    return (
      <div className="fx-pd-profile" aria-hidden>
        <SkeletonBar width="11rem" height="1.1rem" />
        <SkeletonBar width="90%" height="0.65rem" />
        <SkeletonBar width="70%" height="0.65rem" />
      </div>
    );
  }
  const p = profile.data;
  if (!p) {
    return (
      <p className="fx-pd-note">
        No Bluesky profile. The account may be inactive or use other apps.
      </p>
    );
  }
  const joined = p.createdAt ? new Date(p.createdAt) : null;
  return (
    <div className="fx-pd-profile">
      {p.displayName?.trim() && <h3 className="fx-pd-profile-name">{p.displayName.trim()}</h3>}
      {handle && <span className="fx-pd-profile-handle">@{handle}</span>}
      {p.description?.trim() && <p className="fx-pd-profile-bio">{p.description.trim()}</p>}
      <p className="fx-pd-profile-counts">
        {typeof p.followersCount === 'number' && (
          <span>
            <strong>{formatCount(p.followersCount)}</strong> followers
          </span>
        )}
        {typeof p.followsCount === 'number' && (
          <span>
            <strong>{formatCount(p.followsCount)}</strong> following
          </span>
        )}
        {typeof p.postsCount === 'number' && (
          <span>
            <strong>{formatCount(p.postsCount)}</strong> posts
          </span>
        )}
        {joined && !Number.isNaN(joined.getTime()) && (
          <span title={joined.toISOString()}>joined {joined.toISOString().slice(0, 10)}</span>
        )}
      </p>
    </div>
  );
}

/** What the host holds of the account: its identity and its repository's head. */
function Holds({
  did,
  row,
  handle,
  described,
}: {
  did: string;
  row: AccountRow | null;
  handle: string | null;
  described: ReturnType<typeof useDescribedRepo>;
}) {
  const checked = described.data?.handleIsCorrect;
  return (
    <section className="fx-lx-card" aria-label="On this host">
      <h3 className="fx-lx-h">On this host</h3>
      <dl className="fx-pd-facts">
        <div>
          <dt>DID</dt>
          <dd>
            <code>{did}</code>
            <CopyButton value={did} label="Copy DID" compact variant="subtle" iconOnly />
          </dd>
        </div>
        <div>
          <dt>Handle</dt>
          <dd>
            {handle ? (
              <span className="fx-pd-handle-check">
                <code>@{handle}</code>
                {checked === true && (
                  <span className="fx-pd-check" data-tone="good" title="The handle and the DID point at each other">
                    <ShieldCheck size={13} aria-hidden /> checks out
                  </span>
                )}
                {checked === false && (
                  <span className="fx-pd-check" data-tone="bad" title="The handle doesn’t point back at this DID">
                    <ShieldAlert size={13} aria-hidden /> doesn’t check out
                  </span>
                )}
              </span>
            ) : (
              <span className="fx-pd-fact-text">None known</span>
            )}
          </dd>
        </div>
        {row ? (
          <>
            <div>
              <dt>Status</dt>
              <dd>
                <span className="fx-pd-fact-text">
                  <StatusMark standing={row.standing} /> {statusMeaning(row.standing)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Last commit</dt>
              <dd>
                <CommitTime date={row.date} rev={row.rev} />
                {row.date && <span className="fx-pd-fact-quiet">{row.date.toISOString().replace('T', ' ').slice(0, 16)} UTC</span>}
              </dd>
            </div>
            <div>
              <dt>Listed</dt>
              <dd>
                <span className="fx-pd-fact-text" title="Its place in the order the host lists accounts">
                  #{(row.index + 1).toLocaleString()}
                </span>
              </dd>
            </div>
            {row.rev && (
              <div>
                <dt>Revision</dt>
                <dd>
                  <code>{row.rev}</code>
                </dd>
              </div>
            )}
            {row.head && (
              <div>
                <dt>Head commit</dt>
                <dd>
                  <code className="fx-pd-cid" title={row.head}>
                    {row.head}
                  </code>
                  <CopyButton value={row.head} label="Copy CID" compact variant="subtle" iconOnly />
                </dd>
              </div>
            )}
          </>
        ) : (
          <div>
            <dt>Status</dt>
            <dd>
              <span className="fx-pd-fact-text">Not among the accounts listed so far.</span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** What it has written: its collections, by namespace, each a way into the repository. */
function Collections({
  repoPath,
  described,
  row,
}: {
  repoPath: string;
  described: ReturnType<typeof useDescribedRepo>;
  row: AccountRow | null;
}) {
  const groups = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const nsid of [...(described.data?.collections ?? [])].sort()) {
      const ns = namespaceOf(nsid);
      const list = out.get(ns);
      if (list) list.push(nsid);
      else out.set(ns, [nsid]);
    }
    return Array.from(out.entries());
  }, [described.data]);
  const count = described.data?.collections.length ?? 0;

  return (
    <section className="fx-lx-card" aria-label="Collections">
      <h3 className="fx-lx-h">
        Collections
        {described.data && (
          <span className="fx-lx-h-count">
            {count} in {groups.length} {groups.length === 1 ? 'namespace' : 'namespaces'}
          </span>
        )}
      </h3>
      {described.error ? (
        <p className="fx-pd-note" title={described.error}>
          {row && row.standing !== 'active'
            ? 'The host won’t describe an inactive repo, so its collections can’t be listed.'
            : 'The host didn’t describe this repo.'}
        </p>
      ) : !described.data ? (
        <div className="fx-pd-colls" aria-hidden>
          {['8rem', '11rem', '9rem', '7rem'].map((w, i) => (
            <SkeletonBar key={i} width={w} height="0.65rem" />
          ))}
        </div>
      ) : count === 0 ? (
        <p className="fx-pd-note">Nothing written yet.</p>
      ) : (
        <ul className="fx-pd-colls">
          {groups.map(([ns, nsids]) => (
            <li key={ns}>
              <span className="fx-pd-coll-ns">
                <LexiconFavicon prefix={ns} />
                <code>{ns}</code>
              </span>
              <ul>
                {nsids.map((nsid) => (
                  <li key={nsid}>
                    <Link href={`${repoPath}/${nsid}`} prefetch={false} rel="nofollow" title={nsid}>
                      {nsid.slice(ns.length + 1) || nsid}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
