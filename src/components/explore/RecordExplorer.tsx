'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, Pencil, SearchX, TriangleAlert } from 'lucide-react';
import { getRecord, getRecordUrl, type AtRecord } from '@/utils/atproto/pdsClient';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { encodeRepo } from '@/utils/atproto/urls';
import { lexiconPathFor } from '@/utils/ufos/nsid';
import { getMarginLexiconDisplayName, getMarginLexiconType } from '@/utils/marginLexicons';
import { parseURI } from '@/utils/uriParser';
import {
  BlueskySVG,
  getRecommendedWaypoints,
  getWaypointsForType,
  type Waypoint,
} from '@/utils/waypoints';
import { customToWaypoint, personalizeRecommended } from '@/utils/personalizeWaypoints';
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
import { repoRecordBackend } from './recordBackend';
import SignInPanel from './SignInPanel';
import LinkButton from './LinkButton';
import { useChromeBarAction } from './ChromeBarContext';
import { useOffscreen } from './useOffscreen';
import NotFoundPanel from '@/components/NotFoundPanel';
import SkeletonSwap from './skeletons/SkeletonSwap';
import { RecordBodySkeleton, RecordSkeleton } from './skeletons/pages';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  DEFAULT_RECORD_SECTIONS,
  sectionHidden,
} from '@/utils/exploreSections';
import { setSectionHidden } from '@/utils/preferences';

type Props = {
  repo: string;
  collection: string;
  rkey: string;
};

export default function RecordExplorer({ repo, collection, rkey }: Props) {
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

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

  return (
    <SkeletonSwap loading={!identity} skeleton={<RecordSkeleton />}>
      {identity && (
        <RecordView identity={identity} collection={collection} rkey={rkey} />
      )}
    </SkeletonSwap>
  );
}

/**
 * The record page proper, once the repo is a resolved identity. Split from the
 * resolver above so the skeleton and the loaded page are two states of one
 * <SkeletonSwap> rather than two returns that cut between each other.
 */
