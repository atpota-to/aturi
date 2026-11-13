'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import { Credit } from '@/components/explore/lexicons/primitives';
import { resolveHandle } from '@/utils/atproto/identity';
import { mapWithConcurrency, resolveMiniDoc } from '@/utils/atproto/slingshot';
import { fetchDidDocument, serviceEndpoint } from '@/lib/tools/didDocument';
import { handlesFromAlsoKnownAs } from '@/lib/tools/handle';
import {
  MAX_IDENTIFIERS,
  classifyRow,
  countRows,
  listForQuery,
  parseIdentifierList,
  pdsHost,
  pendingRow,
  rowStatus,
  rowsToCsv,
  rowsToJson,
  type IdentifierEntry,
  type ResolveOutcome,
  type ResolveRow,
} from '@/lib/tools/resolve';
import { toolHref } from '@/lib/tools/catalog';
import { ToolCard, ToolIntro, ToolSection, ToolShell, ToolTextForm } from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'resolve';

/**
 * Requests in flight at once. Enough that a few hundred identifiers finish
 * in well under a minute, few enough that Slingshot is not asked for all of
 * them in the same instant.
 */
const CONCURRENCY = 6;

/** Least time between two redraws of the table while rows are arriving. */
const PUBLISH_EVERY_MS = 150;

const EXAMPLES = [
  { label: 'Three handles', value: 'bsky.app\natproto.com\njay.bsky.team' },
  {
    label: 'A mixed list',
    value:
      '@bsky.app\ndid:plc:oky5czdrnfjpqslsw2a5iclo\nhttps://bsky.app/profile/atproto.com\nat://pfrazee.com\nnobody.example-missing.net\nnot_a_handle',
  },
];

/**
 * Resolve one identifier. Slingshot answers both directions in one request
 * and verifies a handle against its DID document, so it is asked first. It
 * only knows what it can reach, though, so a miss is put to the sources
 * directly before the row is called unresolved: the AppView and bsky.social
 * for the handle, then the DID document for the rest.
 */
async function resolveOne(entry: IdentifierEntry, signal: AbortSignal): Promise<ResolveOutcome | null> {
  const mini = await resolveMiniDoc(entry.value, signal);
  if (mini) return { did: mini.did, handle: mini.handle, pds: mini.pds || null };
  if (signal.aborted) return null;

  const did = entry.kind === 'did' ? entry.value : await resolveHandle(entry.value);
  if (!did || !did.startsWith('did:')) return null;
  try {
    const doc = await fetchDidDocument(did, signal);
    return {
      did,
      handle: handlesFromAlsoKnownAs(doc.alsoKnownAs)[0] ?? null,
      pds: serviceEndpoint(doc, '#atproto_pds'),
    };
  } catch {
    // A handle that names a DID nobody can find a document for still
    // resolved, as far as it goes. A DID with no document did not.
    return entry.kind === 'handle' ? { did, handle: null, pds: null } : null;
  }
}

