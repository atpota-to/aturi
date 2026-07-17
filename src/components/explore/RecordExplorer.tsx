'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePenLine, SearchX, TriangleAlert } from 'lucide-react';
import { getRecord, getRecordUrl, type AtRecord } from '@/utils/atproto/pdsClient';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { encodeRepo } from '@/utils/atproto/urls';
import { lexiconPathFor } from '@/utils/ufos/nsid';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CopyButton from './CopyButton';
import EngagementSidecar from './EngagementSidecar';
import LinkifiedJson from './LinkifiedJson';
import RecordPreview from '@/components/RecordPreview';
import RichRecordCard, { recordHasRichCard } from './RichRecordCard';
import BacklinksTab from './tabs/BacklinksTab';
import LexiconUsageCard from './lexicons/LexiconUsageCard';
import RecordEditor from './RecordEditor';
import SignInPanel from './SignInPanel';
import LinkButton from './LinkButton';
import NotFoundPanel from '@/components/NotFoundPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  DEFAULT_RECORD_SECTIONS,
  sectionHidden,
  type RecordSectionId,
} from '@/utils/exploreSections';
import { setSectionHidden, toggleRecordDataView } from '@/utils/preferences';

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
  const { prefs, update: updatePrefs, loading: prefsLoading } = usePreferences();

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
    return (
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That handle didn't resolve."
        body={`We tried to resolve "${repo}" and the AT Protocol resolver returned: ${identityError}. Try another handle, DID, or AT URI below.`}
        initialQuery={repo}
      />
    );
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
  const isPost = collection === 'app.bsky.feed.post';
  const hasRichCard = recordHasRichCard(collection);

  // The record page renders the user's chosen sections in their chosen order
  // (configurable in Settings → Sections). Until prefs settle we use the
  // defaults so first paint matches SSR and doesn't flicker.
  const settled = !prefsLoading;
  const recordSections = settled ? prefs.recordSections : DEFAULT_RECORD_SECTIONS;
  const cardHidden = sectionHidden(recordSections, 'richPreview');
  const structuredHiddenRaw = sectionHidden(recordSections, 'structuredJson');
  const rawHidden = sectionHidden(recordSections, 'rawJson');
  // The field table and raw JSON are the two data views; at least one must
  // stay visible. The setters maintain this, but guard the render too.
  const structuredHidden = structuredHiddenRaw && rawHidden ? false : structuredHiddenRaw;

  // Universal link uses the canonical `/profile/` path; bare-form
  // `/<handle>/<collection>/<rkey>` still works as a fallback route but
  // shareable copies should point at the canonical one.
  const aturiUniversalPath = `/profile/${identity.handle || identity.did}/${collection}/${encodeURIComponent(decodedRkey)}`;
  const universalLinkFull = `https://aturi.to${aturiUniversalPath}`;
  const pdsRecordUrl = getRecordUrl(identity.pds, {
    repo: identity.did,
    collection,
    rkey: decodedRkey,
  });

  // Edit affordance is a standalone chip rendered beneath the view sections —
  // the sections are independently toggleable, so the button can't live inside
  // any one of them (it would vanish when that section is hidden).
  const editButton =
    canEdit && !editing ? (
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
    ) : null;

  const breadcrumb = (
    <AppearIn rise>
      <Breadcrumb
        handle={identity.handle}
        did={identity.did}
        pds={identity.pds}
        collection={collection}
        rkey={decodedRkey}
      />
    </AppearIn>
  );
  const copyRowNode = (
    <CopyRow
      atUri={atUri}
      did={identity.did}
      pds={identity.pds}
      universalLink={universalLinkFull}
      universalPath={aturiUniversalPath}
      recordJson={record ? JSON.stringify(record, null, 2) : null}
      pdsRecordUrl={pdsRecordUrl}
    />
  );
  const signInNode = !session ? (
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
  ) : null;
  const editChipNode = editButton ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
      {editButton}
    </div>
  ) : null;

  // Load error: error panel + the helper sections that still make sense.
  if (recordError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {breadcrumb}
        <AppearIn delay={0.05}>
          <RecordErrorPanel
            raw={recordError}
            collection={collection}
            rkey={decodedRkey}
            handle={identity.handle || identity.did}
          />
        </AppearIn>
        <AppearIn delay={0.07}>
          <BacklinksTab target={atUri} showSummary />
        </AppearIn>
        <AppearIn delay={0.09}>{copyRowNode}</AppearIn>
        {editChipNode && <AppearIn delay={0.1}>{editChipNode}</AppearIn>}
        {signInNode && <AppearIn delay={0.11}>{signInNode}</AppearIn>}
      </div>
    );
  }

  // Edit mode: the editor takes the whole body; keep the copy row handy.
  if (editing && canEdit && agent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {breadcrumb}
        <AppearIn delay={0.05}>
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
            onCancel={() => setEditing(false)}
          />
        </AppearIn>
        <AppearIn delay={0.07}>{copyRowNode}</AppearIn>
      </div>
    );
  }

  if (!record) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {breadcrumb}
        <p className="explore-placeholder">Loading record…</p>
      </div>
    );
  }

  // Read mode: render the user's sections in their chosen order. The three
  // data views (card / field table / raw JSON) keep their inline switch
  // present even when collapsed, so they can be re-shown right on the page;
  // helper sections simply disappear when hidden (re-show via Settings).
  const recordForPreview = { uri: record.uri, cid: record.cid, value: record.value };
  const sectionRenderers: Record<RecordSectionId, () => ReactNode> = {
    richPreview: () =>
      !hasRichCard ? null : (
        <div style={sectionGroupStyle}>
          {!cardHidden && (
            <RichRecordCard
              handle={identity.handle || identity.did}
              did={identity.did}
              collection={collection}
              rkey={decodedRkey}
              record={record}
            />
          )}
          <ViewSwitchButton
            label={cardHidden ? 'Show rich preview' : 'Hide rich preview'}
            onToggle={() =>
              updatePrefs((p) => setSectionHidden(p, 'record', 'richPreview', !cardHidden))
            }
          />
        </div>
      ),
    structuredJson: () => (
      <div style={sectionGroupStyle}>
        {!structuredHidden && (
          <RecordPreview
            record={recordForPreview}
            collection={collection}
            handle={identity.handle || identity.did}
            rkey={decodedRkey}
            pds={identity.pds}
            hideExplorerCtas
          />
        )}
        <ViewSwitchButton
          label={structuredHidden ? 'Show rich JSON preview' : 'Hide rich JSON preview'}
          onToggle={() => updatePrefs((p) => toggleRecordDataView(p, 'structuredJson'))}
        />
      </div>
    ),
    rawJson: () => (
      <div style={sectionGroupStyle}>
        {!rawHidden && <LinkifiedJson value={record} className="explore-json" />}
        <ViewSwitchButton
          label={rawHidden ? 'Show raw JSON' : 'Hide raw JSON'}
          onToggle={() => updatePrefs((p) => toggleRecordDataView(p, 'rawJson'))}
        />
      </div>
    ),
    engagement: () =>
      !isPost ? (
        <EngagementSidecar did={identity.did} collection={collection} atUri={atUri} />
      ) : null,
    copyRow: () => copyRowNode,
    lexiconUsage: () => (
      <LexiconUsageCard
        collection={collection === 'com.atproto.lexicon.schema' ? decodedRkey : collection}
      />
    ),
    backlinks: () => <BacklinksTab target={atUri} showSummary />,
    signIn: () => signInNode,
  };

  const applicable = (id: string): boolean => {
    if (id === 'richPreview') return hasRichCard;
    if (id === 'engagement') return !isPost;
    if (id === 'signIn') return !session;
    return true;
  };
  const DATA_VIEW_IDS = new Set(['richPreview', 'structuredJson', 'rawJson']);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {breadcrumb}
      {recordSections.map(({ id, hidden }, i) => {
        if (!applicable(id)) return null;
        // Data views keep their switch even when collapsed; hidden helpers go.
        if (!DATA_VIEW_IDS.has(id) && hidden) return null;
        const node = sectionRenderers[id as RecordSectionId]();
        if (node == null) return null;
        return (
          <AppearIn key={id} delay={Math.min(0.05 + i * 0.02, 0.16)}>
            {node}
          </AppearIn>
        );
      })}
      {editChipNode && <AppearIn delay={0.18}>{editChipNode}</AppearIn>}
    </div>
  );
}

