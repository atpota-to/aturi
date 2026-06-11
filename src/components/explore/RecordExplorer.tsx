'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import RichRecordPreview, { previewRendersGeneric } from './RichRecordPreview';
import BacklinksTab from './tabs/BacklinksTab';
import LexiconUsageCard from './lexicons/LexiconUsageCard';
import RecordEditor from './RecordEditor';
import SignInPanel from './SignInPanel';
import LinkButton from './LinkButton';
import NotFoundPanel from '@/components/NotFoundPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';

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
  // "Minimal post view" preference — collapse the rich Bluesky post card to
  // just the structured record. Only applies to posts, and only once prefs
  // have settled (defaults render the full preview, matching first paint).
  const isPost = collection === 'app.bsky.feed.post';
  const showPostViewSwitch = !prefsLoading && isPost;
  const minimalPost = showPostViewSwitch && prefs.minimalPostPreview;
  // Rich-preview vs raw-JSON view state. Both gated on prefs having settled so
  // first paint matches the defaults (rich shown, raw hidden) and doesn't
  // flicker. The two are independent: a visitor can collapse the rich card,
  // surface the raw JSON, do both, or neither.
  const hideRich = !prefsLoading && prefs.hideRichPreview;
  const showRawJson = !prefsLoading && prefs.showRawRecordJson;
  // Universal link uses the canonical `/profile/` path; bare-form
  // `/<handle>/<collection>/<rkey>` still works as a fallback route but
  // shareable copies should point at the canonical one.
  const aturiUniversalPath = `/profile/${identity.handle || identity.did}/${collection}/${encodeURIComponent(decodedRkey)}`;
  const universalLinkFull = `https://aturi.to${aturiUniversalPath}`;

  // The generic RecordPreview has a footer slot for the Edit button; for
  // post/margin previews we keep a standalone Edit chip above the copy row.
  const editsInPreviewFooter = previewRendersGeneric(collection);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          collection={collection}
          rkey={decodedRkey}
        />
      </AppearIn>

      {/* Primary slot. In read mode this is the rich preview (PostPreview /
          margin variants / generic RecordPreview). In edit mode the same
          slot becomes the editor — so the user's eye doesn't have to
          travel to find their changes, and the page doesn't grow longer
          to accommodate a separate editor section.

          The Edit button slots into the generic preview's footer
          alongside the CID when applicable; post / margin previews fall
          back to a standalone chip below the copy row. */}
      {recordError ? (
        <AppearIn delay={0.05}>
          <RecordErrorPanel
            raw={recordError}
            collection={collection}
            rkey={decodedRkey}
            handle={identity.handle || identity.did}
          />
        </AppearIn>
      ) : (
        <>
          {!record && !editing && (
            <p className="explore-placeholder">Loading record…</p>
          )}
          {(editing || !hideRich) && (
            <AppearIn delay={0.05}>
              {editing && canEdit && agent ? (
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
              ) : (
                <RichRecordPreview
                  handle={identity.handle || identity.did}
                  did={identity.did}
                  collection={collection}
                  rkey={decodedRkey}
                  record={record}
                  footerActions={editsInPreviewFooter ? editButton : null}
                  minimalPost={minimalPost}
                />
              )}
            </AppearIn>
          )}
          {/* View switches beneath the preview. "Hide rich preview" collapses
              the rich card; "Show raw JSON" swaps in the linkified record JSON
              (replacing the old standalone disclosure at the page foot). The
              minimal/full post switch only applies to the rich post card, so
              it's hidden once the rich preview is collapsed. All flip persisted
              prefs so the choice sticks and syncs across devices. */}
          {!editing && record && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: '0.35rem 1.25rem',
                marginTop: '-0.25rem',
              }}
            >
              <ViewSwitchButton
                label={hideRich ? 'Show rich preview' : 'Hide rich preview'}
                onToggle={() =>
                  updatePrefs((p) => ({ ...p, hideRichPreview: !p.hideRichPreview }))
                }
              />
              {!hideRich && showPostViewSwitch && (
                <ViewSwitchButton
                  label={minimalPost ? 'Show full post preview' : 'Use minimal view'}
                  onToggle={() =>
                    updatePrefs((p) => ({ ...p, minimalPostPreview: !p.minimalPostPreview }))
                  }
                />
              )}
              <ViewSwitchButton
                label={showRawJson ? 'Hide raw JSON' : 'Show raw JSON'}
                onToggle={() =>
                  updatePrefs((p) => ({ ...p, showRawRecordJson: !p.showRawRecordJson }))
                }
              />
            </div>
          )}
          {/* Raw record JSON, surfaced right under the preview area so it
              reads as the rich preview's counterpart rather than a footnote. */}
          {!editing && record && showRawJson && (
            <AppearIn delay={0.05}>
              <LinkifiedJson value={record} className="explore-json" />
            </AppearIn>
          )}
        </>
      )}

      {/* Engagement counts. Skipped for Bluesky posts — the rich post
          preview's footer already shows replies/reposts/likes/quotes, so a
          separate sidecar would just duplicate them. Still shown for
          profiles (followers/following/posts) and other applicable records. */}
      {record && !editing && !isPost && (
        <AppearIn>
          <EngagementSidecar did={identity.did} collection={collection} atUri={atUri} />
        </AppearIn>
      )}

      {/* Consolidated copy row, kept directly beneath the preview (rich post
          + record JSON) and above the contextual sections. URI elements live
          in the breadcrumb above, so we don't repeat them — every identifier
          is one tap away as a copy button. CID is omitted because the preview
          card already surfaces it visibly in its footer. */}
      <AppearIn delay={0.06}>
        <CopyRow
          atUri={atUri}
          did={identity.did}
          pds={identity.pds}
          universalLink={universalLinkFull}
          universalPath={aturiUniversalPath}
          recordJson={record ? JSON.stringify(record, null, 2) : null}
          pdsRecordUrl={getRecordUrl(identity.pds, {
            repo: identity.did,
            collection,
            rkey: decodedRkey,
          })}
        />
      </AppearIn>

      {/* Contextual usage of this record's lexicon across the atmosphere —
          a navigational hook into the dedicated lexicon explorer. Hidden
          when the record itself couldn't be loaded. For a lexicon-schema
          record the relevant lexicon is the one it DEFINES (the rkey/NSID),
          not the com.atproto.lexicon.schema collection itself. */}
      {!editing && !recordError && (
        <AppearIn delay={0.07}>
          <LexiconUsageCard
            collection={
              collection === 'com.atproto.lexicon.schema' ? decodedRkey : collection
            }
          />
        </AppearIn>
      )}

      {/* Backlinks — inbound references to this record, shown after its own
          identity/lexicon context. */}
      {!editing && (
        <AppearIn delay={0.08}>
          <BacklinksTab target={atUri} showSummary />
        </AppearIn>
      )}

      {/* Standalone Edit chip — for post / margin previews that don't have a
          place to slot the button into their layout, and as the fallback when
          the rich preview (which would host the generic record's footer Edit
          button) is collapsed. Read mode only. */}
      {(!editsInPreviewFooter || hideRich) && !editing && editButton && (
        <AppearIn delay={0.1}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            {editButton}
          </div>
        </AppearIn>
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

    </div>
  );
}

/**
 * Quiet text toggle used for the record page's view switches (hide/show the
 * rich preview, minimal/full post, show/hide raw JSON). Mirrors the repo
 * page's ProfileViewSwitch styling; callers own the persisted pref each one
 * flips and supply a state-dependent label.
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
        common — a lexicon can be widely adopted without a formal schema record
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
        fetching this record. It might be a temporary problem — try again in a
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
