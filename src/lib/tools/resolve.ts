/**
 * The bulk identity resolver's logic: reading a pasted list into identifiers,
 * saying how each one came out, and writing the table back out.
 *
 * Lists arrive in every shape a spreadsheet, a chat message or a web page can
 * give them: one per line or run together with commas, with an @ in front,
 * as at:// URIs, as profile links. Each entry is read down to the one thing
 * that identifies an account, a DID or a handle, and anything that is
 * neither is kept in the table and marked, so nothing typed goes missing.
 *
 * Everything here is pure. The resolving is done by the page
 * (BulkResolver.tsx).
 */

import { handleSyntaxProblem, isDid } from './handle';

/** Most identifiers resolved in one go. Each is at least one request. */
export const MAX_IDENTIFIERS = 500;

/**
 * Longest list kept in the link. Past this the address gets unwieldy and
 * some clients cut it, so a longer list is resolved but not shareable.
 */
export const MAX_QUERY_LENGTH = 1500;

export type IdentifierEntry = {
  /** As typed, trimmed of the punctuation around it. */
  input: string;
  kind: 'did' | 'handle' | 'invalid';
  /** The DID, or the handle in lower case. For `invalid`, the input. */
  value: string;
  /** Why it was not read as an identifier. */
  reason?: string;
};