/**
 * A section + its view-switch share a tight vertical group (0.5rem) so the
 * toggle reads as belonging to the content directly above it, while groups sit
 * a full 1rem apart from each other in the page column.
 */
const sectionGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

/**
 * Quiet text toggle sitting beneath each record-body section (rich preview
 * card, rich JSON preview, raw JSON). Mirrors the repo page's ProfileViewSwitch
 * styling; callers own the persisted pref each one flips and supply a
 * state-dependent label. `alignSelf` keeps the hit area tight to the text even
 * though the group stretches its content sections full-width.
 */
function ViewSwitchButton({
  label,
  onToggle,
}: {
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        alignSelf: 'flex-start',
        padding: 0,
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.75rem',
        letterSpacing: '0.04em',
        color: 'var(--text-tertiary)',
        transition: 'color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-tertiary)';
      }}
    >
      {label}
    </button>
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
  pds,
  universalLink,
  universalPath,
  recordJson,
  pdsRecordUrl,
}: {
  atUri: string;
  did: string;
  pds: string;
  universalLink: string;
  /** Internal path to the universal link page — the inverse of the
      "View full record in Explorer" CTA on universal link pages. */
  universalPath: string;
  recordJson: string | null;
  /** Direct PDS XRPC URL — `View raw on PDS` lands on the raw JSON. */
  pdsRecordUrl: string;
}) {
  // CID intentionally omitted — the preview card's footer surfaces it
  // visibly with click-to-copy, so a second copy chip here would
  // duplicate the affordance.
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
      <CopyButton value={atUri} label="AT URI" compact variant="subtle" />
      <CopyButton value={did} label="DID" compact variant="subtle" />
      <CopyButton value={pds} label="PDS" compact variant="subtle" />
      <CopyButton value={universalLink} label="Universal link" compact variant="subtle" />
      {recordJson && (
        <CopyButton value={recordJson} label="JSON" compact variant="subtle" />
      )}
      <LinkButton href={universalPath} label="Universal link page" />
      <LinkButton
        href={pdsRecordUrl}
        label="View on PDS"
        external
        title="Fetch the raw record JSON from the PDS"
      />
    </div>
  );
}

