import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import {
  Activity,
  Check,
  ChevronRight,
  ExternalLink,
  Heart,
  Hash,
  Link as LinkIcon,
  MessageCircle,
  Network,
  Quote,
  RefreshCw,
  Repeat2,
  Server,
  Telescope,
} from 'lucide-react';
import { parseAtUri, encodeRepo } from '@aturi/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@aturi/atproto/identity';
import { getRecord, getRecordUrl, type AtRecord } from '@aturi/atproto/pdsClient';
import { getPostThread } from '@aturi/atproto/appview';
import { previewFor } from '@aturi/atproto/previewExtractors';
import { pdsHostname } from '@aturi/atproto/pdsServer';
import {
  flattenSources,
  getBacklinkSources,
} from '@aturi/atproto/constellation';
import { matchSupportedUrl } from '@aturi/reverseParsers';
import { type Prefs } from '../../lib/prefs';
import type { DetectedAtUri } from '../../lib/inspectScanner';
import {
  ATURI_BASE,
  buildExplorePdsUrl,
  buildUniversalLink,
} from '../../lib/aturiUrl';
import { dedupeByUri } from '../../lib/inspectScanner';

type Props = {
  prefs: Prefs;
};

type AnyTab = { url?: string; id?: number; active?: boolean; [k: string]: unknown };

