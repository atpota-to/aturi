import { browser } from '#imports';

/**
 * Cross-context debug log backed by `chrome.storage.local`. Every entrypoint
 * (popup, options, background) writes into a single ring buffer keyed by
 * `LOG_KEY`, so the Dev tab in Settings can show events from the popup too.
 *
 * Keep this lightweight: it's a developer aid for testing the new-waypoints
 * banner and prefs migrations, not a structured logging stack. Don't sprinkle
 * it everywhere — log key state transitions only.
 */

const LOG_KEY = 'aturi.debug.log.v1';
const MAX_ENTRIES = 200;

export type LogLevel = 'log' | 'warn' | 'error';

export type LogEntry = {
  ts: number;
  ctx: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
};

type StorageArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function getLocalArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

let currentContext = 'unknown';

export function setLogContext(name: string): void {
  currentContext = name;
}

/**
 * Best-effort serialization so we don't reject events whose data contains
 * circular references or non-JSON values. Returns a plain string fallback
 * when JSON serialization fails.
 */
function safeData(data: unknown): unknown {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    try {
      return String(data);
    } catch {
      return '[unserializable]';
    }
  }
}

async function append(level: LogLevel, msg: string, data?: unknown): Promise<void> {
  const area = getLocalArea();
  if (!area) return;
  const entry: LogEntry = {
    ts: Date.now(),
    ctx: currentContext,
    level,
    msg,
    data: safeData(data),
  };
  try {
    const stored = await area.get(LOG_KEY);
    const list = Array.isArray(stored[LOG_KEY]) ? (stored[LOG_KEY] as LogEntry[]) : [];
    list.push(entry);
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    await area.set({ [LOG_KEY]: list });
  } catch {
    // Logging failures must never surface to callers.
  }
}

export function debugLog(msg: string, data?: unknown): void {
  void append('log', msg, data);
}

export function debugWarn(msg: string, data?: unknown): void {
  void append('warn', msg, data);
}

export function debugError(msg: string, data?: unknown): void {
  void append('error', msg, data);
}

export async function getDebugLog(): Promise<LogEntry[]> {
  const area = getLocalArea();
  if (!area) return [];
  try {
    const stored = await area.get(LOG_KEY);
    const list = stored[LOG_KEY];
    return Array.isArray(list) ? (list as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearDebugLog(): Promise<void> {
  const area = getLocalArea();
  if (!area) return;
  try {
    await area.set({ [LOG_KEY]: [] });
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to log changes across all contexts. The listener fires with the
 * new entries array whenever any context writes a log entry. Returns an
 * unsubscribe function.
 */
export function subscribeDebugLog(
  listener: (entries: LogEntry[]) => void
): () => void {
  if (typeof browser === 'undefined' || !browser.storage?.onChanged) {
    return () => undefined;
  }
  const handler = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string
  ) => {
    if (area !== 'local' || !changes[LOG_KEY]) return;
    const next = changes[LOG_KEY].newValue;
    listener(Array.isArray(next) ? (next as LogEntry[]) : []);
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}

export function formatLogEntry(entry: LogEntry): string {
  const ts = new Date(entry.ts).toISOString().slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const dataStr =
    entry.data === undefined ? '' : ` ${safeStringify(entry.data)}`;
  return `${ts} [${entry.ctx}] ${level} ${entry.msg}${dataStr}`;
}

export function formatDebugLog(entries: LogEntry[]): string {
  return entries.map(formatLogEntry).join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