/**
 * Pull the HTTP status and the XRPC error code/message out of the raw
 * error string thrown by the PDS client (`HTTP <status> <text> for <url>
 * :: <json-body>`). The body may be truncated, so JSON parsing is
 * best-effort and detection also falls back to substring matching.
 */
function parseRecordError(raw: string): {
  status: number | null;
  code: string | null;
} {
  const status = raw.match(/^HTTP (\d+)/)?.[1];
  let code: string | null = null;
  const sep = raw.indexOf('::');
  if (sep >= 0) {
    try {
      const obj = JSON.parse(raw.slice(sep + 2).trim());
      if (obj && typeof obj === 'object' && typeof obj.error === 'string') {
        code = obj.error;
      }
    } catch {
      // Truncated / non-JSON body — fall through to substring detection.
    }
  }
  return { status: status ? Number(status) : null, code };
}

/**
 * Human-readable replacement for dumping the raw PDS error onto the page.
 * Recognises "record not found" (the common case when following a "View
 * schema record" link to a lexicon whose owner never published a schema)
 * and explains it plainly; everything else gets a generic load-failure
 * message. The raw error stays available under a details disclosure.
 */
function RecordErrorPanel({
  raw,
  collection,
  rkey,
  handle,
}: {
  raw: string;
  collection: string;
  rkey: string;
  handle: string;
}) {
  const { status, code } = parseRecordError(raw);
  const notFound =
    code === 'RecordNotFound' || status === 404 || /RecordNotFound/i.test(raw);
  const isSchema = collection === 'com.atproto.lexicon.schema';
  const Icon = notFound ? SearchX : TriangleAlert;

  let headline: string;
  let body: ReactNode;
  if (notFound && isSchema) {
    headline = 'No schema published for this lexicon';
    body = (
      <>
        <code>{rkey}</code> is used across the network, but{' '}
        <strong>@{handle}</strong> hasn&rsquo;t published a{' '}
        <code>com.atproto.lexicon.schema</code> record defining it. That&rsquo;s
        common: a lexicon can be widely adopted without a formal schema record
        in its owner&rsquo;s repository.
      </>
    );
  } else if (notFound) {
    headline = 'This record doesn’t exist';
    body = (
      <>
        We couldn&rsquo;t find a <code>{collection}</code> record with key{' '}
        <code>{rkey}</code> in <strong>@{handle}</strong>&rsquo;s repository. It
        may have been deleted, or the link may be incorrect.
      </>
    );
  } else {
    headline = 'Couldn’t load this record';
    body = (
      <>
        The PDS returned an error{status ? ` (HTTP ${status})` : ''} while
        fetching this record. It might be a temporary problem. Try again in a
        moment.
      </>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        padding: '1.5rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      <div
        className="explore-small-caps"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        <Icon size={13} aria-hidden style={{ color: 'var(--text-accent)' }} />
        {notFound ? 'Not found' : 'Error'}
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: '1.25rem',
          color: 'var(--text-primary)',
        }}
      >
        {headline}
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: '0.9rem',
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          maxWidth: '42rem',
        }}
      >
        {body}
      </p>
      {notFound && isSchema && (
        <Link
          href={lexiconPathFor(rkey)}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: '0.85rem',
            color: 'var(--text-accent)',
            textDecoration: 'none',
            fontFamily: 'var(--font-serif)',
          }}
        >
          See how {rkey} is used across the atmosphere →
        </Link>
      )}
      <details className="explore-section" style={{ marginTop: '0.35rem' }}>
        <summary>Technical details</summary>
        <p className="explore-error" style={{ marginTop: '0.5rem' }}>
          {raw}
        </p>
      </details>
    </div>
  );
}
