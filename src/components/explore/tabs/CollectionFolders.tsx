'use client';

import { useMemo, type MouseEvent } from 'react';
import Link from 'next/link';
import type { IdentityBundle } from '@/utils/atproto/identity';
import {
  COLLECTIONS_DISPLAYS,
  setCollectionsDisplay,
  type CollectionsDisplay,
} from '@/lib/explorerView';
import { Nsid, Segmented } from '../lexicons/primitives';
import { FolderGlyph, fileKindOf } from '../workbench/FileIcons';
import { PathBar, namespaceOf } from '../workbench/FilesBrowser';
import { useCollectionsDisplay } from '../workbench/useExplorerView';

const DISPLAY_LABELS: Record<CollectionsDisplay, string> = { list: 'List', files: 'Files' };
const DISPLAY_OPTIONS = COLLECTIONS_DISPLAYS.map((value) => ({ value, label: DISPLAY_LABELS[value] }));

/**
 * List or Files: how Classic draws the repository's collections, and with
 * them a collection's records (src/lib/explorerView.ts). On the repo page's
 * Collections tab and above a collection's records, so either place can
 * change it.
 */
export function CollectionsDisplaySwitch() {
  const display = useCollectionsDisplay();
  return (
    <Segmented
      ariaLabel="Show collections as"
      options={DISPLAY_OPTIONS}
      value={display}
      onChange={setCollectionsDisplay}
    />
  );
}

/**
 * Moving between folders rewrites the address rather than navigating: the
 * folder is only `?ns=` on the repo page, so the page, its tabs and the
 * filter all stay as they are, Back steps out of the folder, and no server
 * render is spent on it. A link anywhere else (a collection, the PDS) is a
 * normal navigation.
 */
function openFolderInPlace(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
  event.preventDefault();
  if (`${url.pathname}${url.search}` !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
  }
}

type Folder = {
  key: string;
  name: string;
  title: string;
  href: string;
  detail: string;
  /** A namespace's prefix, for its app's mark on the folder. */
  prefix?: string;
};

/**
 * The Collections tab as a file browser, the Files view's folders on the
 * classic page: the repository's namespaces (`app.bsky`) as folders, a
 * namespace's collections as folders inside it, and a collection opening on
 * its own page with its records as files. A repository has no folders of
 * its own; these read the collections' names as paths (FilesBrowser.tsx).
 *
 * The tab's filter narrows what's shown. At the top, a filter looks through
 * every collection rather than the namespace names, so typing `post` finds
 * the collections called that wherever they are.
 */
export default function CollectionFolders({
  identity,
  base,
  collections,
  filter,
  ns,
}: {
  identity: IdentityBundle;
  /** "/explore/{repo}", spelled as the address bar has it. */
  base: string;
  /** The collections to draw, after the tab's "in common" filter. */
  collections: readonly string[];
  filter: string;
  /** The open namespace folder (`?ns=`), or the top. */
  ns: string | null;
}) {
  const query = filter.trim().toLowerCase();

  const namespaces = useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const nsid of collections) {
      const name = namespaceOf(nsid);
      const list = buckets.get(name);
      if (list) list.push(nsid);
      else buckets.set(name, [nsid]);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({ ns: name, items: items.sort() }));
  }, [collections]);

  const open = ns ? namespaces.find((n) => n.ns === ns) ?? null : null;

  const folders = useMemo<Folder[]>(() => {
    const collectionFolder = (nsid: string, under: string | null): Folder => ({
      key: nsid,
      name: under ? nsid.slice(under.length + 1) || nsid : nsid,
      title: nsid,
      href: `${base}/${nsid}`,
      detail: `${fileKindOf(nsid)} records`,
    });
    const matches = (nsid: string) => !query || nsid.toLowerCase().includes(query);
    if (open) return open.items.filter(matches).map((nsid) => collectionFolder(nsid, open.ns));
    if (query) return collections.filter(matches).map((nsid) => collectionFolder(nsid, null));
    return namespaces.map(({ ns: name, items }) => ({
      key: name,
      name,
      title: `${name}.*`,
      href: `${base}?ns=${encodeURIComponent(name)}`,
      detail: `${items.length} collection${items.length === 1 ? '' : 's'}`,
      prefix: name,
    }));
  }, [open, query, collections, namespaces, base]);

  return (
    <div className="fx-folders" onClickCapture={openFolderInPlace}>
      {ns && <PathBar identity={identity} base={base} ns={ns} collection={null} rkey={null} />}
      {ns && !open ? (
        <p className="fx-empty">
          This repo has nothing under <code>{ns}</code>.
        </p>
      ) : folders.length === 0 ? (
        <p className="fx-empty">
          Nothing here matches <code>{filter.trim()}</code>.
        </p>
      ) : (
        <ul className="fx-fd-grid">
          {folders.map((folder) => (
            <li key={folder.key} className="fx-fd-item">
              <Link
                href={folder.href}
                prefetch={false}
                rel="nofollow"
                className="fx-fd-tile"
                title={folder.title}
              >
                <FolderGlyph prefix={folder.prefix} />
                <code className="fx-fd-name">
                  <Nsid value={folder.name} />
                </code>
                <span className="fx-fd-meta">{folder.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
