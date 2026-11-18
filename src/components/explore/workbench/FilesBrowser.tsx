'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Link2, Search, Server, Star } from 'lucide-react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { appDomainFor } from '@/utils/ufos/nsid';
import { isPinGroup, pinGroupPrefix } from '@/utils/preferences';
import { usePreferences } from '@/components/PreferencesProvider';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { Nsid } from '../lexicons/primitives';
import { SkeletonBar } from '../skeletons/primitives';
import { FileGlyph, FolderGlyph, fileKindOf } from './FileIcons';
import type { FilesLayout } from '@/lib/explorerView';

/**
 * The Files view's folders. A repository has no folders of its own: a
 * collection is named by an NSID, and the tree every explorer draws comes
 * from reading those names as paths. Here the first two segments (the
 * namespace, `app.bsky`) are one folder and each collection under it is
 * another, so the path to a record reads
 *
 *   @handle  ›  app.bsky  ›  feed.post  ›  3mv3poapk7c2d
 *
 * with the record the file and its lexicon the file's kind.
 */

/** `app.bsky.feed.post` -> `app.bsky`. A one-segment name is its own namespace. */
export function namespaceOf(nsid: string): string {
  const segs = nsid.split('.');
  return segs.length >= 2 ? `${segs[0]}.${segs[1]}` : nsid;
}

/** The repo's collections, bucketed by namespace, both sorted. */
export function useNamespaces(collections: Set<string> | null) {
  return useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const nsid of collections ?? []) {
      const ns = namespaceOf(nsid);
      const list = buckets.get(ns);
      if (list) list.push(nsid);
      else buckets.set(ns, [nsid]);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ns, items]) => ({ ns, items: items.sort() }));
  }, [collections]);
}

type Namespaces = ReturnType<typeof useNamespaces>;

const nsHref = (base: string, ns: string) => `${base}?ns=${encodeURIComponent(ns)}`;

/**
 * The sidebar's folder lists: the visitor's pinned lexicons that this repo
 * has, as favourites, and every namespace. The account's own views sit above
 * these, drawn by the shell for both layouts.
 */
