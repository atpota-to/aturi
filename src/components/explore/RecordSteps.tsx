'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { listRecordsPage } from '@/utils/atproto/pdsClient';
import { encodeRepo, rkeyFromAtUri } from '@/utils/atproto/urls';

type Neighbours = { rkey: string; newer: string | null; older: string | null };

/**
 * The record page's way through its collection: the newer and older record
 * beside this one, in the order the collection's list shows them (newest
 * first), with J and K for the same moves.
 *
 * listRecords takes a record key as its cursor and answers with the records
 * after it, older ones by default and newer ones with `reverse`, so each
 * neighbour is one record's read. A PDS that reads the cursor some other way
 * answers with a key on the wrong side of this one, or this one again; that
 * answer is dropped and its button stays off rather than going somewhere
 * that isn't next.
 */
export default function RecordSteps({
  identity,
  collection,
  rkey,
}: {
  identity: IdentityBundle;
  collection: string;
  /** The record's key, decoded. */
  rkey: string;
}) {
  const router = useRouter();
  const [near, setNear] = useState<Neighbours | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = (reverse: boolean) =>
      listRecordsPage(identity.pds, { repo: identity.did, collection, limit: 1, cursor: rkey, reverse })
        .then((page) => {
          const key = page.records?.[0] ? rkeyFromAtUri(page.records[0].uri) : null;
          if (!key) return null;
          return (reverse ? key > rkey : key < rkey) ? key : null;
        })
        .catch(() => null);
    Promise.all([read(true), read(false)]).then(([newer, older]) => {
      if (!cancelled) setNear({ rkey, newer, older });
    });
    return () => {
      cancelled = true;
    };
  }, [identity.pds, identity.did, collection, rkey]);

  const here = near?.rkey === rkey ? near : null;
  const repoSeg = encodeRepo(identity.handle || identity.did);
  const href = (key: string) => `/explore/${repoSeg}/${collection}/${encodeURIComponent(key)}`;

  // Typing, a dialog, or a key the site's shortcuts already took keeps it.
  const keys = useRef({ here, href, router });
  useEffect(() => {
    keys.current = { here, href, router };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) return;
      const { here: at, href: to, router: r } = keys.current;
      const key = e.key === 'j' || e.key === 'J' ? at?.older : e.key === 'k' || e.key === 'K' ? at?.newer : null;
      if (key) r.push(to(key));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const step = (key: string | null | undefined, label: string, hint: string, icon: React.ReactNode) =>
    key ? (
      // A dynamic route, so no prefetch; nofollow, as every record link is.
      <Link href={href(key)} prefetch={false} rel="nofollow" className="fn-rec-btn fn-rec-step" aria-label={label} title={hint}>
        {icon}
      </Link>
    ) : (
      <span className="fn-rec-btn fn-rec-step" aria-disabled="true" aria-label={label} title={label} role="link">
        {icon}
      </span>
    );

  return (
    <div className="fn-rec-steps" role="group" aria-label="Records in this collection">
      {step(here?.newer, 'Newer record', 'Newer (K)', <ChevronUp size={15} aria-hidden />)}
      {step(here?.older, 'Older record', 'Older (J)', <ChevronDown size={15} aria-hidden />)}
    </div>
  );
}
