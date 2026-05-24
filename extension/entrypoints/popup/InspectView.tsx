import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  Hash,
  Link as LinkIcon,
  RefreshCw,
  Server,
  Telescope,
} from 'lucide-react';
import { parseAtUri } from '@aturi/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@aturi/atproto/identity';
import { getRecord, type AtRecord } from '@aturi/atproto/pdsClient';
import { previewFor } from '@aturi/atproto/previewExtractors';
import { pdsHostname } from '@aturi/atproto/pdsServer';
import {
  flattenSources,
  getBacklinkSources,
} from '@aturi/atproto/constellation';
import { matchSupportedUrl } from '@aturi/reverseParsers';
import { type Prefs } from '../../lib/prefs';
import type { DetectedAtUri } from '../../lib/inspectScanner';
import { buildExploreUrl, buildExplorePdsUrl } from '../../lib/aturiUrl';
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
 * The new Inspect tab. Scans the current page for AT URIs and surfaces
 * underlying PDS data with copy / "open in explorer" tools.
 */
export default function InspectView(_props: Props) {
  void _props;
  const [tab, setTab] = useState<AnyTab | null>(null);
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

      // 1. URL-pattern match — the page itself is a known atmosphere app.
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

      // 2. Ask the inspect-scan content script for in-page hits.
      const tabId = (t?.id as number | undefined) ?? null;
      if (tabId != null) {
        try {
          const response = (await browser.tabs.sendMessage(tabId, {
            type: 'aturi:inspect-scan',
          })) as { atUris?: DetectedAtUri[]; error?: string } | undefined;
          if (response?.atUris) out.push(...response.atUris);
          if (response?.error) {
            // Not fatal — we still show URL hits if any.
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
            <InspectCard key={`${hit.uri}-${hit.where}`} hit={hit} pds={null} />
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

function InspectCard({ hit, pds }: { hit: DetectedAtUri; pds: string | null }) {
  const parsed = useMemo(() => parseAtUri(hit.uri), [hit.uri]);
  const [resolution, setResolution] = useState<Resolution>({
    identity: null,
    record: null,
    error: null,
  });
  const [backlinkCount, setBacklinkCount] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!parsed) return undefined;
    setResolution({ identity: null, record: null, error: null });
    setBacklinkCount(null);
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
            /* not fatal — the URI may point at a deleted record */
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
    // Backlinks lookup runs in parallel with identity resolution — it
    // hits Constellation directly with the AT URI, no PDS hop needed.
    (async () => {
      const raw = await getBacklinkSources(hit.uri);
      if (cancelled.current) return;
      const flat = flattenSources(raw);
      if (!flat) return;
      setBacklinkCount(flat.reduce((acc, s) => acc + (s.count || 0), 0));
    })();
    return () => {
      cancelled.current = true;
    };
  }, [parsed, hit.uri]);

  const identity = resolution.identity;
  const record = resolution.record;
  const preview = record ? previewFor(record.value) : '';
  const explorerUrl = parsed
    ? buildExploreUrl(
        identity?.handle || identity?.did || parsed.repo,
        parsed.collection,
        parsed.rkey,
      )
    : null;
  const effectivePds = pds || identity?.pds || null;
  const effectivePdsHost = effectivePds ? pdsHostname(effectivePds) : null;
  const pdsExplorerUrl = effectivePdsHost ? buildExplorePdsUrl(effectivePdsHost) : null;
  const effectiveDid = identity?.did || (parsed?.repo.startsWith('did:') ? parsed.repo : null);

  return (
    <div
      className="popup-waypoint"
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: 10,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          flexWrap: 'wrap',
        }}
      >
        <span className="aturi-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {hit.where}
        </span>
        {identity?.handle && (
          <span style={{ color: 'var(--popup-text)', fontWeight: 500 }}>@{identity.handle}</span>
        )}
        {parsed?.collection && (
          <span style={{ fontFamily: 'monospace', color: 'var(--popup-accent)', fontSize: 10 }}>
            {parsed.collection}
          </span>
        )}
        {backlinkCount !== null && backlinkCount > 0 && (
          <span
            className="aturi-subtle"
            title="Inbound links across the Atmosphere (via Constellation)"
            style={{ fontSize: 10 }}
          >
            · {backlinkCount.toLocaleString()} inbound
          </span>
        )}
      </div>

      <code
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--popup-text)',
          wordBreak: 'break-all',
          background: 'var(--popup-bg-elevated, transparent)',
          padding: '4px 6px',
          borderRadius: 0,
        }}
      >
        {hit.uri}
      </code>

      {hit.sample && (
        <div className="aturi-subtle" style={{ fontSize: 11, fontStyle: 'italic' }}>
          “{hit.sample}”
        </div>
      )}

      {preview && (
        <div style={{ fontSize: 12, color: 'var(--popup-text)' }}>{preview}</div>
      )}

      {resolution.error && (
        <div className="aturi-subtle" style={{ fontSize: 11, color: 'var(--popup-danger, #d97070)' }}>
          {resolution.error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <CopyChip label="Copy AT URI" icon={<LinkIcon size={11} />} value={hit.uri} />
        {record && (
          <CopyChip
            label="Copy JSON"
            icon={<Hash size={11} />}
            value={JSON.stringify(record, null, 2)}
          />
        )}
        {effectivePds && (
          <CopyChip
            label="Copy PDS"
            icon={<Server size={11} />}
            value={effectivePds}
          />
        )}
        {effectiveDid && (
          <CopyChip
            label="Copy DID"
            icon={<Hash size={11} />}
            value={effectiveDid}
          />
        )}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="aturi-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              textDecoration: 'none',
              padding: '3px 8px',
            }}
            onClick={() => {
              // Close the popup after the user navigates so they land on the
              // page instead of having the popup hover over their new tab.
              window.setTimeout(() => window.close(), 50);
            }}
          >
            <ExternalLink size={11} />
            Open in Explorer
          </a>
        )}
        {pdsExplorerUrl && (
          <a
            href={pdsExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="aturi-btn"
            title={`Inspect ${effectivePdsHost} on aturi.to`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              textDecoration: 'none',
              padding: '3px 8px',
            }}
            onClick={() => {
              window.setTimeout(() => window.close(), 50);
            }}
          >
            <Server size={11} />
            Open PDS
          </a>
        )}
      </div>
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
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="aturi-btn"
      onClick={async () => {
        await writeToClipboard(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        padding: '3px 8px',
      }}
      title={copied ? 'Copied!' : label}
    >
      {copied ? <Check size={11} /> : icon}
      {copied ? 'Copied' : label}
    </button>
  );
}