export function FilesSidebar({
  base,
  namespaces,
  collections,
  ns,
  collection,
}: {
  base: string;
  namespaces: Namespaces;
  collections: Set<string> | null;
  /** The namespace folder that's open, if one is. */
  ns: string | null;
  collection: string | null;
}) {
  const { prefs } = usePreferences();
  const openNs = collection ? namespaceOf(collection) : ns;

  // Pinned lexicons this repo actually has. A pinned group (`app.bsky.*`)
  // is a favourite folder when the repo has anything under it.
  const favourites = useMemo(() => {
    if (!collections) return [];
    const seen = new Set<string>();
    const out: { key: string; label: string; href: string; prefix: string; current: boolean }[] = [];
    for (const entry of prefs.pinnedLexicons) {
      if (isPinGroup(entry)) {
        const prefix = pinGroupPrefix(entry);
        const folder = namespaceOf(prefix);
        if (seen.has(folder)) continue;
        if (!Array.from(collections).some((c) => c.startsWith(`${prefix}.`))) continue;
        seen.add(folder);
        out.push({
          key: entry,
          label: folder,
          href: nsHref(base, folder),
          prefix: folder,
          current: !collection && ns === folder,
        });
      } else if (collections.has(entry) && !seen.has(entry)) {
        seen.add(entry);
        out.push({
          key: entry,
          label: entry,
          href: `${base}/${entry}`,
          prefix: namespaceOf(entry),
          current: collection === entry,
        });
      }
    }
    return out;
  }, [prefs.pinnedLexicons, collections, base, ns, collection]);

  return (
    <div className="fx-fd-side">
      {favourites.length > 0 && (
        <section aria-label="Favourites">
          <h2 className="fx-wb-label">
            <Star size={11} aria-hidden /> Favourites
          </h2>
          <ul className="fx-fd-places">
            {favourites.map((f) => (
              <li key={f.key}>
                <Link
                  href={f.href}
                  prefetch={false}
                  rel="nofollow"
                  className="fx-fd-place"
                  aria-current={f.current ? 'page' : undefined}
                  title={f.label}
                >
                  <FolderGlyph prefix={f.prefix} />
                  <span className="fx-fd-place-name">{f.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Namespaces">
        <h2 className="fx-wb-label">Namespaces</h2>
        {collections === null ? (
          <div className="fx-fd-places" aria-hidden>
            {['7rem', '9rem', '6rem', '8rem'].map((w, i) => (
              <span key={i} className="fx-fd-place" data-skeleton>
                <SkeletonBar width={w} />
              </span>
            ))}
          </div>
        ) : namespaces.length === 0 ? (
          <p className="fx-wb-note">No collections on this repo.</p>
        ) : (
          <ul className="fx-fd-places">
            {namespaces.map(({ ns: name, items }) => (
              <li key={name}>
                <Link
                  href={nsHref(base, name)}
                  prefetch={false}
                  rel="nofollow"
                  className="fx-fd-place"
                  // Open, or on the way to the open collection.
                  aria-current={openNs === name ? (collection ? 'true' : 'page') : undefined}
                >
                  <FolderGlyph prefix={name} />
                  <span className="fx-fd-place-name">{name}</span>
                  <span className="fx-fd-place-count">{items.length}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * A folder's contents, when the folder holds folders: the repo's namespaces
 * at the top, or one namespace's collections. A collection's records are
 * <CollectionPane>'s to draw, in the same frame.
 */
export function FolderBrowser({
  identity,
  base,
  namespaces,
  loading,
  ns,
  layout,
}: {
  identity: IdentityBundle;
  base: string;
  namespaces: Namespaces;
  loading: boolean;
  ns: string | null;
  layout: FilesLayout;
}) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();

  const open = ns ? namespaces.find((n) => n.ns === ns) ?? null : null;
  const items = useMemo(() => {
    const all = open
      ? open.items.map((nsid) => ({
          key: nsid,
          name: nsid.slice(open.ns.length + 1) || nsid,
          title: nsid,
          href: `${base}/${nsid}`,
          kind: 'Collection',
          detail: `${fileKindOf(nsid)} records`,
          prefix: undefined as string | undefined,
        }))
      : namespaces.map(({ ns: name, items: inside }) => ({
          key: name,
          name,
          title: `${name}.*`,
          href: nsHref(base, name),
          kind: 'Namespace',
          detail: `${inside.length} collection${inside.length === 1 ? '' : 's'}`,
          prefix: name as string | undefined,
        }));
    return query ? all.filter((item) => item.title.toLowerCase().includes(query)) : all;
  }, [open, namespaces, base, query]);
  const total = open ? open.items.length : namespaces.length;
  const noun = open ? 'collection' : 'namespace';

  useChromeBarField({
    placeholder: open ? 'Filter collections…' : 'Filter namespaces…',
    label: open ? 'Filter the collections in this namespace' : 'Filter this repo’s namespaces',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    inPage: true,
    status: loading ? null : query ? `${items.length}/${total}` : `${total}`,
  });

  const appDomain = open ? appDomainFor(open.ns) : null;
  const missing = Boolean(ns) && !loading && !open;

  return (
    <div className="fx-wb-pane" data-display={layout === 'icons' ? 'icons' : 'rows'}>
      {/* The breadcrumb names the repo but not a namespace (the address has
          no such segment), so only the root's title repeats it; on a phone
          that head, which holds nothing else, steps aside. */}
      <div className="fx-wb-pane-head" data-crumbed={ns ? undefined : 'only'}>
        <div className="fx-titlebar">
          <div className="fx-title-row">
            <h1 className="fx-h1">
              {ns ? `${ns}.*` : identity.handle ? `@${identity.handle}` : identity.did}
            </h1>
            {appDomain && (
              <span className="fx-pill" title="The domain this namespace reverses to">
                {appDomain}
              </span>
            )}
          </div>
        </div>
      </div>
      <section aria-label="Folders" className="fx-records fx-wb-records" id={CHROME_RESULTS_ID}>
        <div className="fx-records-tools">
          <label className="fx-field">
            <Search size={14} aria-hidden />
            <span className="fx-sr">{open ? 'Filter collections' : 'Filter namespaces'}</span>
            <input
              type="text"
              placeholder={open ? 'Filter collections' : 'Filter namespaces'}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filter) {
                  e.preventDefault();
                  setFilter('');
                }
              }}
            />
          </label>
          <span className="fx-records-tools-meta" aria-live="polite">
            {loading
              ? 'Loading…'
              : query
                ? `${items.length} of ${total}`
                : `${total} ${noun}${total === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="fx-wb-scroll">
          {missing && (
            <p className="fx-records-msg">
              This repo has nothing under <code>{ns}</code>.
            </p>
          )}
          {!missing && !loading && items.length === 0 && (
            <p className="fx-records-msg">
              {query ? (
                <>
                  Nothing here matches <code>{filter.trim()}</code>.
                </>
              ) : (
                'No collections on this repo.'
              )}
            </p>
          )}
          {loading ? (
            <ul className="fx-fd-grid" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="fx-fd-item">
                  <span className="fx-fd-tile" data-skeleton>
                    <SkeletonBar width="64px" height="52px" shape="block" />
                    <SkeletonBar width="5.5rem" />
                  </span>
                </li>
              ))}
            </ul>
          ) : layout === 'icons' ? (
            items.length > 0 && (
              <ul className="fx-fd-grid">
                {items.map((item) => (
                  <li key={item.key} className="fx-fd-item">
                    <Link
                      href={item.href}
                      prefetch={false}
                      rel="nofollow"
                      className="fx-fd-tile"
                      title={item.title}
                    >
                      <FolderGlyph prefix={item.prefix} />
                      <code className="fx-fd-name">
                        <Nsid value={item.name} />
                      </code>
                      <span className="fx-fd-meta">{item.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : (
            items.length > 0 && (
              // The record list's own grid, so folders and files line up as
              // one table from the top of the repo to a record.
              <ul className="fx-rec-list">
                <li className="fx-rec-head" aria-hidden>
                  <span>Name</span>
                  <span>Kind</span>
                  <span>Contains</span>
                </li>
                {items.map((item) => (
                  <li key={item.key} className="fx-rec-item">
                    <Link
                      href={item.href}
                      prefetch={false}
                      rel="nofollow"
                      className="fx-rec-row"
                      title={item.title}
                    >
                      <span className="fx-fd-cell">
                        <FolderGlyph prefix={item.prefix} />
                        <code className="fx-rec-key">{item.name}</code>
                      </span>
                      <span className="fx-rec-text">{item.kind}</span>
                      <span className="fx-rec-time">{item.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Where you are, as a file browser's path bar: every folder on the way from
 * the PDS to what's open, each one a way back to it. The breadcrumb above
 * the panes names the same place; this adds the namespace folder, which the
 * address itself doesn't have.
 */
export function PathBar({
  identity,
  base,
  ns,
  collection,
  rkey,
  links,
}: {
  identity: IdentityBundle;
  base: string;
  ns: string | null;
  collection: string | null;
  rkey: string | null;
  /**
   * Set while the pane lists what links to the account or the open record:
   * the path then runs on into "Backlinks" and the relationship that's
   * open, as two more folders. `relation` is its name, when the address
   * gives one.
   */
  links?: { relation: string | null } | null;
}) {
  const folder = collection ? namespaceOf(collection) : ns;
  const pdsHost = pdsHostname(identity.pds);
  const sep = <ChevronRight size={12} aria-hidden className="fx-fd-path-sep" />;

  // The bar is one line and scrolls sideways when the path outgrows it;
  // where you are is its last item, so keep that end in view.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (bar) bar.scrollLeft = bar.scrollWidth;
  }, [folder, collection, rkey, links?.relation]);

  return (
    <nav ref={barRef} aria-label="Path" className="fx-fd-path">
      <Link href={`/explore/pds/${encodeURIComponent(pdsHost)}`} prefetch={false} className="fx-fd-crumb">
        <Server size={12} aria-hidden />
        {pdsHost}
      </Link>
      {sep}
      <Link
        href={base}
        prefetch={false}
        className="fx-fd-crumb"
        aria-current={!folder && !collection && !links ? 'page' : undefined}
      >
        <FolderGlyph />
        {identity.handle ? `@${identity.handle}` : identity.did}
      </Link>
      {folder && (
        <>
          {sep}
          <Link
            href={nsHref(base, folder)}
            prefetch={false}
            rel="nofollow"
            className="fx-fd-crumb"
            aria-current={!collection ? 'page' : undefined}
          >
            <FolderGlyph prefix={folder} />
            {folder}
          </Link>
        </>
      )}
      {collection && (
        <>
          {sep}
          <Link
            href={`${base}/${collection}`}
            prefetch={false}
            rel="nofollow"
            className="fx-fd-crumb"
            aria-current={!rkey ? 'page' : undefined}
          >
            <FolderGlyph />
            {collection.slice((folder ?? '').length + 1) || collection}
          </Link>
        </>
      )}
      {collection && rkey && (
        <>
          {sep}
          {links ? (
            <Link
              href={`${base}/${collection}/${encodeURIComponent(rkey)}`}
              prefetch={false}
              rel="nofollow"
              className="fx-fd-crumb"
            >
              <FileGlyph kind="" />
              {rkey}
            </Link>
          ) : (
            <span className="fx-fd-crumb" aria-current="page">
              <FileGlyph kind="" />
              {rkey}
            </span>
          )}
        </>
      )}
      {links && (
        <>
          {sep}
          <span className="fx-fd-crumb" aria-current={links.relation ? undefined : 'page'}>
            <Link2 size={12} aria-hidden />
            Backlinks
          </span>
          {links.relation && (
            <>
              {sep}
              <span className="fx-fd-crumb" aria-current="page">
                <FolderGlyph />
                {links.relation}
              </span>
            </>
          )}
        </>
      )}
    </nav>
  );
}
