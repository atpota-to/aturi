'use client';

import { useEffect, useState } from 'react';
import { CircleSlash } from 'lucide-react';
import {
  getInactiveRepoRev,
  resolveHandle,
  type IdentityBundle,
} from '@/utils/atproto/identity';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';

/**
 * Copy per hosting status. The `status` string comes from the account's own
 * PDS via com.atproto.sync.getRepoStatus and is rendered verbatim alongside
 * this; the prose only explains what the state means for reading the repo.
 *
 * Deliberately says nothing about why an account is in one of these states.
 * The protocol doesn't carry a reason, so neither does the explorer.
 */
const STATUS_COPY: Record<string, { headline: string; detail: string }> = {
  takendown: {
    headline: 'This repo has been taken down.',
    detail:
      'Its host refuses every record read. A takedown is the host’s own action and carries no public reason with it.',
  },
  suspended: {
    headline: 'This repo is suspended.',
    detail:
      'Its host refuses every record read. The status is all the PDS reports — there is no duration or reason attached to it.',
  },
  deactivated: {
    headline: 'This account is deactivated.',
    detail:
      'Deactivation is usually the account holder’s own switch: it is how you step away from a host, and how a repo looks part-way through migrating between two. Records return if it is reactivated.',
  },
  deleted: {
    headline: 'This repo has been deleted.',
    detail: 'Its host reports the repo gone, so there are no records left to read from it.',
  },
};

/**
 * Banner for a repo whose host won't serve reads. Renders nothing for the
 * ordinary case, so the repo page can mount it unconditionally.
 *
 * The point of the panel is that a dead repo is not a dead identity: a
 * takedown is a hosting state, and the DID document, the PLC audit log and
 * every inbound link from other people's repos are all somewhere else and all
 * still resolve. It names what is gone, then points at what is left.
 */
export default function RepoStatusNotice({ identity }: { identity: IdentityBundle }) {
  const repo = identity.repoStatus;
  if (!repo) return null;

  const status = repo.status || 'inactive';
  const copy = STATUS_COPY[status] ?? {
    headline: `This repo is marked ${status}.`,
    detail: 'Its host refuses record reads while the repo is in this state.',
  };

  return (
    <section
      aria-label={`Repo status: ${status}`}
      style={{
        display: 'flex',
        gap: '0.875rem',
        alignItems: 'flex-start',
        padding: '1.125rem 1.25rem',
        border: '1px solid var(--danger-border)',
        background: 'var(--danger-soft)',
      }}
    >
      <CircleSlash
        size={18}
        aria-hidden
        style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.125rem' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            {copy.headline}
          </strong>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {copy.detail}
          </p>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Its identity is untouched. The DID document, the PLC audit log and every record
            elsewhere in the Atmosphere that points at this DID live outside the PDS, so the
            ID, LOG and BACKLINKS tabs below all still work.
          </p>
        </div>
        <StatusFacts
          pds={identity.pds}
          did={identity.did}
          status={repo.status}
          handle={identity.handle}
        />
      </div>
    </section>
  );
}

/**
 * The three things worth stating precisely: what the host said, whether the
 * handle still points here, and when the repo was last written to.
 *
 * Only the status arrives with the page. The other two each cost a request to
 * somebody else — a relay for the rev, the handle resolver for the handle —
 * and neither is worth holding the banner back for, so they fill in behind it.
 */
function StatusFacts({
  pds,
  did,
  status,
  handle,
}: {
  pds: string;
  did: string;
  status: string | null;
  handle: string | null;
}) {
  // `undefined` while the lookup is in flight; `null` once it has come back
  // with nothing. The two read differently to a visitor, so they stay apart.
  const [rev, setRev] = useState<string | null | undefined>(undefined);
  const [handleVerified, setHandleVerified] = useState<boolean | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setRev(undefined);
    setHandleVerified(undefined);

    getInactiveRepoRev(did).then((value) => {
      if (!cancelled) setRev(value);
    });

    if (!handle) {
      setHandleVerified(null);
    } else {
      // A takedown is a hosting state: it leaves DNS, the DID document and the
      // PLC directory alone, so a handle often keeps resolving long after the
      // repo stops answering. It can also have been picked up by somebody
      // else, which is the case actually worth flagging.
      resolveHandle(handle)
        .then((resolved) => {
          if (!cancelled) setHandleVerified(resolved ? resolved === did : null);
        })
        .catch(() => {
          if (!cancelled) setHandleVerified(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [did, handle]);

  const revDate = rev ? tidToDate(rev) : null;

  let handleNote: string;
  if (!handle) handleNote = 'no at:// entry in the DID document';
  else if (handleVerified === undefined) handleNote = 'checking…';
  else if (handleVerified === true) handleNote = 'still resolves to this DID';
  else if (handleVerified === false) handleNote = 'now resolves to a different DID';
  else handleNote = 'claimed in the DID document, could not be verified';

  let revNote: string;
  if (rev === undefined) revNote = 'checking…';
  else if (revDate) revNote = `last rev seen by the relay · ${formatTidRelative(revDate)}`;
  else revNote = 'no rev available';

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
        gap: '0.75rem 1.5rem',
        margin: 0,
      }}
    >
      <Fact label="status" value={status || 'inactive'} note={hostname(pds)} />
      <Fact label="handle" value={handle ? `@${handle}` : '—'} note={handleNote} />
      <Fact
        label="last rev"
        value={rev || '—'}
        // Hedged on purpose: this is the newest rev a relay holds for the
        // repo, which reads as the account's last write, but we have not
        // confirmed that a relay leaves it alone when an account event
        // arrives. Calling it "last active" would claim more than we checked.
        note={revNote}
        title={revDate ? revDate.toISOString() : undefined}
      />
    </dl>
  );
}

function Fact({
  label,
  value,
  note,
  title,
}: {
  label: string;
  value: string;
  note: string;
  title?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          color: 'var(--text-primary)',
          overflowWrap: 'anywhere',
        }}
        title={title}
      >
        {value}
      </dd>
      <div
        style={{
          marginTop: '0.125rem',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
        }}
      >
        {note}
      </div>
    </div>
  );
}

/** Bare hostname for the PDS that answered, so the status has an author. */
function hostname(pds: string): string {
  try {
    return new URL(pds).hostname;
  } catch {
    return pds;
  }
}
