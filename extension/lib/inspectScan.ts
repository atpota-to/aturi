/**
 * Centralized "scan the active tab for AT URIs" logic. Used by the
 * popup's Inspect tab to render hits AND by the popup header to badge
 * the tab with a detected-URI count even before the user clicks into
 * the Inspect view.
 *
 * The scan itself is a pure async function — no React, no setState —
 * so it can be called from anywhere. The `useInspectScan` hook adds
 * a thin React layer that runs the scan once on mount and exposes a
 * `rescan()` to retry on demand.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { browser } from '#imports';
import { matchSupportedUrl } from '@aturi/reverseParsers';
import { dedupeByUri, type DetectedAtUri } from './inspectScanner';
import { recordInspectHits } from './inspectHistory';
import { loadPrefs } from './prefs';

export type ActiveTab = { url?: string; id?: number; active?: boolean; [k: string]: unknown };

async function getActiveTab(): Promise<ActiveTab | null> {
  try {
    const tabs = (await browser.tabs.query({ active: true, lastFocusedWindow: true })) as unknown as
      | ActiveTab[]
      | undefined;
    return tabs?.[0] ?? null;
  } catch {
    return null;
  }
}

export type ScanOutcome = {
  hits: DetectedAtUri[];
  tab: ActiveTab | null;
  /** Optional warning surfaced by the content script — non-fatal. */
  error: string | null;
};

/**
 * One-shot scan of the active tab. Combines a URL-pattern match (cheap,
 * always-on) with a content-script DOM scan (sites we don't have a URL
 * recipe for, but that embed at:// URIs in head / meta / link / text).
 *
 * Returns even on partial failure — a missing content script just means
 * the URL-match path is the only signal we have.
 */
export async function scanForAtUris(): Promise<ScanOutcome> {
  const t = await getActiveTab();
  const out: DetectedAtUri[] = [];
  let error: string | null = null;

  if (t?.url) {
    try {
      const url = new URL(t.url);
      const match = matchSupportedUrl(url);
      if (match?.parsed.uri) {
        out.push({ uri: match.parsed.uri, where: 'url' });
      }
    } catch {
      /* ignore — non-URL tab (e.g. about:blank) */
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
        // Surface but don't escalate — the URL match alone may still be
        // useful and the popup should still render.
        console.warn('[aturi:inspect] scan reported error:', response.error);
        error = response.error;
      }
    } catch (err) {
      // Content script unreachable on chrome:// / about: / browser-internal
      // pages. Not fatal — just means no DOM-derived hits.
      console.warn('[aturi:inspect] content script unreachable', err);
    }
  }

  const hits = dedupeByUri(out);

  // Persist the repos we just saw so the empty-state on the next "no URIs
  // here" page can recommend them. Gated on the same `historyEnabled` pref
  // that controls the waypoint recents list.
  if (hits.length > 0) {
    try {
      const prefs = await loadPrefs();
      if (prefs.historyEnabled) {
        void recordInspectHits(hits);
      }
    } catch {
      /* prefs read shouldn't block the scan returning */
    }
  }

  return { hits, tab: t, error };
}

export type UseInspectScanResult = {
  hits: DetectedAtUri[];
  tab: ActiveTab | null;
  scanning: boolean;
  error: string | null;
  rescan: () => void;
};

/**
 * Runs `scanForAtUris` once on mount. Re-running is opt-in via
 * `rescan()` (e.g. the popup's "Scan again" button).
 */
export function useInspectScan(): UseInspectScanResult {
  const [hits, setHits] = useState<DetectedAtUri[]>([]);
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic generation counter so a slow scan that races with a newer
  // `rescan()` (or with unmount) can drop its result on the floor.
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const rescan = useCallback(() => {
    const gen = ++generationRef.current;
    setScanning(true);
    setError(null);
    void (async () => {
      const result = await scanForAtUris();
      if (!mountedRef.current || gen !== generationRef.current) return;
      setHits(result.hits);
      setTab(result.tab);
      setError(result.error);
      setScanning(false);
    })();
  }, []);

  useEffect(() => {
    rescan();
    return () => {
      mountedRef.current = false;
    };
  }, [rescan]);

  return { hits, tab, scanning, error, rescan };
}
