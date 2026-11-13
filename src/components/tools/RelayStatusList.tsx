'use client';

import {
  RELAYS,
  formatCount,
  readHostStatus,
  readStatus,
  type Relay,
  type RelayAnswer,
  type RelayResult,
} from '@/lib/tools/relay';
import { CheckMark, type CheckStatus } from './Checks';
import { useToolRun } from './useToolQuery';

/**
 * What each relay says about one PDS host.
 *
 * Three exports, so the same rows serve the tool and anywhere else that
 * wants them: `useRelayStatuses` asks, `RelayStatusRows` draws what it is
 * given, and `RelayStatusList` is the two together for a page that only has
 * a hostname (the Explorer's PDS page).
 */

/** Longer than a relay ever takes to answer, short enough that a dead one does not hold the list. */
const RELAY_TIMEOUT_MS = 8000;

async function askRelay(relay: Relay, hostname: string, signal: AbortSignal): Promise<RelayAnswer> {
  // The run's own signal cancels the request when the input changes; the
  // timer cancels it when the relay is simply not answering.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timer = setTimeout(abort, RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://${relay.host}/xrpc/com.atproto.sync.getHostStatus?hostname=${encodeURIComponent(hostname)}`,
      { signal: controller.signal },
    );
    return readHostStatus(res.status, await res.json().catch(() => null));
  } catch {
    return { state: 'error', message: 'no answer' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Ask every relay about a host. Rows fill in as each one answers. */
export function useRelayStatuses(hostname: string | null): {
  results: RelayResult[];
  loading: boolean;
  rerun: () => void;
} {
  const run = useToolRun<RelayResult[]>(hostname, async ({ signal, publish }) => {
    let results: RelayResult[] = RELAYS.map((relay) => ({ relay }));
    publish(results);
    await Promise.all(
      RELAYS.map(async (relay) => {
        const answer = await askRelay(relay, hostname as string, signal);
        results = results.map((result) => (result.relay === relay ? { relay, answer } : result));
        publish(results);
      }),
    );
    return results;
  });
  return {
    results: run.data ?? (hostname ? RELAYS.map((relay) => ({ relay })) : []),
    loading: run.status === 'loading',
    rerun: run.rerun,
  };
}

type RowReading = {
  mark: CheckStatus;
  pill: { label: string; tone?: 'pass' | 'warn' | 'fail' | 'outline' };
  meaning: string;
  figures: string[];
};

function readRow(answer: RelayAnswer | undefined): RowReading {
  if (answer === undefined) {
    return { mark: 'pending', pill: { label: 'Asking' }, meaning: 'Waiting for an answer.', figures: [] };
  }
  if (answer.state === 'error') {
    return {
      mark: 'skip',
      pill: { label: 'No answer' },
      meaning: `Did not answer (${answer.message}). That says nothing about the host.`,
      figures: [],
    };
  }
  if (answer.state === 'unknown') {
    return {
      mark: 'fail',
      pill: { label: 'Not known', tone: 'outline' },
      meaning: 'Has never been asked to crawl this host, so it carries none of its records.',
      figures: [],
    };
  }
  const status = readStatus(answer.status);
  const figures: string[] = [];
  if (answer.accountCount !== null) {
    figures.push(`${formatCount(answer.accountCount)} ${answer.accountCount === 1 ? 'account' : 'accounts'}`);
  }
  figures.push(answer.seq !== null ? `seq ${formatCount(answer.seq)}` : 'no events read yet');
  return {
    mark: status.tone,
    pill: { label: status.label, tone: status.tone },
    meaning: status.meaning,
    figures,
  };
}

/**
 * The rows, given the answers. Draws no card of its own.
 *
 * `compact` is one line a relay, for a page where the relays are a detail
 * rather than the subject: the status and the account count stay, and what
 * the status means moves to the row's tooltip.
 */
export function RelayStatusRows({ results, compact }: { results: RelayResult[]; compact?: boolean }) {
  return (
    <ul className="fn-tool-relay-list" data-compact={compact || undefined}>
      {results.map(({ relay, answer }) => {
        const row = readRow(answer);
        return (
          <li key={relay.host} className="fn-tool-relay-row" title={compact ? `${relay.host}: ${row.meaning}` : undefined}>
            <CheckMark status={row.mark} />
            <div className="fn-tool-relay-main">
              <span className="fn-tool-relay-name">
                {relay.operator} <span>{relay.where}</span>
              </span>
              <span className="fn-tool-relay-host">{relay.host}</span>
              <span className="fn-tool-relay-meaning">{row.meaning}</span>
            </div>
            <div className="fn-tool-relay-figures">
              <span className="fn-tool-pill" data-tone={row.pill.tone}>
                {row.pill.label}
              </span>
              {row.figures.map((figure) => (
                <span key={figure}>{figure}</span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The whole thing for a hostname: asks the relays and draws their answers in
 * a card. Stands on its own outside a tool page (the Explorer's PDS page
 * uses it, in its compact form).
 */
export default function RelayStatusList({ hostname, compact }: { hostname: string; compact?: boolean }) {
  const { results } = useRelayStatuses(hostname);
  return (
    <div className="fx-card fn-tool-relay-card" aria-label={`Relays crawling ${hostname}`} role="group">
      <RelayStatusRows results={results} compact={compact} />
    </div>
  );
}
