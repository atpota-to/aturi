import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Braces,
  Check,
  Clock,
  Compass,
  ExternalLink,
  Hash,
  Link as LinkIcon,
  RefreshCw,
  Server,
  Tag,
  Telescope,
} from 'lucide-react';
import { parseAtUri, encodeRepo, shortDid } from '@aturi/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@aturi/atproto/identity';
import { getRecord, getRecordUrl, type AtRecord } from '@aturi/atproto/pdsClient';
import { getPostThread } from '@aturi/atproto/appview';
import { previewFor } from '@aturi/atproto/previewExtractors';
import { pdsHostname } from '@aturi/atproto/pdsServer';
import {
  flattenSources,
  getBacklinkSources,
} from '@aturi/atproto/constellation';
import { type Prefs } from '../../lib/prefs';
import type { DetectedAtUri } from '../../lib/inspectScanner';
import {
  ATURI_BASE,
  buildExplorePdsUrl,
  buildUniversalLink,
} from '../../lib/aturiUrl';
import type { UseInspectScanResult } from '../../lib/inspectScan';
import {
  loadInspectRecentRepos,
  type InspectRepoEntry,
} from '../../lib/inspectHistory';

type Props = {
  prefs: Prefs;
  /**
   * Scan state lifted up to <App /> so the popup-mode tab can badge
   * the detected count even while the user is still on the Waypoints
   * tab. We just render whatever the hook gave us.
   */
  scan: UseInspectScanResult;
};

/**
 * Inspect tab. Surfaces detected AT URIs from the active page with the
 * same data depth + visual language as the web explorer at aturi.to.
 * The page scan itself is owned by <App />; this view is a
 * presentational renderer for the lifted scan state.
 */
