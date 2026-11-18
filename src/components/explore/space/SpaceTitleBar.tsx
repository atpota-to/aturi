'use client';

import type { ReactNode } from 'react';
import ShareLinkChip from '../ShareLinkChip';

/**
 * The Field Notes title bar for every level of the space tree: the trail
 * (rendered `titled`, so it stops one short) over the last segment as a mono
 * <h1> with a pill naming what kind of thing it is, the page's own actions and
 * the share chip on the right. The same shape the collection page uses, so a
 * space reads as the explorer one level further in.
 */
export default function SpaceTitleBar({
  crumbs,
  title,
  pill,
  address,
  actions,
  shareUrl,
}: {
  /** A <Breadcrumb titled /> for this level. */
  crumbs: ReactNode;
  title: ReactNode;
  pill?: ReactNode;
  /** The full address, on its own line under the title. */
  address?: ReactNode;
  actions?: ReactNode;
  shareUrl: string;
}) {
  return (
    <div className="fx-titlebar">
      <div className="fx-titlebar-text">
        {crumbs}
        <div className="fx-title-row">
          <h1 className="fx-h1">{title}</h1>
          {pill}
        </div>
        {address && <p className="fx-sp-address">{address}</p>}
      </div>
      <div className="fx-actions">
        {actions}
        <ShareLinkChip url={shareUrl} iconOnly />
      </div>
    </div>
  );
}
