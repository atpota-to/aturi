'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, FilePenLine, X } from 'lucide-react';
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
  const aturiUniversalLink = `/profile/${identity.handle || identity.did}/${collection}/${encodeURIComponent(decodedRkey)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          collection={collection}
          rkey={decodedRkey}
          // Universal link for the record — shareable into any compatible
          // Atmosphere client via the WaypointPicker on aturi.to.
          shareUrl={aturiUniversalLink}
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

      <AppearIn delay={0.08}>
        <RecordMeta atUri={atUri} cid={record?.cid} pds={identity.pds} did={identity.did} />
      </AppearIn>

      <AppearIn delay={0.1}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center',
        }}
      >
        <Link
          href={aturiUniversalLink}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.4rem 0.75rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.8125rem',
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={12} /> Universal link
        </Link>

        {canEdit && !editing && (
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
        {canEdit && editing && (
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
        {record && (
          <CopyButton
            value={JSON.stringify(record, null, 2)}
            label="Copy JSON"
            compact
            variant="subtle"
          />
        )}
      </div>
      </AppearIn>

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

function RecordMeta({
  atUri,
  cid,
  pds,
  did,
}: {
  atUri: string;
  cid?: string;
  pds: string;
  did: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        gap: '0.75rem',
        padding: '1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <MetaCell label="at uri" value={atUri} copyLabel="Copy AT URI" />
      {cid && <MetaCell label="cid" value={cid} copyLabel="Copy CID" />}
      <MetaCell label="pds" value={pds} copyLabel="Copy PDS URL" />
      <MetaCell label="did" value={did} copyLabel="Copy DID" />
    </div>
  );
}

function MetaCell({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div>
      <div className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          wordBreak: 'break-all',
          flexWrap: 'wrap',
        }}
      >
        <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
          {value}
        </code>
        <CopyButton value={value} label={copyLabel} compact variant="subtle" />
      </div>
    </div>
  );
}
