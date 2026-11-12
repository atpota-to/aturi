'use client';

import Link from 'next/link';
import { Check, LoaderCircle, RadioTower, TriangleAlert, X } from 'lucide-react';
import { describeServer, getServerHealth } from '@/utils/atproto/pdsServer';
import { resolveMiniDoc, type MiniDoc } from '@/utils/atproto/slingshot';
import {
  RELAYS,
  hostOfEndpoint,
  normalizeRelayInput,
  relayVerdict,
  requestCrawlCommand,
  type PdsProbe,
} from '@/lib/tools/relay';
import { toolHref } from '@/lib/tools/catalog';
import { RelayStatusRows, useRelayStatuses } from './RelayStatusList';
import {
  ToolCard,
  ToolCode,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'relay';
const EXAMPLES = [{ value: 'blacksky.app' }, { value: 'eurosky.social' }, { value: '@bsky.app' }];

/**
 * The host the relays are asked about, and how it was arrived at. `pds` is
 * what the host says for itself, undefined until it has been asked: the
 * relays are asked as soon as the hostname is known, not after.
 */
type Target = {
  host: string;
  /** The account the host was looked up from, when the input was not a host. */
  account: { did: string; handle: string | null } | null;
  pds?: PdsProbe;
};

async function probePds(host: string): Promise<PdsProbe> {
  const [server, health] = await Promise.all([
    describeServer(host).catch(() => null),
    getServerHealth(host).catch(() => null),
  ]);
  return { reachable: server !== null, did: server?.did, version: health?.version };
}

/**
 * Settle what was typed into a hostname. A URL is a host and a DID or
 * @handle is an account. A bare domain can be either, so both are asked at
 * once: if it answers as a PDS it is one, and otherwise, if it resolves as a
 * handle, the account's PDS is used. A domain that does neither is still
 * taken as a host, since a PDS that is down is exactly what someone would
 * come here to look into.
 */
async function resolveTarget(
  input: Extract<ReturnType<typeof normalizeRelayInput>, { ok: true }>,
  signal: AbortSignal,
  publish: (target: Target) => void,
): Promise<Target> {
  const fromAccount = async (mini: MiniDoc | null, identifier: string): Promise<Target> => {
    const host = mini ? hostOfEndpoint(mini.pds) : null;
    if (!mini || !host) throw new Error(`${identifier} could not be resolved to an account with a PDS.`);
    const target: Target = { host, account: { did: mini.did, handle: mini.handle } };
    publish(target);
    return { ...target, pds: await probePds(host) };
  };

  if (input.kind === 'account') {
    return fromAccount(await resolveMiniDoc(input.identifier, signal), input.identifier);
  }
  if (input.kind === 'host') {
    publish({ host: input.host, account: null });
    return { host: input.host, account: null, pds: await probePds(input.host) };
  }
  const [pds, mini] = await Promise.all([probePds(input.host), resolveMiniDoc(input.host, signal)]);
  if (!pds.reachable && mini) return fromAccount(mini, input.host);
  return { host: input.host, account: null, pds };
}

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

/**
 * Asks each relay what it knows about a PDS host. The logic is in
 * src/lib/tools/relay.ts; the rows are RelayStatusList.tsx.
 */
export default function RelayCheck() {
  const [{ host: raw }, setQuery] = useToolQuery(['host'] as const);
  const input = raw ? normalizeRelayInput(raw) : null;
  const valid = input?.ok ? input : null;
  const key = valid ? `${valid.kind}:${valid.kind === 'account' ? valid.identifier : valid.host}` : null;

  const run = useToolRun<Target>(key, ({ signal, publish }) =>
    resolveTarget(valid as NonNullable<typeof valid>, signal, publish),
  );
  const target = run.data ?? null;
  const relays = useRelayStatuses(target?.host ?? null);
  const verdict = target ? relayVerdict(target.host, relays.results, target.pds) : null;
  // Ask the first relay that has not heard of the host; failing that, the first.
  const crawlRelay =
    relays.results.find((r) => r.answer?.state === 'unknown')?.relay ?? relays.results[0]?.relay ?? RELAYS[0];

  return (
    <ToolShell
      slug={SLUG}
      share={valid ? `${toolHref(SLUG)}?host=${encodeURIComponent(raw.trim())}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ host: value })}
          label="PDS hostname, or a handle or DID to look up its PDS"
          placeholder="pds.example.com"
          busy={run.status === 'loading' || relays.loading}
          examples={EXAMPLES}
          icon={<RadioTower size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}
      {run.status === 'loading' && !target && (
        <ToolVerdict tone="info" title="Finding the PDS" icon={VERDICT_ICON.pending}>
          Working out whether this is a PDS hostname or an account.
        </ToolVerdict>
      )}

      {target && verdict && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          <ToolSection
            title="Relays"
            meta={
              relays.loading ? (
                'Asking…'
              ) : (
                <button type="button" className="fn-tool-link" onClick={relays.rerun}>
                  Ask again
                </button>
              )
            }
          >
            <ToolCard flush className="fn-tool-relay-card">
              <RelayStatusRows results={relays.results} />
            </ToolCard>
            <p className="fn-tool-note fn-tool-relay-note">
              Account counts differ between relays: each counts the accounts it has seen itself, and the host may
              have more. The sequence number is how far through the host&rsquo;s events a relay last recorded
              reading.
            </p>
          </ToolSection>

          {verdict.explainCrawl && (
            <ToolSection title="Asking to be crawled">
              <ToolCard>
                <p>
                  A relay starts reading a PDS when the PDS asks it to, with{' '}
                  <code>com.atproto.sync.requestCrawl</code>. The reference PDS sends this itself to every relay in
                  its <code>PDS_CRAWLERS</code> setting, so check that setting first. To ask by hand, send the
                  request from anywhere:
                </p>
                <ToolCode copy={requestCrawlCommand(crawlRelay.host, target.host)} label="command">
                  {requestCrawlCommand(crawlRelay.host, target.host)}
                </ToolCode>
                <p className="fn-tool-note fn-tool-relay-note">
                  This page does not send it. The relay connects back to the hostname in the request, so the PDS
                  has to be reachable over https at that name.
                </p>
              </ToolCard>
            </ToolSection>
          )}

          <ToolSection title="The host">
            <ToolCard>
              <ToolFacts>
                <ToolFact label="Hostname" copy={target.host}>
                  {target.host}
                </ToolFact>
                <ToolFact label="Answers as a PDS" plain>
                  {target.pds === undefined
                    ? 'Asking…'
                    : target.pds.reachable
                      ? 'Yes'
                      : 'No. It did not answer describeServer.'}
                </ToolFact>
                {target.pds?.did && (
                  <ToolFact label="Server DID" copy={target.pds.did}>
                    {target.pds.did}
                  </ToolFact>
                )}
                {target.pds?.version && <ToolFact label="Version">{target.pds.version}</ToolFact>}
                {target.account && (
                  <ToolFact label="Looked up from">
                    <Link href={`/explore/${target.account.did}`} prefetch={false}>
                      {target.account.handle ? `@${target.account.handle}` : target.account.did}
                    </Link>
                  </ToolFact>
                )}
              </ToolFacts>
              {target.pds?.reachable && (
                <div className="fn-tool-actions">
                  <Link
                    href={`/explore/pds/${encodeURIComponent(target.host)}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open this PDS in the Explorer
                  </Link>
                </div>
              )}
            </ToolCard>
          </ToolSection>
        </>
      )}

      {!raw && (
        <ToolIntro
          title="How it works"
          items={[
            {
              term: 'A PDS asks to be crawled',
              text: (
                <>
                  It sends <code>com.atproto.sync.requestCrawl</code> to a relay with its own hostname. Until it
                  does, the relay does not know it exists.
                </>
              ),
            },
            {
              term: 'The relay subscribes to it',
              text: 'It connects to the host’s event stream and passes on every record written there. Apps read from relays, not from each PDS.',
            },
            {
              term: 'Each relay reports what it knows',
              text: (
                <>
                  <code>com.atproto.sync.getHostStatus</code> returns a status, the number of accounts the relay
                  has seen on the host, and how far it has read. {RELAYS.length} relays are asked.
                </>
              ),
            },
            {
              term: 'The host is asked too',
              text: 'So a PDS that is down reads apart from one that is up but has never been crawled.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
