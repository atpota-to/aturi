'use client';

import { useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { Download, FileArchive, FileUp, LoaderCircle } from 'lucide-react';
import { getRepoUrl } from '@/utils/atproto/pdsClient';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { tidToDate } from '@/utils/atproto/tid';
import { verifyBlockHashes } from '@/lib/tools/car';
import { archiveChecks, type HashProgress } from '@/lib/tools/carChecks';
import { MAX_ARCHIVE_BYTES, formatBytes } from '@/lib/tools/carFormat';
import { openArchive, type OpenProgress, type RepoArchive } from '@/lib/tools/carRepo';
import { toolHref } from '@/lib/tools/catalog';
import CarInspectorBrowser from './CarInspectorBrowser';
import { CheckList } from './Checks';
import { ToolCard, ToolError, ToolFact, ToolFacts, ToolForm, ToolIntro, ToolSection, ToolShell, ToolSkeleton } from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'car';
// Two small repositories, so trying the tool costs under a megabyte.
const EXAMPLES = [{ value: 'aturi.to' }, { value: 'atproto.com' }];

const countFormat = new Intl.NumberFormat('en-US');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Where an archive comes from: a file off this computer, or an account's PDS. */
type Source =
  | { id: number; kind: 'file'; file: File }
  | { id: number; kind: 'account'; actor: string; identity: IdentityBundle };

type Loading =
  | { phase: 'download'; received: number }
  | { phase: 'open'; progress: OpenProgress | null; size: number }
  | { phase: 'ready'; archive: RepoArchive; name: string };

/** A handle or DID out of what was typed: `@name`, an at:// URI, or a profile link. */
function actorFromInput(raw: string): string {
  const text = raw.trim();
  const profile = text.match(/^https?:\/\/[^/]+\/profile\/([^/?#]+)/i);
  if (profile) return decodeURIComponent(profile[1]);
  return text.replace(/^at:\/\//i, '').replace(/^@/, '').split('/')[0];
}

const TOO_LARGE = `Exports over ${formatBytes(MAX_ARCHIVE_BYTES)} are not opened here. The file is held whole in this page’s memory, and a larger one would exhaust it.`;

/**
 * Fetch an account's export from its PDS, counting bytes as they arrive.
 * The PDS sends no length up front, so the cap is enforced on the way: past
 * it the download is dropped rather than left to fill memory.
 */
async function download(
  identity: IdentityBundle,
  signal: AbortSignal,
  onProgress: (received: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(getRepoUrl(identity.pds, identity.did), { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    const reason = body?.message || body?.error;
    throw new Error(
      `The PDS would not send the export${reason ? `: ${reason}` : ''} (HTTP ${res.status}).`,
    );
  }
  if (Number(res.headers.get('content-length') ?? 0) > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.length > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
    return whole;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(TOO_LARGE);
    }
    // Often enough to read as live, not so often that every chunk is a render.
    const now = performance.now();
    if (now - reported > 120) {
      reported = now;
      onProgress(received);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function load(
  source: Source,
  signal: AbortSignal,
  publish: (state: Loading) => void,
): Promise<Loading> {
  let bytes: Uint8Array;
  let name: string;
  if (source.kind === 'file') {
    if (source.file.size > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
    publish({ phase: 'open', progress: null, size: source.file.size });
    bytes = new Uint8Array(await source.file.arrayBuffer());
    name = source.file.name;
  } else {
    publish({ phase: 'download', received: 0 });
    bytes = await download(source.identity, signal, (received) => publish({ phase: 'download', received }));
    name = `${(source.identity.handle ?? source.identity.did).replace(/[^a-zA-Z0-9.-]/g, '-')}.car`;
  }
  publish({ phase: 'open', progress: null, size: bytes.length });
  // A beat for "Reading the archive" to be drawn before the first slice is read.
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const archive = await openArchive(bytes, {
    signal,
    onProgress: (progress) => publish({ phase: 'open', progress, size: bytes.length }),
  });
  return { phase: 'ready', archive, name };
}

/** The line under the heading while an archive is on its way in. */
function LoadingCard({ state, onStop }: { state: Loading | undefined; onStop: () => void }) {
  let title = 'Fetching the export';
  let text = 'Asking the PDS for the repository.';
  let fraction: number | null = null;
  if (state?.phase === 'download') {
    text = `${formatBytes(state.received)} so far. The PDS does not say how large the export is until it ends.`;
  } else if (state?.phase === 'open') {
    title = 'Reading the archive';
    if (state.progress?.phase === 'tree') {
      text = `${countFormat.format(state.progress.records)} records listed so far.`;
      fraction = 1;
    } else {
      const done = state.progress?.done ?? 0;
      text = `${formatBytes(done)} of ${formatBytes(state.size)} read.`;
      fraction = state.size > 0 ? done / state.size : 0;
    }
  }
  return (
    <ToolCard className="fn-tool-car-loading">
      <div className="fn-tool-car-loading-head">
        <LoaderCircle size={18} aria-hidden className="fn-tool-spin" />
        <div role="status">
          <strong>{title}</strong>
          <p>{text}</p>
        </div>
        <button type="button" className="fx-btn fx-btn-sm" onClick={onStop}>
          Stop
        </button>
      </div>
      {fraction !== null && (
        <div className="fn-tool-progress" aria-hidden>
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
    </ToolCard>
  );
}

function CommitCard({ archive }: { archive: RepoArchive }) {
  const { commit, car } = archive;
  const written = tidToDate(commit.rev);
  return (
    <ToolCard>
      <ToolFacts>
        <ToolFact label="Repository" copy={commit.did}>
          <Link href={`/explore/${commit.did}`} prefetch={false} rel="nofollow">
            {commit.did}
          </Link>
        </ToolFact>
        <ToolFact label="Revision" copy={commit.rev}>
          {commit.rev || 'none'}
        </ToolFact>
        <ToolFact label="Last written" plain>
          {written ? dateFormat.format(written) : 'The revision is not a timestamp'}
        </ToolFact>
        <ToolFact label="Format version">{commit.version}</ToolFact>
        <ToolFact label="Records" plain>
          {countFormat.format(archive.recordCount)} in {countFormat.format(archive.collections.length)}{' '}
          {archive.collections.length === 1 ? 'collection' : 'collections'}
        </ToolFact>
        <ToolFact label="Blocks" plain>
          {countFormat.format(car.blocks.size)}, of which {countFormat.format(archive.nodeCount)} are tree nodes
        </ToolFact>
        <ToolFact label="File size" plain>
          {formatBytes(car.size)}
        </ToolFact>
        <ToolFact label="Previous commit" plain={!commit.prev} copy={commit.prev ?? undefined}>
          {commit.prev ?? 'None named'}
        </ToolFact>
        <ToolFact label="Commit" copy={commit.cid} wide>
          {commit.cid}
        </ToolFact>
        <ToolFact label="Tree root" copy={commit.data} wide>
          {commit.data}
        </ToolFact>
      </ToolFacts>
    </ToolCard>
  );
}

/** What the opened archive holds: its commit, how sound it is, and its records. */
function Archive({ archive, name, sourceId }: { archive: RepoArchive; name: string; sourceId: number }) {
  // Asked for per archive: a new one starts unchecked.
  const [hashing, setHashing] = useState(0);
  const hashRun = useToolRun<HashProgress>(hashing > 0 ? `${sourceId}:${hashing}` : null, async ({ signal, publish }) => {
    const result = await verifyBlockHashes(archive.car, {
      signal,
      onProgress: (done, total) => publish({ state: 'running', done, total }),
    });
    return { state: 'done', result };
  });
  const hashes: HashProgress =
    hashRun.status === 'done'
      ? hashRun.data
      : hashRun.status === 'loading'
        ? (hashRun.data ?? { state: 'running', done: 0, total: archive.car.blocks.size })
        : { state: 'idle' };

  const checks = archiveChecks(archive, hashes).map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line) => <div key={line}>{line}</div>),
  }));

  return (
    <>
      <ToolSection title="Commit" meta={name}>
        <CommitCard archive={archive} />
      </ToolSection>

      <ToolSection
        title="Integrity"
        meta={
          hashRun.status === 'loading' ? (
            <button type="button" className="fn-tool-link" onClick={() => setHashing(0)}>
              Stop
            </button>
          ) : (
            <button type="button" className="fn-tool-link" onClick={() => setHashing(hashing + 1)}>
              {hashRun.status === 'done' ? 'Check hashes again' : 'Check block hashes'}
            </button>
          )
        }
      >
        <CheckList checks={checks} label="Integrity of the archive" />
      </ToolSection>

      <CarInspectorBrowser archive={archive} name={name} />
    </>
  );
}

/**
 * Opens a repository export in the browser. The reading is in
 * src/lib/tools: cbor.ts (the block format), car.ts (the file), carRepo.ts
 * (the commit and the tree).
 *
 * An account in the link is looked up but not fetched: an export can run to
 * many megabytes, and a shared link should not start that download on its
 * own. A file from disk never touches the link at all.
 */
export default function CarInspector() {
  const [{ actor: rawActor }, setQuery] = useToolQuery(['actor'] as const);
  const actor = rawActor ? actorFromInput(rawActor) : '';
  const [source, setSource] = useState<Source | null>(null);
  const [over, setOver] = useState(false);
  const nextId = useRef(1);

  const account = useToolRun<IdentityBundle>(actor || null, () => resolveIdentifier(actor));

  // A fetched archive belongs to the account it was fetched for; once the
  // link names another, it is no longer what the page is about.
  const active = source && (source.kind === 'file' || source.actor === actor) ? source : null;
  const loading = useToolRun<Loading>(active ? String(active.id) : null, ({ signal, publish }) =>
    load(active as Source, signal, publish),
  );

  function openFile(file: File | undefined) {
    if (!file) return;
    setSource({ id: nextId.current++, kind: 'file', file });
    setQuery({ actor: '' }, { replace: true });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    openFile(event.dataTransfer.files[0]);
  }

  const ready = loading.status === 'done' && loading.data.phase === 'ready' ? loading.data : null;

  return (
    <ToolShell
      slug={SLUG}
      wide
      share={actor ? `${toolHref(SLUG)}?actor=${encodeURIComponent(actor)}` : undefined}
      form={
        <>
          <ToolForm
            value={rawActor}
            onSubmit={(value) => {
              setSource(null);
              setQuery({ actor: value });
            }}
            label="Account whose export to open"
            placeholder="alice.example.com or did:plc:…"
            submitLabel="Look up"
            busy={account.status === 'loading'}
            examples={EXAMPLES}
            icon={<FileArchive size={17} />}
          />
          <div
            className="fn-tool-car-file"
            data-over={over || undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <FileUp size={16} aria-hidden />
            <p>
              Or open a <code>.car</code> file from this computer: drop it here or choose it. It is read in this page
              and never uploaded.
            </p>
            <label className="fx-btn fx-btn-sm fn-tool-car-pick">
              <input
                type="file"
                accept=".car,application/vnd.ipld.car"
                className="fn-sr-only"
                onChange={(event) => {
                  openFile(event.target.files?.[0]);
                  // So choosing the same file again is still a change.
                  event.target.value = '';
                }}
              />
              Choose a file
            </label>
          </div>
        </>
      }
    >
      {!active && actor && account.status === 'loading' && <ToolSkeleton rows={2} />}
      {!active && actor && account.status === 'error' && (
        <ToolError onRetry={account.rerun}>
          {actor} could not be found. Check the handle or DID, or try again in a moment.
        </ToolError>
      )}
      {!active && account.status === 'done' && (
        <ToolSection title="Account">
          <ToolCard>
            <ToolFacts>
              <ToolFact label="Handle" copy={account.data.handle ?? undefined} plain={!account.data.handle}>
                {account.data.handle ?? 'None'}
              </ToolFact>
              <ToolFact label="DID" copy={account.data.did}>
                <Link href={`/explore/${account.data.did}`} prefetch={false} rel="nofollow">
                  {account.data.did}
                </Link>
              </ToolFact>
              <ToolFact label="PDS">{pdsHostname(account.data.pds)}</ToolFact>
            </ToolFacts>
            {account.data.repoStatus && (
              <p className="fn-tool-note fn-tool-car-status">
                The PDS reports this repository as {account.data.repoStatus.status ?? 'inactive'}, so it may refuse to
                send the export.
              </p>
            )}
            <div className="fn-tool-actions fn-tool-car-go">
              <button
                type="button"
                className="fn-searchbox-submit"
                onClick={() =>
                  setSource({ id: nextId.current++, kind: 'account', actor, identity: account.data })
                }
              >
                Fetch the export
              </button>
              <a href={getRepoUrl(account.data.pds, account.data.did)} className="fx-btn" download>
                <Download size={14} aria-hidden /> Save the .car file instead
              </a>
              <p className="fn-tool-note">
                The export is every record in the repository in one file, which can run to many megabytes. It is
                fetched straight from the PDS into this page; up to {formatBytes(MAX_ARCHIVE_BYTES)} can be opened.
              </p>
            </div>
          </ToolCard>
        </ToolSection>
      )}

      {active && loading.status === 'loading' && (
        <LoadingCard state={loading.data} onStop={() => setSource(null)} />
      )}
      {active && loading.status === 'error' && (
        <ToolError onRetry={loading.rerun}>{loading.error}</ToolError>
      )}
      {active && ready && <Archive key={active.id} archive={ready.archive} name={ready.name} sourceId={active.id} />}

      {!active && !actor && (
        <ToolIntro
          title="What it shows"
          items={[
            {
              term: 'The commit',
              text: 'Whose repository this is, when it was last written, and the root of the tree that holds everything else.',
            },
            {
              term: 'Every record',
              text: 'The tree is walked to list each collection and record key, and a record is decoded when it is opened. Any of it can be saved as JSON.',
            },
            {
              term: 'Whether the file is sound',
              text: 'Parts of the tree that are missing, records it lists but does not hold, and, when asked, whether every block still hashes to its address.',
            },
            {
              term: 'What it leaves out',
              text: 'The commit’s signature is not verified, and blobs are not in an export: images and video appear as links, not files.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