async function getActiveTab(): Promise<AnyTab | null> {
  try {
    const tabs = (await browser.tabs.query({ active: true, lastFocusedWindow: true })) as unknown as
      | AnyTab[]
      | undefined;
    return tabs?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Inspect tab. Scans the current page for AT URIs and surfaces them with
 * the same data depth + visual language as the web explorer at aturi.to.
 */
export default function InspectView(_props: Props) {
  void _props;
  const [, setTab] = useState<AnyTab | null>(null);
  const [scanning, setScanning] = useState(true);
  const [hits, setHits] = useState<DetectedAtUri[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const runScan = useMemo(
    () => async () => {
      setScanning(true);
      setScanError(null);
      const t = await getActiveTab();
      setTab(t);
      const out: DetectedAtUri[] = [];

      if (t?.url) {
        try {
          const url = new URL(t.url);
          const match = matchSupportedUrl(url);
          if (match?.parsed.uri) {
            out.push({ uri: match.parsed.uri, where: 'url' });
          }
        } catch {
          /* ignore */
        }
      }

      const tabId = (t?.id as number | undefined) ?? null;
      if (tabId != null) {
        try {
          const response = (await browser.tabs.sendMessage(tabId, {
            type: 'aturi:inspect-scan',
          })) as { atUris?: DetectedAtUri[]; error?: string } | undefined;
          if (response?.atUris) out.push(...response.atUris);
          if (response?.error) {
            console.warn('[aturi:inspect] scan reported error:', response.error);
          }
        } catch (err) {
          console.warn('[aturi:inspect] content script unreachable', err);
        }
      }

      setHits(dedupeByUri(out));
      setScanning(false);
    },
    [],
  );

  useEffect(() => {
    void runScan();
  }, [runScan]);

  return (
    <div className="popup-section">
      <div className="popup-section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Telescope size={12} aria-hidden /> Detected AT URIs on this page
      </div>

      {scanning && hits.length === 0 && (
        <div className="popup-empty">
          <Activity size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Scanning…
        </div>
      )}

      {!scanning && hits.length === 0 && (
        <div className="popup-empty">
          <div style={{ marginBottom: 8 }}>No AT URIs detected on this page.</div>
          <button
            type="button"
            className="aturi-btn"
            onClick={() => void runScan()}
          >
            <RefreshCw size={12} aria-hidden style={{ marginRight: 4 }} />
            Scan again
          </button>
        </div>
      )}

      {hits.length > 0 && (
        <>
          {hits.map((hit) => (
            <InspectCard key={`${hit.uri}-${hit.where}`} hit={hit} />
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              className="aturi-btn"
              onClick={() => void runScan()}
              style={{ fontSize: 11 }}
              disabled={scanning}
            >
              <RefreshCw size={11} aria-hidden style={{ marginRight: 4 }} />
              {scanning ? 'Scanning…' : 'Scan again'}
            </button>
          </div>
        </>
      )}

      {scanError && (
        <div className="popup-notice">
          <div className="popup-notice-title">Scan error</div>
          <div>{scanError}</div>
        </div>
      )}
    </div>
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
    <div className="inspect-card">
      {/* Breadcrumb: PDS host › @handle › collection › rkey. Each segment
          is a deep link into the explorer at the appropriate depth. */}
      <div className="inspect-breadcrumb">
        {effectivePdsHost && pdsExplorerUrl && (
          <>
            <BreadcrumbSegment
              href={pdsExplorerUrl}
              label={effectivePdsHost}
              icon={<Server size={10} aria-hidden />}
              kind="pds"
            />
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
      </div>

      {/* Card body — everything below the breadcrumb. Wrapped so the
          breadcrumb above can read as a distinct attached header
          (different background, bottom border) instead of just another
          row in a uniform stack. */}
      <div className="inspect-card-body">
      {hit.sample && (
        <div className="aturi-subtle" style={{ fontSize: 11, fontStyle: 'italic' }}>
          “{hit.sample}”
        </div>
      )}

      {preview && (
        <div className="inspect-preview">{preview}</div>
      )}

      {(engagement || (backlinkCount !== null && backlinkCount > 0)) && (
        <EngagementRow engagement={engagement} backlinkCount={backlinkCount} />
      )}

      {resolution.error && (
        <div className="aturi-subtle" style={{ fontSize: 11, color: 'var(--danger, #d97070)' }}>
          {resolution.error}
        </div>
      )}

      {/* Primary CTA. Full-width, accent color, visually dominant. */}
      {primaryExplorerUrl && (
        <a
          href={primaryExplorerUrl}
          target="_blank"
          rel="noreferrer"
          className="aturi-btn aturi-btn-primary inspect-cta"
          onClick={() => {
            window.setTimeout(() => window.close(), 50);
          }}
        >
          <ExternalLink size={12} aria-hidden />
          Open in Explorer
        </a>
      )}

      {/* Compact copy chips. Subtle, secondary to the CTA above. */}
      <div className="inspect-copy-row">
        <span className="inspect-copy-label">Copy</span>
        <CopyChip label="AT URI" icon={<LinkIcon size={10} />} value={hit.uri} />
        {effectiveDid && (
          <CopyChip label="DID" icon={<Hash size={10} />} value={effectiveDid} />
        )}
        {effectivePds && (
          <CopyChip label="PDS" icon={<Server size={10} />} value={effectivePds} />
        )}
        {universalLink && (
          <CopyChip
            label="Universal link"
            icon={<LinkIcon size={10} />}
            value={universalLink}
          />
        )}
        {record && (
          <CopyChip
            label="JSON"
            icon={<Hash size={10} />}
            value={JSON.stringify(record, null, 2)}
          />
        )}
      </div>

      {/* Footer: raw JSON disclosure + CID + secondary PDS links. */}
      {(record || pdsExplorerUrl || pdsRecordUrl) && (
        <div className="inspect-footer">
          {record && (
            <details className="inspect-json">
              <summary>Raw record JSON</summary>
              <pre className="inspect-json-pre">
                {JSON.stringify(record.value, null, 2)}
              </pre>
            </details>
          )}
          <div className="inspect-footer-meta">
            {record?.cid && (
              <CopyChip
                label={`cid: ${shortCid(record.cid)}`}
                icon={<Hash size={10} />}
                value={record.cid}
                variant="ghost"
              />
            )}
            {pdsExplorerUrl && (
              <a
                href={pdsExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inspect-footer-link"
                title={`Inspect ${effectivePdsHost} on aturi.to`}
                onClick={() => {
                  window.setTimeout(() => window.close(), 50);
                }}
              >
                <Server size={10} aria-hidden /> Open PDS
              </a>
            )}
            {pdsRecordUrl && (
              <a
                href={pdsRecordUrl}
                target="_blank"
                rel="noreferrer"
                className="inspect-footer-link"
                title="Open the raw record JSON on the PDS"
                onClick={() => {
                  window.setTimeout(() => window.close(), 50);
                }}
              >
                <ExternalLink size={10} aria-hidden /> View on PDS
              </a>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

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
  return <ChevronRight size={10} aria-hidden className="inspect-breadcrumb-sep" />;
}

function EngagementRow({
  engagement,
  backlinkCount,
}: {
  engagement: Engagement | null;
  backlinkCount: number | null;
}) {
  const items: Array<{ key: string; icon: React.ReactNode; value: number; label: string }> = [];
  if (engagement?.replies != null)
    items.push({ key: 'replies', icon: <MessageCircle size={11} />, value: engagement.replies, label: 'replies' });
  if (engagement?.reposts != null)
    items.push({ key: 'reposts', icon: <Repeat2 size={11} />, value: engagement.reposts, label: 'reposts' });
  if (engagement?.likes != null)
    items.push({ key: 'likes', icon: <Heart size={11} />, value: engagement.likes, label: 'likes' });
  if (engagement?.quotes != null)
    items.push({ key: 'quotes', icon: <Quote size={11} />, value: engagement.quotes, label: 'quotes' });
  if (backlinkCount != null && backlinkCount > 0)
    items.push({
      key: 'inbound',
      icon: <Network size={11} />,
      value: backlinkCount,
      label: 'inbound links across the Atmosphere',
    });
  if (items.length === 0) return null;
  return (
    <div className="inspect-engagement">
      {items.map((it) => (
        <span key={it.key} className="inspect-engagement-item" title={it.label}>
          {it.icon}
          {it.value.toLocaleString()}
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
    >
      {copied ? <Check size={10} /> : icon}
      {copied ? 'Copied' : label}
    </button>
  );
}

function shortCid(cid: string): string {
  if (cid.length <= 12) return cid;
  return `${cid.slice(0, 6)}…${cid.slice(-4)}`;
}
