'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePenLine, X } from 'lucide-react';
import { getRecord, type AtRecord } from '@/utils/atproto/pdsClient';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { encodeRepo } from '@/utils/atproto/urls';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import EngagementSidecar from './EngagementSidecar';
import LinkifiedJson from './LinkifiedJson';
import RichRecordPreview from './RichRecordPreview';
import BacklinksTab from './tabs/BacklinksTab';
import RecordEditor from './RecordEditor';
import SignInPanel from './SignInPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';

type Props = {
  repo: string;
  collection: string;
  rkey: string;
};

export default function RecordExplorer({ repo, collection, rkey }: Props) {
  const router = useRouter();
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [record, setRecord] = useState<AtRecord | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { agent, did: signedInDid, session } = useAtprotoSession();

  const decodedRkey = useMemo(() => {
    try {
      return decodeURIComponent(rkey);
    } catch {
      return rkey;
    }
  }, [rkey]);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setIdentityError(null);
    resolveIdentifier(repo)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .catch((err) => {
        if (!cancelled) setIdentityError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => {
    if (!identity) return undefined;
    let cancelled = false;
    setRecord(null);
    setRecordError(null);
    getRecord(identity.pds, {
      repo: identity.did,
      collection,
      rkey: decodedRkey,
    })
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((err) => {
        if (!cancelled) setRecordError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity, collection, decodedRkey]);

  if (identityError) {
    return <p className="explore-error">{identityError}</p>;
  }
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

  const atUri = `at://${identity.did}/${collection}/${decodedRkey}`;
  const repoSeg = encodeRepo(identity.handle || identity.did);
  const canEdit = Boolean(agent && signedInDid && signedInDid === identity.did);
  // Universal link uses the canonical `/profile/` path; bare-form
  // `/<handle>/<collection>/<rkey>` still works as a fallback route but
  // shareable copies should point at the canonical one.
  const aturiUniversalPath = `/profile/${identity.handle || identity.did}/${collection}/${encodeURIComponent(decodedRkey)}`;
  const universalLinkFull = `https://aturi.to${aturiUniversalPath}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          collection={collection}
          rkey={decodedRkey}
        />
      </AppearIn>

      {/* Rich preview leads — most visitors care about "what is this
          record?" before they care about its CID / PDS / DID. Mirrors
          the universal link page's layout. */}
      {recordError && <p className="explore-error">{recordError}</p>}
      {!record && !recordError && <p className="explore-placeholder">Loading record…</p>}
      <AppearIn delay={0.05}>
        <RichRecordPreview
          handle={identity.handle || identity.did}
          did={identity.did}
          collection={collection}
          rkey={decodedRkey}
          record={record}
        />
      </AppearIn>

      {record && (
        <AppearIn>
          <EngagementSidecar did={identity.did} collection={collection} atUri={atUri} />
        </AppearIn>
      )}

      {/* Consolidated copy row. URI elements live in the breadcrumb above,
          so we don't repeat them as a value-display grid — every identifier
          is one tap away as a copy button instead. */}
      <AppearIn delay={0.08}>
        <CopyRow
          atUri={atUri}
          did={identity.did}
          cid={record?.cid}
          pds={identity.pds}
          universalLink={universalLinkFull}
          recordJson={record ? JSON.stringify(record, null, 2) : null}
        />
      </AppearIn>

      {canEdit && (
        <AppearIn delay={0.1}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent-moss)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent-moss)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                <FilePenLine size={12} /> Edit record
              </button>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  background: 'transparent',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                <X size={12} /> Close editor
              </button>
            )}
          </div>
        </AppearIn>
      )}

      {editing && canEdit && agent && (
        <RecordEditor
          agent={agent}
          did={identity.did}
          collection={collection}
          rkey={decodedRkey}
          onSaved={(next) => {
            setRecord((prev) => (prev ? { ...prev, value: next } : prev));
          }}
          onDeleted={() => {
            setEditing(false);
            router.push(`/explore/${repoSeg}/${collection}`);
          }}
        />
      )}

      {!session && (
        <div
          style={{
            padding: '0.875rem 1rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Sign in with your handle to edit your own records.
          </p>
          <SignInPanel defaultInput={identity.handle || ''} />
        </div>
      )}

      {record && (
        <details className="explore-section">
          <summary>Raw record JSON</summary>
          <LinkifiedJson value={record} className="explore-json" />
        </details>
      )}

      <details className="explore-section">
        <summary>Backlinks to this record</summary>
        <div style={{ marginTop: '0.75rem' }}>
          <BacklinksTab target={atUri} />
        </div>
      </details>
    </div>
  );
}

/**
 * Single-row of compact copy buttons for the values a record-page
 * visitor might want to grab. Replaces the older RecordMeta + per-cell
 * copy + standalone "Copy JSON" + outbound "Universal link" cluster.
 * Values themselves aren't displayed — the URI elements are in the
 * breadcrumb above, and CID/DID/PDS are visible in the raw JSON below.
 */
function CopyRow({
  atUri,
  did,
  cid,
  pds,
  universalLink,
  recordJson,
}: {
  atUri: string;
  did: string;
  cid?: string;
  pds: string;
  universalLink: string;
  recordJson: string | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <span
        className="explore-small-caps"
        style={{ marginRight: '0.25rem', color: 'var(--text-tertiary)' }}
      >
        Copy
      </span>
      <CopyButton value={atUri} label="AT URI" compact variant="subtle" />
      <CopyButton value={did} label="DID" compact variant="subtle" />
      {cid && <CopyButton value={cid} label="CID" compact variant="subtle" />}
      <CopyButton value={pds} label="PDS" compact variant="subtle" />
      <CopyButton value={universalLink} label="Universal link" compact variant="subtle" />
      {recordJson && (
        <CopyButton value={recordJson} label="JSON" compact variant="subtle" />
      )}
    </div>
  );
}