function RecordView({
  identity,
  collection,
  rkey,
}: {
  identity: IdentityBundle;
  collection: string;
  rkey: string;
}) {
  const router = useRouter();
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

  // The in-page "Edit record" chip, watched so the chrome bar can offer the
  // same action exactly while it isn't on screen. Its place on the page is
  // the visitor's choice (Settings → Sections), so it could be anywhere.
  const [editChipEl, setEditChipEl] = useState<HTMLButtonElement | null>(null);
  const editChipOffscreen = useOffscreen(editChipEl);
  // Resolved up here — ahead of the early returns below — so the chrome-bar
  // hook runs on every render.
  const canEdit = Boolean(agent && signedInDid && signedInDid === identity.did);
  // Same reason as the space editor's: <RecordEditor> re-reads whenever the
  // backend's identity changes, so it must not change on every render.
  const backend = useMemo(
    () => (agent ? repoRecordBackend(agent, identity.did) : null),
    [agent, identity.did],
  );
  useChromeBarAction(
    canEdit && !editing && editChipOffscreen
      ? {
          label: 'Edit record',
          title: 'Edit this record',
          onClick: () => setEditing(true),
        }
      : null,
  );

  useEffect(() => {
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

  const atUri = `at://${identity.did}/${collection}/${decodedRkey}`;
  const repoSeg = encodeRepo(identity.handle || identity.did);
  const isPost = collection === 'app.bsky.feed.post';
  const hasRichCard = recordHasRichCard(collection, decodedRkey);

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

  const recordLabel = recordTypeLabel(collection);

  const breadcrumb = (
    <AppearIn rise>
      <div className="fn-rec-titlebar">
        <div className="fn-rec-titletext">
          <Breadcrumb
            handle={identity.handle}
            did={identity.did}
            pds={identity.pds}
            collection={collection}
            rkey={decodedRkey}
            titled
            flush
          />
          <div className="fn-rec-titlerow">
            <h1 className="fn-rec-h1">{decodedRkey}</h1>
            {recordLabel && (
              <span className="fn-rec-pill">
                {recordLabel.bluesky && (
                  <span aria-hidden className="fn-rec-pill-icon">
                    <BlueskySVG />
                  </span>
                )}
                {recordLabel.text}
              </span>
            )}
          </div>
        </div>
        <div className="fn-rec-actions">
          <CopyTextButton value={atUri} label="Copy at:// URI" />
          {/* The Edit button stays watched (setEditChipEl) so the chrome bar
              offers the same action exactly while it isn't on screen. */}
          {canEdit && !editing && (
            <button
              ref={setEditChipEl}
              type="button"
              className="fn-rec-btn"
              onClick={() => setEditing(true)}
              title="Edit this record"
            >
              <Pencil size={14} aria-hidden /> Edit
            </button>
          )}
        </div>
      </div>
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
    <div className="fn-rec-card fn-rec-signin">
      <p>Sign in with your handle to edit your own records.</p>
      <SignInPanel defaultInput={identity.handle || ''} />
    </div>
  ) : null;

  // Load error: error panel + the helper sections that still make sense.
  if (recordError) {
    return (
      <div className="fn-rec">
        {breadcrumb}
        <div className="fn-rec-stack">
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
          {signInNode && <AppearIn delay={0.11}>{signInNode}</AppearIn>}
        </div>
      </div>
    );
  }

  // Edit mode: the editor takes the whole body; keep the copy row handy.
  if (editing && canEdit && backend) {
    return (
      <div className="fn-rec">
        {breadcrumb}
        <div className="fn-rec-stack">
          <AppearIn delay={0.05}>
            <RecordEditor
              backend={backend}
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
      </div>
    );
  }

  // Read mode: the user's sections in their chosen order, split over two
  // columns. The preview and the helpers that read about the record
  // (engagement, backlinks, lexicon usage, sign-in) take the wide column; the
  // "Open in" panel, the Record card (field table and raw JSON behind one
  // Fields/JSON switch) and the copy row take the aside. A record with no
  // rich card, or whose card is hidden, has nothing to preview, so its Record
  // card moves into the wide column where long values have room.
  //
  // Null until the record lands — the title bar above is already real by
  // then, so only the body waits, behind <RecordBodySkeleton>.
  const recordForPreview = record
    ? { uri: record.uri, cid: record.cid, value: record.value }
    : null;
  const recordInMain = !hasRichCard || cardHidden;
  const showDataView = (view: 'structuredJson' | 'rawJson') =>
    updatePrefs((p) => {
      const other = view === 'structuredJson' ? 'rawJson' : 'structuredJson';
      return setSectionHidden(setSectionHidden(p, 'record', view, false), 'record', other, true);
    });
  const recordCard =
    record && recordForPreview ? (
      <section className="fn-rec-card fn-rec-data" aria-labelledby="fn-rec-data-title">
        <div className="fn-rec-data-head">
          <h2 id="fn-rec-data-title" className="fn-rec-h2">
            Record
          </h2>
          <div role="group" aria-label="Record view" className="fn-rec-seg">
            <button
              type="button"
              aria-pressed={!structuredHidden}
              onClick={() => {
                if (!rawHidden) showDataView('structuredJson');
              }}
            >
              Fields
            </button>
            <button
              type="button"
              aria-pressed={!rawHidden}
              onClick={() => {
                if (!structuredHidden) showDataView('rawJson');
              }}
            >
              JSON
            </button>
          </div>
        </div>
        <dl className="fn-rec-ids">
          <dt>URI</dt>
          <dd>
            <span className="fn-rec-ids-value" title={atUri}>
              {atUri}
            </span>
            <CopyButton value={atUri} label="Copy at:// URI" compact variant="subtle" iconOnly />
          </dd>
          {record.cid && (
            <>
              <dt>CID</dt>
              <dd>
                <span className="fn-rec-ids-value" title={record.cid}>
                  {record.cid}
                </span>
                <CopyButton value={record.cid} label="Copy CID" compact variant="subtle" iconOnly />
              </dd>
            </>
          )}
        </dl>
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
        {!rawHidden && (
          <div className="fn-rec-json">
            <LinkifiedJson value={record} className="explore-json" />
          </div>
        )}
      </section>
    ) : null;

  type Placed = { id: string; column: 'main' | 'aside'; node: ReactNode };
  const placed: Placed[] = [];
  if (record && recordForPreview) {
    let recordPlaced = false;
    for (const { id, hidden } of recordSections) {
      if (id === 'richPreview') {
        if (!hasRichCard) continue;
        placed.push({
          id,
          column: 'main',
          node: (
            <div className="fn-rec-group">
              {!cardHidden && (
                <div className="fn-rec-preview">
                  <RichRecordCard
                    handle={identity.handle || identity.did}
                    did={identity.did}
                    collection={collection}
                    rkey={decodedRkey}
                    record={record}
                    identity={identity}
                  />
                </div>
              )}
              <ViewSwitchButton
                label={cardHidden ? 'Show rich preview' : 'Hide rich preview'}
                onToggle={() =>
                  updatePrefs((p) => setSectionHidden(p, 'record', 'richPreview', !cardHidden))
                }
              />
            </div>
          ),
        });
      } else if (id === 'structuredJson' || id === 'rawJson') {
        // Both data views live in the one Record card, placed where the
        // first of them sits in the visitor's order.
        if (recordPlaced) continue;
        recordPlaced = true;
        placed.push({ id: 'record', column: recordInMain ? 'main' : 'aside', node: recordCard });
      } else if (!hidden) {
        let node: ReactNode = null;
        let column: Placed['column'] = 'main';
        if (id === 'engagement' && !isPost) {
          node = <EngagementSidecar did={identity.did} collection={collection} atUri={atUri} />;
        } else if (id === 'copyRow') {
          node = copyRowNode;
          column = 'aside';
        } else if (id === 'lexiconUsage') {
          node = (
            <LexiconUsageCard
              collection={collection === 'com.atproto.lexicon.schema' ? decodedRkey : collection}
            />
          );
        } else if (id === 'backlinks') {
          node = <BacklinksTab target={atUri} showSummary />;
        } else if (id === 'signIn') {
          node = signInNode;
        }
        if (node != null) placed.push({ id, column, node });
      }
    }
  }
  const openInNode = (
    <OpenInPanel
      handle={identity.handle || identity.did}
      did={identity.did}
      collection={collection}
      rkey={decodedRkey}
      universalPath={aturiUniversalPath}
      isPost={isPost}
    />
  );
  const renderColumn = (column: Placed['column']) =>
    placed
      .filter((p) => p.column === column)
      .map((p, i) => (
        <AppearIn
          key={p.id}
          delay={Math.min(0.05 + i * 0.03, 0.16)}
          className="fn-rec-slot"
          style={{ order: SLOT_ORDER[p.id] ?? 3 }}
        >
          {p.node}
        </AppearIn>
      ));

  return (
    <div className="fn-rec">
      {breadcrumb}
      <SkeletonSwap loading={!record} skeleton={<RecordBodySkeleton />}>
        {record && (
          <div className="fn-rec-body">
            <div className="fn-rec-main">{renderColumn('main')}</div>
            <aside className="fn-rec-aside" aria-label="Open and copy this record">
              <AppearIn delay={0.05} className="fn-rec-slot" style={{ order: 1 }}>
                {openInNode}
              </AppearIn>
              {renderColumn('aside')}
            </aside>
          </div>
        )}
      </SkeletonSwap>
    </div>
  );
}

/**
 * Stacking order once the two columns collapse into one (phones and narrow
 * tablets, see .fn-rec-body in record.css): the preview, then where to open
 * it, then its data, then everything else in the visitor's own order. The
 * columns ignore it; each holds a single kind of slot.
 */
const SLOT_ORDER: Record<string, number> = { richPreview: 0, record: 2 };

/**
 * The pill beside the rkey: what kind of record this is, in words, for the
 * collections the site knows how to name. Others get no pill; the
 * breadcrumb already names their collection.
 */
function recordTypeLabel(collection: string): { text: string; bluesky: boolean } | null {
  const bsky: Record<string, string> = {
    'app.bsky.feed.post': 'Bluesky post',
    'app.bsky.actor.profile': 'Bluesky profile',
    'app.bsky.feed.like': 'Bluesky like',
    'app.bsky.feed.repost': 'Bluesky repost',
    'app.bsky.graph.follow': 'Bluesky follow',
    'app.bsky.graph.list': 'Bluesky list',
    'app.bsky.graph.block': 'Bluesky block',
    'app.bsky.feed.generator': 'Bluesky feed',
  };
  if (bsky[collection]) return { text: bsky[collection], bluesky: true };
  if (getMarginLexiconType(collection)) {
    return { text: getMarginLexiconDisplayName(collection), bluesky: false };
  }
  return null;
}

/**
 * "Copy at:// URI" in the title bar: a full-size button with a label, which
 * the compact copy chips elsewhere on the page are not.
 */
function CopyTextButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button
      type="button"
      className="fn-rec-btn"
      onClick={onClick}
      data-copied={copied || undefined}
      aria-label={copied ? `${label}: copied` : label}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Quiet text toggle sitting beneath the rich preview card. Callers own the
 * persisted pref it flips and supply a state-dependent label. `alignSelf`
 * keeps the hit area tight to the text.
 */
function ViewSwitchButton({
  label,
  onToggle,
}: {
  label: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="fn-rec-switch">
      {label}
    </button>
  );
}

/**
 * "Open this record in": the record's recommended apps first (the top one
 * filled), then a few more from the visitor's own waypoint groups, then a link
 * to the universal link page, which lists every app. The same personalisation
 * as the universal link page's picker: a waypoint no group shows is left out.
 * Aturi's own waypoints are skipped, since they lead back here.
 */
function OpenInPanel({
  handle,
  did,
  collection,
  rkey,
  universalPath,
  isPost,
}: {
  handle: string;
  did: string;
  collection: string;
  rkey: string;
  universalPath: string;
  isPost: boolean;
}) {
  const { prefs } = usePreferences();
  const { recommended, more } = useMemo(() => {
    const type = parseURI(handle, collection, rkey).type;
    const withUrl = (w: Waypoint) => {
      const url = w.getUrl(handle, collection, rkey, did);
      return url ? { waypoint: w, url } : null;
    };
    const skip = new Set(['aturi', 'aturiExplore']);
    const rec = personalizeRecommended(getRecommendedWaypoints(type, collection).waypoints, prefs)
      .filter((w) => !skip.has(w.id))
      .map(withUrl)
      .filter((x): x is { waypoint: Waypoint; url: string } => x !== null)
      .slice(0, 2);
    const taken = new Set(rec.map((r) => r.waypoint.id));
    const builtins = new Map(getWaypointsForType(type).map((w) => [w.id, w]));
    const customs = new Map(prefs.customWaypoints.map((c) => [c.id, c]));
    const rest: { waypoint: Waypoint; url: string }[] = [];
    for (const group of prefs.waypointGroups) {
      for (const id of group.waypointIds) {
        if (rest.length >= 3) break;
        if (taken.has(id) || skip.has(id)) continue;
        taken.add(id);
        const custom = customs.get(id);
        const w = custom
          ? custom.supportedTypes.includes(type)
            ? customToWaypoint(custom)
            : null
          : builtins.get(id) ?? null;
        const entry = w ? withUrl(w) : null;
        if (entry) rest.push(entry);
      }
    }
    return { recommended: rec, more: rest };
  }, [handle, did, collection, rkey, prefs]);

  return (
    <section className="fn-rec-card fn-open" aria-labelledby="fn-open-title">
      <h2 id="fn-open-title" className="fn-rec-h2">
        Open this {isPost ? 'post' : 'record'} in
      </h2>
      {recommended.map(({ waypoint, url }, i) => (
        <a
          key={waypoint.id}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="fn-open-row"
          data-rank={i === 0 ? 'primary' : 'secondary'}
        >
          <span aria-hidden className="fn-open-icon">
            {waypoint.icon}
          </span>
          <span className="fn-open-name">{waypoint.name}</span>
          <span className="fn-open-note">Recommended</span>
        </a>
      ))}
      {more.length > 0 && (
        <div className="fn-open-more">
          {more.map(({ waypoint, url }) => (
            <a
              key={waypoint.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-open-row"
            >
              <span aria-hidden className="fn-open-icon">
                {waypoint.icon}
              </span>
              <span className="fn-open-name">{waypoint.name}</span>
              <span className="fn-open-domain">{hostOf(url)}</span>
            </a>
          ))}
        </div>
      )}
      <Link href={universalPath} prefetch={false} className="fn-open-all">
        More apps
      </Link>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The values a record-page visitor might want to grab, as compact copy chips,
 * plus the two ways out (the universal link page and the raw record on the
 * PDS). The URI and CID also sit in the Record card with their own copy
 * buttons; this row keeps the rest together.
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
  return (
    <section className="fn-rec-card fn-rec-copy" aria-label="Copy">
      <h2 className="fn-rec-h2">Copy</h2>
      <div className="fn-rec-copy-chips">
        <CopyButton value={atUri} label="AT URI" compact variant="subtle" />
        <CopyButton value={did} label="DID" compact variant="subtle" />
        <CopyButton value={pds} label="PDS" compact variant="subtle" />
        <CopyButton value={universalLink} label="Universal link" compact variant="subtle" />
        {recordJson && (
          <CopyButton value={recordJson} label="JSON" compact variant="subtle" />
        )}
      </div>
      <div className="fn-rec-copy-links">
        <LinkButton href={universalPath} label="Universal link page" />
        <LinkButton
          href={pdsRecordUrl}
          label="View on PDS"
          external
          title="Fetch the raw record JSON from the PDS"
        />
      </div>
    </section>
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
    <div className="fn-rec-card fn-rec-error">
      <div className="fn-rec-error-kicker">
        <Icon size={14} aria-hidden />
        {notFound ? 'Not found' : 'Error'}
      </div>
      <h2>{headline}</h2>
      <p>{body}</p>
      {notFound && isSchema && (
        <Link href={lexiconPathFor(rkey)} prefetch={false} className="fn-rec-error-link">
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
