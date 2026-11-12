'use client';

import Link from 'next/link';
import { AtSign, Check, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { APPVIEW } from '@/utils/atproto/config';
import { describeRepo, getRepoStatus } from '@/utils/atproto/pdsClient';
import { fetchDidDocument } from '@/lib/tools/didDocument';
import {
  buildHandleChecks,
  handleVerdict,
  normalizeHandleInput,
  pdsEndpointFrom,
  resolvedDid,
  type HandleEvidence,
  type HandleProbe,
} from '@/lib/tools/handle';
import { toolHref } from '@/lib/tools/catalog';
import { CheckList, type CheckItem } from './Checks';
import { ToolError, ToolFact, ToolFacts, ToolForm, ToolIntro, ToolSection, ToolShell, ToolCard, ToolVerdict } from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'handle';
const EXAMPLES = [{ value: 'bsky.app' }, { value: 'atproto.com' }, { value: 'aturi.to' }];

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Gather the evidence for one handle, publishing as each part arrives so the
 * list fills in step by step. Nothing here throws for a failed lookup: a step
 * that could not be made is evidence too, and is recorded as `null`.
 */
async function investigate(
  handle: string,
  signal: AbortSignal,
  publish: (evidence: HandleEvidence) => void,
): Promise<HandleEvidence> {
  let evidence: HandleEvidence = { handle };
  const update = (patch: Partial<HandleEvidence>) => {
    evidence = { ...evidence, ...patch };
    publish(evidence);
  };
  publish(evidence);

  try {
    const res = await fetch(`/api/tools/handle?handle=${encodeURIComponent(handle)}`, { signal });
    const body = (await res.json()) as ({ ok: true } & HandleProbe) | { ok: false; error: string };
    if (!body.ok) throw new Error(body.error);
    update({ probe: body });
  } catch (err) {
    if (signal.aborted) throw err;
    update({ probe: null, probeError: 'The lookup service did not answer. Try again in a moment.' });
    return evidence;
  }

  const did = resolvedDid(evidence.probe);
  if (!did) return evidence;

  try {
    update({ document: await fetchDidDocument(did, signal) });
  } catch (err) {
    if (signal.aborted) throw err;
    update({ document: null, documentError: err instanceof Error ? err.message : undefined });
    return evidence;
  }

  const endpoint = pdsEndpointFrom(evidence.document)?.replace(/\/$/, '') ?? null;
  await Promise.all([
    (async () => {
      if (!endpoint) return;
      try {
        const [repo, status] = await Promise.all([
          describeRepo(endpoint, did).catch(() => null),
          getRepoStatus(endpoint, did).catch(() => null),
        ]);
        if (signal.aborted) return;
        update({
          pds:
            repo || status
              ? {
                  endpoint,
                  reachable: true,
                  handle: repo?.handle,
                  handleIsCorrect: repo?.handleIsCorrect,
                  active: status?.active,
                  status: status?.status,
                }
              : { endpoint, reachable: false },
        });
      } catch {
        if (!signal.aborted) update({ pds: { endpoint, reachable: false } });
      }
    })(),
    (async () => {
      try {
        const profile = await json<{ handle?: string }>(
          `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
          signal,
        );
        update({ appview: { handle: profile.handle } });
      } catch (err) {
        if (!signal.aborted) update({ appview: { error: err instanceof Error ? err.message : 'no answer' } });
      }
    })(),
  ]);
  return evidence;
}

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

/**
 * Checks a handle in both directions and says which step fails.
 * The logic is in src/lib/tools/handle.ts; this gathers the evidence and
 * draws it.
 */
export default function HandleDebugger() {
  const [{ handle: raw }, setQuery] = useToolQuery(['handle'] as const);
  const input = raw ? normalizeHandleInput(raw) : null;
  const handle = input?.ok ? input.handle : null;

  const run = useToolRun<HandleEvidence>(handle, ({ signal, publish }) =>
    investigate(handle as string, signal, publish),
  );

  const evidence = run.data ?? (handle ? { handle } : null);
  const checks = evidence ? buildHandleChecks(evidence) : [];
  const verdict = evidence ? handleVerdict(evidence, checks) : null;
  const items: CheckItem[] = checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
    fix: check.fix?.map((line, index) => <p key={index}>{line}</p>),
  }));
  const document = run.data?.document;

  return (
    <ToolShell
      slug={SLUG}
      share={handle ? `${toolHref(SLUG)}?handle=${encodeURIComponent(handle)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ handle: value })}
          label="Handle to check"
          placeholder="alice.example.com"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          icon={<AtSign size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}

      {verdict && evidence && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          <ToolSection
            title="Checks"
            meta={
              run.status === 'loading' ? (
                'Checking…'
              ) : (
                <button type="button" className="fn-tool-link" onClick={run.rerun}>
                  Check again
                </button>
              )
            }
          >
            <CheckList checks={items} label={`Checks for ${evidence.handle}`} />
          </ToolSection>

          {verdict.did && (
            <ToolSection title="Identity">
              <ToolCard>
                <ToolFacts>
                  <ToolFact label="Handle" copy={evidence.handle}>
                    {evidence.handle}
                  </ToolFact>
                  <ToolFact label="DID" copy={verdict.did}>
                    {verdict.did}
                  </ToolFact>
                  {pdsEndpointFrom(document) && (
                    <ToolFact label="PDS">
                      <Link
                        href={`/explore/pds/${encodeURIComponent(
                          (pdsEndpointFrom(document) as string).replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        )}`}
                        prefetch={false}
                      >
                        {(pdsEndpointFrom(document) as string).replace(/^https?:\/\//, '')}
                      </Link>
                    </ToolFact>
                  )}
                </ToolFacts>
                <div className="fn-tool-actions">
                  <Link href={`/explore/${verdict.did}`} prefetch={false} className="fx-btn fx-btn-sm">
                    Open in the Explorer
                  </Link>
                </div>
              </ToolCard>
            </ToolSection>
          )}
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'The domain names a DID',
              text: (
                <>
                  A TXT record at <code>_atproto.&lt;handle&gt;</code>, or a text file at{' '}
                  <code>/.well-known/atproto-did</code>. Either is enough; both are read.
                </>
              ),
            },
            {
              term: 'The DID claims the domain',
              text: (
                <>
                  The DID document has to list <code>at://&lt;handle&gt;</code> first under{' '}
                  <code>alsoKnownAs</code>. Without it, apps show <code>handle.invalid</code>.
                </>
              ),
            },
            {
              term: 'The account is reachable',
              text: 'Its PDS answers for the repository, reports it active, and agrees about the handle.',
            },
            {
              term: 'Bluesky has caught up',
              text: 'The AppView keeps its own copy of each handle, which can lag behind a change.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
