'use client';

import { formatCount } from '../collectionListHelpers';
import type { SpaceTree } from './SpaceTree';

/**
 * "Spaces at a glance" — the permissioned counterpart to the repo page's
 * public stats row.
 *
 * The numbers are deliberately different from the public ones. A public repo
 * has one owner and one host, so its interesting figures are size and record
 * count. A visitor's permissioned data spans spaces run by other people, so
 * what matters is how far it spreads: how many spaces, under how many
 * authorities, how many of those are your own.
 *
 * Every figure is derived from what the tree has already fetched, so this adds
 * no requests. Counts that are still arriving read as such rather than
 * rendering a confident zero.
 */
export default function SpaceGlance({ tree, myDid }: { tree: SpaceTree; myDid: string }) {
  const scanned = [...tree.contents.values()].filter((c) => c.status === 'ready').length;
  const pending = tree.uris.length > scanned;
  // A scan that hit its cap makes every count downstream of it a lower bound.
  const truncated = [...tree.contents.values()].some(
    (c) => c.status === 'ready' && !c.complete,
  );
  const ownAuthority = tree.authorities.filter((did) => did === myDid).length;
  const otherAuthorities = tree.authorities.length - ownAuthority;

  const cells: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Spaces',
      value: `${formatCount(tree.uris.length)}${tree.more ? '+' : ''}`,
      hint: 'Spaces you have written to',
    },
    {
      label: 'Authorities',
      value: formatCount(tree.authorities.length),
      hint:
        otherAuthorities > 0
          ? `${formatCount(otherAuthorities)} run by someone else`
          : 'All your own',
    },
    {
      label: 'Collections',
      value: pending ? '…' : formatCount(tree.totalCollections),
      hint: 'Distinct record types',
    },
    {
      label: 'Records',
      value: pending ? '…' : `${formatCount(tree.totalRecords)}${truncated ? '+' : ''}`,
      hint: truncated ? 'Lower bound; some scans hit their cap' : 'Across every space',
    },
  ];

  return (
    <section className="fx-sp-glance">
      {cells.map((cell) => (
        <div key={cell.label}>
          <span className="fx-sp-glance-label">{cell.label}</span>
          <span className="fx-sp-glance-value">{cell.value}</span>
          {cell.hint && <span className="fx-sp-glance-hint">{cell.hint}</span>}
        </div>
      ))}
    </section>
  );
}