export default function InspectView({ prefs, scan }: Props) {
  const { hits, scanning, error: scanError, rescan } = scan;
  return (
    <div className="popup-root inspect-root">
      {/* The count heading only makes sense once there is something to
          count; the empty state carries its own heading. */}
      {hits.length > 0 && (
        <div className="inspect-head">
          <h2 className="popup-section-label">
            {hits.length} {plural(hits.length, 'AT URI', 'AT URIs')} on this page
          </h2>
          <button
            type="button"
            className="inspect-rescan"
            onClick={() => rescan()}
            disabled={scanning}
          >
            <RefreshCw size={13} aria-hidden />
            {scanning ? 'Scanning…' : 'Scan again'}
          </button>
        </div>
      )}

      {/* The same skeleton as the empty state, so the icon and title do
          not jump when the scan lands on nothing. */}
      {scanning && hits.length === 0 && (
        <div className="inspect-empty" aria-busy="true">
          <span className="popup-notice-icon" aria-hidden="true">
            <Activity size={21} />
          </span>
          <h1 className="popup-notice-title">Scanning…</h1>
        </div>
      )}

      {!scanning && hits.length === 0 && (
        <InspectEmptyState
          onRescan={() => rescan()}
          historyEnabled={prefs.historyEnabled}
        />
      )}

      {hits.map((hit) => (
        <InspectCard key={`${hit.uri}-${hit.where}`} hit={hit} />
      ))}

      {scanError && (
        <div className="popup-alert">
          <div className="popup-alert-title">Scan error</div>
          <div>{scanError}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown when the scan finished but found nothing. Offers the user two
 * forward paths instead of a dead-end "Scan again" button:
 *   1. A primary CTA into the Atmosphere explorer at aturi.to/explore.
 *   2. A list of frequently-seen repos pulled from local history so they
 *      can jump straight into the Explorer for someone they've recently
 *      come across, even though this page has nothing to inspect.
 *
 * The original rescan affordance is still here as a small ghost action.
 */
function InspectEmptyState({
  onRescan,
  historyEnabled,
}: {
  onRescan: () => void;
  historyEnabled: boolean;
}) {
  const [recents, setRecents] = useState<InspectRepoEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!historyEnabled) {
      setRecents([]);
      return undefined;
    }
    void (async () => {
      const list = await loadInspectRecentRepos();
      if (!cancelled) setRecents(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [historyEnabled]);

  const topRecents = (recents ?? []).slice(0, 6);

  return (
    <div className="inspect-empty">
      <span className="popup-notice-icon" aria-hidden="true">
        <Telescope size={21} />
      </span>
      {/* Same heading treatment as the Waypoints view's "No Atmosphere data
          on this page". */}
      <h1 className="popup-notice-title">No AT URIs detected on this page</h1>

      <a
        href={`${ATURI_BASE}/explore`}
        target="_blank"
        rel="noreferrer"
        className="aturi-btn aturi-btn-primary inspect-empty-cta"
        onClick={() => {
          window.setTimeout(() => window.close(), 50);
        }}
      >
        <Compass size={14} aria-hidden />
        Open Aturi Explorer
      </a>

      {topRecents.length > 0 && (
        <div className="inspect-empty-recents">
          <div className="inspect-empty-recents-label">
            <Clock size={10} aria-hidden /> Frequently seen
          </div>
          <div className="inspect-empty-recents-list">
            {topRecents.map((entry) => (
              <RecentRepoChip key={entry.repo} entry={entry} />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="inspect-empty-rescan"
        onClick={onRescan}
      >
        <RefreshCw size={11} aria-hidden />
        Scan this page again
      </button>
    </div>
  );
}

function RecentRepoChip({ entry }: { entry: InspectRepoEntry }) {
  const href = `${ATURI_BASE}/explore/${encodeRepo(entry.repo)}`;
  const label = entry.repo.startsWith('did:') ? shortDid(entry.repo) : entry.repo;
  const title = `Open ${entry.repo} in the Atmosphere explorer (seen ${entry.count}×)`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inspect-empty-recent"
      title={title}
      onClick={() => {
        window.setTimeout(() => window.close(), 50);
      }}
    >
      <span className="inspect-empty-recent-label">{label}</span>
      {entry.count > 1 && (
        <span className="inspect-empty-recent-count" aria-hidden>
          {entry.count}
        </span>
      )}
      <ExternalLink size={10} aria-hidden className="inspect-empty-recent-icon" />
    </a>
  );
}

type Resolution = {
  identity: IdentityBundle | null;
  record: AtRecord | null;
  error: string | null;
};

type Engagement = {
  replies?: number;
  reposts?: number;
  likes?: number;
  quotes?: number;
};

function InspectCard({ hit }: { hit: DetectedAtUri }) {
  const parsed = useMemo(() => parseAtUri(hit.uri), [hit.uri]);
  const [resolution, setResolution] = useState<Resolution>({
    identity: null,
    record: null,
    error: null,
  });
  const [backlinkCount, setBacklinkCount] = useState<number | null>(null);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!parsed) return undefined;
    setResolution({ identity: null, record: null, error: null });
    setBacklinkCount(null);
    setEngagement(null);
    (async () => {
      try {
        const identity = await resolveIdentifier(parsed.repo);
        if (cancelled.current) return;
        setResolution((prev) => ({ ...prev, identity }));
        if (parsed.collection && parsed.rkey) {
          try {
            const record = await getRecord(identity.pds, {
              repo: identity.did,
              collection: parsed.collection,
              rkey: parsed.rkey,
            });
            if (cancelled.current) return;
            setResolution((prev) => ({ ...prev, record }));
          } catch {
            /* not fatal */
          }
        }
      } catch (err) {
        if (cancelled.current) return;
        setResolution((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
    (async () => {
      const raw = await getBacklinkSources(hit.uri);
      if (cancelled.current) return;
      const flat = flattenSources(raw);
      if (!flat) return;
      setBacklinkCount(flat.reduce((acc, s) => acc + (s.count || 0), 0));
    })();
    // Engagement counts — only for post-shaped collections. Fails silently
    // (some posts have been deleted, some collections aren't post-shaped).
    if (parsed.collection === 'app.bsky.feed.post' && parsed.rkey) {
      (async () => {
        const thread = await getPostThread(hit.uri);
        if (cancelled.current) return;
        const post = thread?.thread?.post;
        if (!post) return;
        setEngagement({
          replies: post.replyCount,
          reposts: post.repostCount,
          likes: post.likeCount,
          quotes: post.quoteCount,
        });
      })();
    }
    return () => {
      cancelled.current = true;
    };
  }, [parsed, hit.uri]);

  const identity = resolution.identity;
  const record = resolution.record;
  const preview = record ? previewFor(record.value) : '';

  const handleOrDid = identity?.handle || identity?.did || parsed?.repo || '';
  const repoSegment = encodeRepo(handleOrDid);

  const repoExplorerUrl = handleOrDid ? `${ATURI_BASE}/explore/${repoSegment}` : null;
  const collectionExplorerUrl =
    handleOrDid && parsed?.collection
      ? `${ATURI_BASE}/explore/${repoSegment}/${parsed.collection}`
      : null;
  const recordExplorerUrl =
    handleOrDid && parsed?.collection && parsed?.rkey
      ? `${ATURI_BASE}/explore/${repoSegment}/${parsed.collection}/${encodeURIComponent(parsed.rkey)}`
      : null;

  // The primary CTA always picks the deepest available explorer route.
  const primaryExplorerUrl = recordExplorerUrl || collectionExplorerUrl || repoExplorerUrl;

  const effectivePds = identity?.pds || null;
  const effectivePdsHost = effectivePds ? pdsHostname(effectivePds) : null;
  const pdsExplorerUrl = effectivePdsHost ? buildExplorePdsUrl(effectivePdsHost) : null;
  const effectiveDid = identity?.did || (parsed?.repo.startsWith('did:') ? parsed.repo : null);
  // Direct PDS XRPC URL for the record — opens the raw JSON in a new
  // tab. Only available once we know the repo + collection + rkey AND
  // we've resolved (or were given) the PDS host.
  const pdsRecordUrl =
    effectivePds && effectiveDid && parsed?.collection && parsed?.rkey
      ? getRecordUrl(effectivePds, {
          repo: effectiveDid,
          collection: parsed.collection,
          rkey: parsed.rkey,
        })
      : null;

  const universalLink =
    handleOrDid && parsed?.collection && parsed?.rkey
      ? buildUniversalLink(handleOrDid, parsed.collection, parsed.rkey)
      : null;

  return (
    <article className="inspect-card">
      <div className="inspect-card-top">
        {/* Where the URI came from. AT Tags hits carry the relation the
            page declared (at:canonical / at:author / …) instead. */}
        {hit.relation ? (
          <span
            className="inspect-relation"
            title={`Declared by this page via AT Tags: at:${hit.relation}`}
          >
            <Tag size={10} aria-hidden />
            {hit.relation}
          </span>
        ) : (
          <span className={`inspect-where ${hit.where === 'url' ? 'is-url' : ''}`}>
            {WHERE_LABEL[hit.where] ?? hit.where}
          </span>
        )}
        {parsed?.collection && COLLECTION_LABEL[parsed.collection] && (
          <span className="inspect-kind">{COLLECTION_LABEL[parsed.collection]}</span>
        )}
      </div>

      {/* Breadcrumb: PDS host / @handle / collection / rkey. Each segment
          is a deep link into the explorer at the appropriate depth. */}
      <nav className="inspect-breadcrumb" aria-label="Record path">
        {effectivePdsHost && pdsExplorerUrl && (
          <>
            <BreadcrumbSegment href={pdsExplorerUrl} label={effectivePdsHost} kind="pds" />
            <BreadcrumbSeparator />
          </>
        )}
        {handleOrDid && repoExplorerUrl && (
          <>
            <BreadcrumbSegment
              href={repoExplorerUrl}
              label={identity?.handle ? `@${identity.handle}` : handleOrDid}
              kind="handle"
            />
            {parsed?.collection && <BreadcrumbSeparator />}
          </>
        )}
        {parsed?.collection && collectionExplorerUrl && (
          <>
            <BreadcrumbSegment
              href={collectionExplorerUrl}
              label={parsed.collection}
              kind="collection"
            />
            {parsed.rkey && <BreadcrumbSeparator />}
          </>
        )}
        {parsed?.rkey && (
          <span className="inspect-breadcrumb-segment is-rkey" title={parsed.rkey}>
            {parsed.rkey}
          </span>
        )}
      </nav>

      {hit.sample && <div className="inspect-sample">“{hit.sample}”</div>}

      {preview && <div className="inspect-preview">{preview}</div>}

      {(engagement || (backlinkCount !== null && backlinkCount > 0)) && (
        <EngagementRow engagement={engagement} backlinkCount={backlinkCount} />
      )}

      {resolution.error && <div className="inspect-error">{resolution.error}</div>}

      <div className="inspect-copy-row">
        <span className="inspect-copy-label">Copy</span>
        <CopyChip label="AT URI" icon={<LinkIcon size={11} />} value={hit.uri} />
        {effectiveDid && (
          <CopyChip label="DID" icon={<Hash size={11} />} value={effectiveDid} />
        )}
        {effectivePds && (
          <CopyChip label="PDS" icon={<Server size={11} />} value={effectivePds} />
        )}
        {universalLink && (
          <CopyChip
            label="Link"
            icon={<LinkIcon size={11} />}
            value={universalLink}
          />
        )}
        {record && (
          <CopyChip
            label="JSON"
            icon={<Hash size={11} />}
            value={JSON.stringify(record, null, 2)}
          />
        )}
      </div>

      {record && (
        <details className="inspect-json">
          <summary>Raw record JSON</summary>
          <pre className="inspect-json-pre">{JSON.stringify(record.value, null, 2)}</pre>
        </details>
      )}

      {/* Footer: the CID and the two PDS links share a row, and the
          Explorer link runs full width beneath them. Every link leads with
          an icon. The labels say where each one goes: the PDS's own page in
          the Aturi Explorer, and this record's JSON served by the PDS. */}
      <div className="inspect-footer">
        {(record?.cid || pdsExplorerUrl || pdsRecordUrl) && (
          <div className="inspect-footer-meta">
            {record?.cid && (
              <CopyChip
                label={`cid ${shortCid(record.cid)}`}
                icon={<Hash size={11} />}
                value={record.cid}
                variant="ghost"
              />
            )}
            {(pdsExplorerUrl || pdsRecordUrl) && (
              <div className="inspect-footer-links">
                {pdsExplorerUrl && (
                  <a
                    href={pdsExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inspect-footer-link"
                    title={`Inspect the PDS ${effectivePdsHost} in the Aturi Explorer`}
                    onClick={() => {
                      window.setTimeout(() => window.close(), 50);
                    }}
                  >
                    <Server size={11} aria-hidden /> PDS in Explorer
                  </a>
                )}
                {pdsRecordUrl && (
                  <a
                    href={pdsRecordUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inspect-footer-link"
                    title="Open this record's raw JSON, straight from the PDS"
                    onClick={() => {
                      window.setTimeout(() => window.close(), 50);
                    }}
                  >
                    <Braces size={11} aria-hidden /> Raw JSON
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {primaryExplorerUrl && (
          <a
            href={primaryExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inspect-cta"
            onClick={() => {
              window.setTimeout(() => window.close(), 50);
            }}
          >
            <Compass size={13} aria-hidden /> Open in Explorer
          </a>
        )}
      </div>
    </article>
  );
}

const WHERE_LABEL: Record<string, string> = {
  url: 'In the address bar',
  'at-tags': 'Declared by the page',
  head: 'In the page head',
  meta: 'In a meta tag',
  link: 'Linked on the page',
  jsonld: 'In structured data',
  text: 'In the page text',
};

const COLLECTION_LABEL: Record<string, string> = {
  'app.bsky.feed.post': 'Bluesky post',
  'app.bsky.actor.profile': 'Profile',
  'app.bsky.graph.list': 'List',
  'app.bsky.feed.generator': 'Feed',
  'app.bsky.graph.starterpack': 'Starter pack',
};

function BreadcrumbSegment({
  href,
  label,
  icon,
  kind,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  kind: 'pds' | 'handle' | 'collection';
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inspect-breadcrumb-segment is-${kind}`}
      title={label}
      onClick={() => {
        window.setTimeout(() => window.close(), 50);
      }}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
}

function BreadcrumbSeparator() {
  return (
    <span aria-hidden className="inspect-breadcrumb-sep">
      /
    </span>
  );
}

function EngagementRow({
  engagement,
  backlinkCount,
}: {
  engagement: Engagement | null;
  backlinkCount: number | null;
}) {
  const items: Array<{ key: string; value: number; label: string; short?: string }> = [];
  if (engagement?.replies != null)
    items.push({
      key: 'replies',
      value: engagement.replies,
      label: plural(engagement.replies, 'reply', 'replies'),
    });
  if (engagement?.reposts != null)
    items.push({
      key: 'reposts',
      value: engagement.reposts,
      label: plural(engagement.reposts, 'repost', 'reposts'),
    });
  if (engagement?.likes != null)
    items.push({
      key: 'likes',
      value: engagement.likes,
      label: plural(engagement.likes, 'like', 'likes'),
    });
  if (engagement?.quotes != null)
    items.push({
      key: 'quotes',
      value: engagement.quotes,
      label: plural(engagement.quotes, 'quote', 'quotes'),
    });
  if (backlinkCount != null && backlinkCount > 0)
    items.push({
      key: 'inbound',
      value: backlinkCount,
      label: `${plural(backlinkCount, 'inbound link', 'inbound links')} across the Atmosphere`,
      short: plural(backlinkCount, 'link in', 'links in'),
    });
  if (items.length === 0) return null;
  return (
    <div className="inspect-engagement">
      {items.map((it) => (
        <span key={it.key} className="inspect-engagement-item" title={it.label}>
          <strong>{it.value.toLocaleString()}</strong> {it.short ?? it.label}
        </span>
      ))}
    </div>
  );
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

function CopyChip({
  label,
  icon,
  value,
  variant = 'subtle',
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  variant?: 'subtle' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`inspect-chip is-${variant} ${copied ? 'is-copied' : ''}`}
      onClick={async () => {
        await writeToClipboard(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      title={copied ? 'Copied!' : label}
      aria-label={copied ? 'Copied' : undefined}
    >
      {copied ? <Check size={11} aria-hidden /> : icon}
      <span className="inspect-chip-label">{label}</span>
    </button>
  );
}

/** Singular for a count of exactly 1, plural otherwise (0 likes, 1 like). */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function shortCid(cid: string): string {
  if (cid.length <= 12) return cid;
  return `${cid.slice(0, 6)}…${cid.slice(-4)}`;
}
