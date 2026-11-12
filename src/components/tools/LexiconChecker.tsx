'use client';

import Link from 'next/link';
import { Braces, Check, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { DOH_RESOLVER } from '@/utils/atproto/config';
import { resolveMiniDoc } from '@/utils/atproto/slingshot';
import { fetchDidDocument } from '@/lib/tools/didDocument';
import { pdsEndpointFrom } from '@/lib/tools/handle';
import {
  LEXICON_SCHEMA_COLLECTION,
  buildLexiconChecks,
  conventionHandle,
  foundSchema,
  lexiconVerdict,
  normalizeNsidInput,
  nsidAuthority,
  parentAuthorities,
  readLexiconRecords,
  readTxtAnswer,
  schemaRecordUri,
  type LexiconEvidence,
  type RecordProbe,
  type TxtProbe,
} from '@/lib/tools/lexicon';
import { toolHref } from '@/lib/tools/catalog';
import { CheckList, type CheckItem } from './Checks';
import {
  ToolCard,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolJson,
  ToolSection,
  ToolShell,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'lexicon';
const EXAMPLES = [
  { value: 'app.bsky.feed.post' },
  { value: 'site.standard.document' },
  { value: 'community.lexicon.calendar.event' },
];

/** One TXT lookup over DNS-over-HTTPS, as the explorer's own lexicon lookups make it. */
async function lookupTxt(name: string, signal: AbortSignal): Promise<TxtProbe> {
  try {
    const res = await fetch(`${DOH_RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`, {
      signal,
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) return { name, status: 'error', records: [], error: `the resolver answered HTTP ${res.status}` };
    return readTxtAnswer(name, await res.json());
  } catch (err) {
    if (signal.aborted) throw err;
    return { name, status: 'error', records: [], error: 'the resolver did not answer' };
  }
}

/**
 * Ask a PDS for the schema record itself. A 400 naming RecordNotFound is the
 * PDS saying it has no such record, which is an answer; anything else that
 * is not a 200 means it could not be asked.
 */
async function readSchemaRecord(pds: string, did: string, nsid: string, signal: AbortSignal): Promise<RecordProbe> {
  const base = pds.replace(/\/$/, '');
  const params = new URLSearchParams({ repo: did, collection: LEXICON_SCHEMA_COLLECTION, rkey: nsid });
  try {
    const res = await fetch(`${base}/xrpc/com.atproto.repo.getRecord?${params}`, { signal });
    const body = (await res.json().catch(() => null)) as
      | { uri?: string; cid?: string; value?: unknown; error?: string }
      | null;
    if (res.ok && body?.value !== undefined) {
      return { status: 'found', pds: base, uri: body.uri ?? schemaRecordUri(did, nsid), cid: body.cid, value: body.value };
    }
    if (body?.error === 'RecordNotFound') return { status: 'missing', pds: base };
    return { status: 'error', pds: base, error: body?.error ? `${body.error} (HTTP ${res.status})` : `HTTP ${res.status}` };
  } catch (err) {
    if (signal.aborted) throw err;
    return { status: 'error', pds: base, error: 'the PDS did not answer' };
  }
}

/**
 * Walk the publishing chain for one NSID, publishing as each link is read so
 * the list fills in step by step. A link that could not be read is evidence
 * too, and is recorded rather than thrown.
 */
async function investigate(
  nsid: string,
  signal: AbortSignal,
  publish: (evidence: LexiconEvidence) => void,
): Promise<LexiconEvidence> {
  let evidence: LexiconEvidence = { nsid };
  const update = (patch: Partial<LexiconEvidence>) => {
    evidence = { ...evidence, ...patch };
    publish(evidence);
  };
  publish(evidence);

  const { domain } = nsidAuthority(nsid);
  const dns = await lookupTxt(`_lexicon.${domain}`, signal);
  const did = readLexiconRecords(dns.records).did;

  if (!did) {
    // Nothing usable at the authority. Two more things are worth knowing
    // before saying so: whether a record sits one level too high, and
    // whether the explorer's handle convention finds a schema anyway.
    const handle = conventionHandle(nsid);
    const [parents, mini] = await Promise.all([
      Promise.all(
        parentAuthorities(domain).map(async (parent) => {
          const probe = await lookupTxt(`_lexicon.${parent}`, signal);
          const parentDid = readLexiconRecords(probe.records).did;
          return parentDid ? { name: probe.name, did: parentDid } : null;
        }),
      ),
      resolveMiniDoc(handle, signal),
    ]);
    const record = mini?.pds ? await readSchemaRecord(mini.pds, mini.did, nsid, signal) : null;
    update({
      dns,
      parents: parents.filter((p): p is { name: string; did: string } => p !== null),
      convention: { handle, did: mini?.did ?? null, record },
    });
    return evidence;
  }
  update({ dns });

  try {
    update({ document: await fetchDidDocument(did, signal) });
  } catch (err) {
    if (signal.aborted) throw err;
    update({ document: null, documentError: err instanceof Error ? err.message : undefined });
    return evidence;
  }

  const endpoint = pdsEndpointFrom(evidence.document);
  if (!endpoint) return evidence;
  update({ record: await readSchemaRecord(endpoint, did, nsid, signal) });
  return evidence;
}

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

/**
 * Follows an NSID from its DNS record to the schema record behind it and
 * says where the chain breaks. The logic is in src/lib/tools/lexicon.ts;
 * this gathers the evidence and draws it.
 */
export default function LexiconChecker() {
  const [{ nsid: raw }, setQuery] = useToolQuery(['nsid'] as const);
  const input = raw ? normalizeNsidInput(raw) : null;
  const nsid = input?.ok ? input.nsid : null;

  const run = useToolRun<LexiconEvidence>(nsid, ({ signal, publish }) =>
    investigate(nsid as string, signal, publish),
  );

  const evidence = run.data ?? (nsid ? { nsid } : null);
  const checks = evidence ? buildLexiconChecks(evidence) : [];
  const verdict = evidence ? lexiconVerdict(evidence, checks) : null;
  const items: CheckItem[] = checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
    fix: check.fix?.map((line, index) => <p key={index}>{line}</p>),
  }));
  const schema = run.data ? foundSchema(run.data) : null;

  return (
    <ToolShell
      slug={SLUG}
      share={nsid ? `${toolHref(SLUG)}?nsid=${encodeURIComponent(nsid)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ nsid: value })}
          label="NSID to check"
          placeholder="com.example.thing"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          mono
          icon={<Braces size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && <ToolError onRetry={run.rerun}>The check could not be finished: {run.error}</ToolError>}

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
            <CheckList checks={items} label={`Checks for ${evidence.nsid}`} />
          </ToolSection>

          {schema && (
            <ToolSection
              title="Schema record"
              meta={schema.via === 'convention' ? 'Found by the handle convention' : 'Found by the DNS record'}
            >
              <ToolCard>
                <ToolFacts>
                  <ToolFact label="NSID" copy={evidence.nsid}>
                    {evidence.nsid}
                  </ToolFact>
                  <ToolFact label="Authority" copy={`_lexicon.${nsidAuthority(evidence.nsid).domain}`}>
                    _lexicon.{nsidAuthority(evidence.nsid).domain}
                  </ToolFact>
                  <ToolFact label="Repository" copy={schema.did}>
                    <Link href={`/explore/${schema.did}`} prefetch={false}>
                      {schema.did}
                    </Link>
                  </ToolFact>
                  <ToolFact label="Record" copy={schema.record.uri} wide>
                    {schema.record.uri}
                  </ToolFact>
                  {schema.record.cid && (
                    <ToolFact label="CID" copy={schema.record.cid} wide>
                      {schema.record.cid}
                    </ToolFact>
                  )}
                </ToolFacts>
                <div className="fn-tool-lexicon-doc">
                  <ToolJson value={schema.record.value} label="schema" />
                </div>
                <div className="fn-tool-actions">
                  <Link
                    href={`/explore/lexicons/${encodeURIComponent(evidence.nsid)}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open in the lexicons explorer
                  </Link>
                  <Link
                    href={`/explore/${schema.did}/${LEXICON_SCHEMA_COLLECTION}/${encodeURIComponent(evidence.nsid)}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open the record
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
              term: 'The NSID names an authority',
              text: (
                <>
                  Drop the last part and reverse the rest: <code>app.bsky.feed.post</code> is published under{' '}
                  <code>feed.bsky.app</code>.
                </>
              ),
            },
            {
              term: 'The authority names a repository',
              text: (
                <>
                  A TXT record at <code>_lexicon.&lt;authority&gt;</code> holds <code>did=&lt;DID&gt;</code>. Each
                  authority needs its own: a record on the domain above it is not consulted.
                </>
              ),
            },
            {
              term: 'The repository holds the schema',
              text: (
                <>
                  A record in <code>com.atproto.lexicon.schema</code>, keyed by the full NSID, read from that
                  account&rsquo;s PDS.
                </>
              ),
            },
            {
              term: 'The schema is a lexicon document',
              text: (
                <>
                  <code>lexicon</code> is 1, <code>id</code> matches the NSID, and <code>defs</code> holds the
                  definitions.
                </>
              ),
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