/** Read one entry of a list down to the DID or handle it names. */
export function readIdentifier(raw: string): IdentifierEntry {
  // Quotes and brackets come along from CSV cells and from prose.
  const input = raw.trim().replace(/^["'<([]+|["'>)\],.]+$/g, '');
  let value = input;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      // A profile link (bsky.app and every client that kept its routes)
      // names the account in its path; any other link names it by its host.
      const profile = url.pathname.match(/^\/profile\/([^/]+)/);
      value = profile ? decodeURIComponent(profile[1]) : url.hostname;
    } catch {
      return { input, kind: 'invalid', value: input, reason: 'Not a URL that could be read.' };
    }
  }
  value = value.replace(/^at:\/\//i, '').replace(/^@/, '').split('/')[0];

  if (/^did:/i.test(value)) {
    return isDid(value)
      ? { input, kind: 'did', value }
      : { input, kind: 'invalid', value: input, reason: 'Not a valid did:plc or did:web identifier.' };
  }
  const handle = value.replace(/\.$/, '').toLowerCase();
  const problem = handleSyntaxProblem(handle);
  return problem ? { input, kind: 'invalid', value: input, reason: problem } : { input, kind: 'handle', value: handle };
}

export type IdentifierList = {
  entries: IdentifierEntry[];
  /** Entries left out because the same identifier was already in the list. */
  duplicates: number;
  /** Entries left out because the list ran past the cap. */
  dropped: number;
};

/**
 * Split pasted text into identifiers: one per line, or separated by commas,
 * semicolons or spaces. The first mention of each is kept, in the order
 * given, up to `max`.
 */
export function parseIdentifierList(text: string, max = MAX_IDENTIFIERS): IdentifierList {
  const seen = new Set<string>();
  const entries: IdentifierEntry[] = [];
  let duplicates = 0;
  let dropped = 0;
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const entry = readIdentifier(token);
    if (!entry.input) continue;
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    if (entries.length >= max) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  return { entries, duplicates, dropped };
}

/** The list as it goes in the link, or null when it is too long to keep there. */
export function listForQuery(entries: IdentifierEntry[]): string | null {
  const joined = entries.map((entry) => (entry.kind === 'invalid' ? entry.input : entry.value)).join(',');
  return joined.length <= MAX_QUERY_LENGTH ? joined : null;
}

/* -------------------------------------------------------------------------- *
 * Rows
 * -------------------------------------------------------------------------- */

/** What a resolver found for one identifier. Null when it found nothing. */
export type ResolveOutcome = {
  did: string;
  /** The account's handle, `handle.invalid` when it does not verify, or null when it has none. */
  handle: string | null;
  /** The PDS endpoint, as a URL. */
  pds: string | null;
};

export type RowFlag =
  /** The DID document lists no handle. */
  | 'no-handle'
  /** The handle the DID lists does not point back at it. */
  | 'handle-invalid'
  /** A handle was given, and the DID it resolves to now goes by another. */
  | 'handle-differs'
  /** The DID document names no PDS. */
  | 'no-pds';

export type ResolveRow = IdentifierEntry & {
  state: 'pending' | 'resolved' | 'unresolved' | 'invalid';
  did: string | null;
  handle: string | null;
  pds: string | null;
  flags: RowFlag[];
};

export function pendingRow(entry: IdentifierEntry): ResolveRow {
  return {
    ...entry,
    state: entry.kind === 'invalid' ? 'invalid' : 'pending',
    did: null,
    handle: null,
    pds: null,
    flags: [],
  };
}

/** Turn what a resolver found into a row, with whatever is worth flagging about it. */
export function classifyRow(entry: IdentifierEntry, outcome: ResolveOutcome | null): ResolveRow {
  if (entry.kind === 'invalid') return pendingRow(entry);
  if (!outcome) return { ...entry, state: 'unresolved', did: null, handle: null, pds: null, flags: [] };

  const flags: RowFlag[] = [];
  const handle = outcome.handle ? outcome.handle.toLowerCase() : null;
  if (!handle) flags.push('no-handle');
  else if (handle === 'handle.invalid') flags.push('handle-invalid');
  else if (entry.kind === 'handle' && handle !== entry.value) flags.push('handle-differs');
  if (!outcome.pds) flags.push('no-pds');

  return {
    ...entry,
    state: 'resolved',
    did: outcome.did,
    handle: handle === 'handle.invalid' ? null : handle,
    pds: outcome.pds,
    flags,
  };
}

export type RowStatus = {
  tone?: 'pass' | 'warn' | 'fail';
  label: string;
  /** More to say than the label holds. */
  note?: string;
};

/** A row's outcome in a word or two, and a sentence when it needs one. */
export function rowStatus(row: ResolveRow): RowStatus {
  switch (row.state) {
    case 'pending':
      return { label: 'Resolving' };
    case 'invalid':
      return { tone: 'fail', label: 'Not an identifier', note: row.reason };
    case 'unresolved':
      return row.kind === 'handle'
        ? { tone: 'fail', label: 'Does not resolve', note: 'No DNS record or well-known file names a DID for this handle.' }
        : { tone: 'fail', label: 'DID not found', note: 'No DID document could be found for this DID.' };
    default:
      break;
  }
  if (row.flags.includes('handle-invalid')) {
    return { tone: 'warn', label: 'Handle not verified', note: 'The DID lists a handle that does not point back at it.' };
  }
  if (row.flags.includes('handle-differs')) {
    return { tone: 'warn', label: 'Handle differs', note: `This handle resolves to a DID that now goes by ${row.handle}.` };
  }
  if (row.flags.includes('no-handle')) {
    return { tone: 'warn', label: 'No handle', note: 'The DID document lists no handle.' };
  }
  if (row.flags.includes('no-pds')) {
    return { tone: 'warn', label: 'No PDS', note: 'The DID document names no PDS.' };
  }
  return { tone: 'pass', label: 'Resolved' };
}

/** The host of a PDS endpoint, for the table and the explorer link. */
export function pdsHost(pds: string | null): string | null {
  if (!pds) return null;
  try {
    return new URL(pds).host;
  } catch {
    return pds.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || null;
  }
}

export type RowCounts = { total: number; settled: number; resolved: number; failed: number; flagged: number };

export function countRows(rows: ResolveRow[]): RowCounts {
  const counts: RowCounts = { total: rows.length, settled: 0, resolved: 0, failed: 0, flagged: 0 };
  for (const row of rows) {
    if (row.state !== 'pending') counts.settled += 1;
    if (row.state === 'resolved') {
      counts.resolved += 1;
      if (row.flags.length > 0) counts.flagged += 1;
    } else if (row.state !== 'pending') {
      counts.failed += 1;
    }
  }
  return counts;
}

/* -------------------------------------------------------------------------- *
 * Export
 * -------------------------------------------------------------------------- */

const CSV_COLUMNS = ['input', 'did', 'handle', 'pds', 'status'] as const;

/**
 * One CSV cell. Quoted when it holds a comma, a quote or a line break, and
 * given a leading apostrophe when it starts with a character a spreadsheet
 * would run as a formula: the list is pasted from anywhere, and `@name` or
 * `=cmd` in a cell should stay text when the file is opened.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function rowsToCsv(rows: ResolveRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [row.input, row.did ?? '', row.handle ?? '', row.pds ?? '', rowStatus(row).label].map(csvCell).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function rowsToJson(rows: ResolveRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      input: row.input,
      did: row.did,
      handle: row.handle,
      pds: row.pds,
      status: rowStatus(row).label,
    })),
    null,
    2,
  );
}