async function resolveAll(
  entries: IdentifierEntry[],
  signal: AbortSignal,
  publish: (rows: ResolveRow[]) => void,
): Promise<ResolveRow[]> {
  let rows = entries.map(pendingRow);
  publish(rows);
  let lastPublish = Date.now();
  await mapWithConcurrency(entries, CONCURRENCY, async (entry, index) => {
    if (entry.kind === 'invalid' || signal.aborted) return;
    const outcome = await resolveOne(entry, signal).catch(() => null);
    if (signal.aborted) return;
    rows = rows.slice();
    rows[index] = classifyRow(entry, outcome);
    // A busy list settles several rows between frames; drawing each one
    // would redraw the whole table hundreds of times.
    if (Date.now() - lastPublish >= PUBLISH_EVERY_MS) {
      lastPublish = Date.now();
      publish(rows);
    }
  });
  return rows;
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Resolves a pasted list of handles and DIDs into a table. The parsing and
 * the export are in src/lib/tools/resolve.ts; this does the lookups and
 * draws the rows as they come in.
 */
export default function BulkResolver() {
  const [{ list }, setQuery] = useToolQuery(['list'] as const);
  // A list too long for the link is kept here instead, and is not shareable.
  const [held, setHeld] = useState<string | null>(null);
  const text = held ?? list;

  const parsed = parseIdentifierList(text);
  const { entries } = parsed;
  const key = entries.length ? entries.map((entry) => `${entry.kind}:${entry.value}`).join('|') : null;
  const run = useToolRun<ResolveRow[]>(key, ({ signal, publish }) => resolveAll(entries, signal, publish));

  const rows = run.data ?? entries.map(pendingRow);
  const counts = countRows(rows);
  const loading = run.status === 'loading';
  const shareable = entries.length > 0 && held === null;

  function submit(value: string) {
    const next = parseIdentifierList(value);
    const query = next.entries.length ? listForQuery(next.entries) : '';
    if (query === null) {
      setHeld(value);
      setQuery({ list: '' }, { replace: true });
    } else {
      setHeld(null);
      setQuery({ list: query });
    }
  }

  return (
    <ToolShell
      slug={SLUG}
      wide
      share={shareable ? `${toolHref(SLUG)}?list=${encodeURIComponent(list)}` : undefined}
      form={
        <ToolTextForm
          value={entries.map((entry) => entry.input).join('\n')}
          onSubmit={submit}
          label="Handles and DIDs to resolve"
          placeholder={'alice.example.com\ndid:plc:…\nhttps://bsky.app/profile/bob.example.com'}
          submitLabel="Resolve"
          busy={loading}
          rows={6}
          examples={EXAMPLES}
        />
      }
    >
      {entries.length > 0 && (
        <ToolSection
          title="Identities"
          meta={
            loading
              ? `${counts.settled.toLocaleString('en-US')} of ${counts.total.toLocaleString('en-US')} done`
              : [
                  `${counts.resolved.toLocaleString('en-US')} resolved`,
                  counts.flagged > 0 ? `${counts.flagged.toLocaleString('en-US')} flagged` : null,
                  counts.failed > 0 ? `${counts.failed.toLocaleString('en-US')} not resolved` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
        >
          <div className="fn-tool-bar fn-tool-resolve-bar">
            {loading ? (
              <div
                className="fn-tool-progress fn-tool-resolve-progress"
                role="progressbar"
                aria-label="Identifiers resolved"
                aria-valuemin={0}
                aria-valuemax={counts.total}
                aria-valuenow={counts.settled}
              >
                <span style={{ width: `${counts.total ? (counts.settled / counts.total) * 100 : 0}%` }} />
              </div>
            ) : (
              <p className="fn-tool-note">
                {held !== null
                  ? 'This list is too long to keep in the link, so it cannot be shared as one.'
                  : 'The list is kept in the link, so this table can be shared.'}
                {parsed.duplicates > 0 &&
                  ` ${parsed.duplicates.toLocaleString('en-US')} ${parsed.duplicates === 1 ? 'duplicate was' : 'duplicates were'} left out.`}
                {parsed.dropped > 0 &&
                  ` Only the first ${MAX_IDENTIFIERS} are resolved; ${parsed.dropped.toLocaleString('en-US')} more were left out.`}
              </p>
            )}
            <div className="fn-tool-bar-end">
              <CopyButton value={rowsToCsv(rows)} label="Copy CSV" compact />
              <CopyButton value={rowsToJson(rows)} label="Copy JSON" compact />
              <button
                type="button"
                className="fx-btn fx-btn-sm"
                disabled={loading}
                onClick={() => download('identities.csv', rowsToCsv(rows), 'text/csv;charset=utf-8')}
              >
                <Download size={13} aria-hidden /> Download CSV
              </button>
            </div>
          </div>

          <ToolCard flush>
            <div className="fn-tool-table-wrap">
              <table className="fn-tool-table fn-tool-resolve-table">
                <thead>
                  <tr>
                    <th scope="col">Input</th>
                    <th scope="col">DID</th>
                    <th scope="col">Handle</th>
                    <th scope="col">PDS</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <ResolveTableRow key={`${row.kind}:${row.value}`} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
            <Credit />
          </ToolCard>
        </ToolSection>
      )}

      {entries.length === 0 && (
        <ToolIntro
          title="What it does"
          items={[
            {
              term: 'Reads the list',
              text: (
                <>
                  Handles, DIDs, <code>@handles</code>, <code>at://</code> URIs and profile links, one per line or
                  separated by commas. Duplicates are dropped and the order is kept, up to {MAX_IDENTIFIERS}.
                </>
              ),
            },
            {
              term: 'Resolves each one',
              text: 'A handle to its DID and a DID to its handle, with the PDS the account lives on. A handle only counts when its DID points back at it.',
            },
            {
              term: 'Flags what is off',
              text: 'A handle that does not resolve, a DID with no handle, a handle that now belongs to a differently named account, and anything that is not an identifier at all.',
            },
            {
              term: 'Hands the table back',
              text: 'Copy it as CSV or JSON, or download the CSV. A short list is kept in the link, so the table can be shared.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

function ResolveTableRow({ row }: { row: ResolveRow }) {
  const status = rowStatus(row);
  const host = pdsHost(row.pds);
  return (
    <tr data-state={row.state}>
      <td data-mono>{row.input}</td>
      <td data-mono>
        {row.did ? (
          <Link href={`/explore/${row.did}`} prefetch={false}>
            {row.did}
          </Link>
        ) : (
          <Dash />
        )}
      </td>
      <td data-mono>{row.handle ? `@${row.handle}` : <Dash />}</td>
      <td data-mono>
        {host ? (
          <Link href={`/explore/pds/${encodeURIComponent(host)}`} prefetch={false}>
            {host}
          </Link>
        ) : (
          <Dash />
        )}
      </td>
      <td>
        <span className="fn-tool-resolve-status">
          <span className="fn-tool-pill" data-tone={status.tone}>
            {status.label}
          </span>
          {row.state === 'unresolved' && row.kind === 'handle' && (
            // One of these per failed row, each with its own query: left
            // unprefetched so a long list is not a burst of requests.
            <Link
              href={`${toolHref('handle')}?handle=${encodeURIComponent(row.value)}`}
              prefetch={false}
              className="fn-tool-resolve-debug"
            >
              Debug
            </Link>
          )}
        </span>
        {status.note && <span className="fn-tool-resolve-note">{status.note}</span>}
      </td>
    </tr>
  );
}

function Dash() {
  return (
    <span className="fn-tool-resolve-dash" aria-label="none">
      &ndash;
    </span>
  );
}
