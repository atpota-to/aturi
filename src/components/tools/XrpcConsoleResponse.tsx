'use client';

import { ArrowRight, Check, ExternalLink, Info, X } from 'lucide-react';
import {
  curlFor,
  formatBytes,
  formatDuration,
  nextCursor,
  readXrpcFailure,
  type LexiconSummary,
} from '@/lib/tools/xrpc';
import { ToolCode, ToolEmpty, ToolError, ToolJson, ToolSkeleton, ToolVerdict } from './ToolFrame';
import type { ToolRun } from './useToolQuery';

/**
 * What came back from a request the XRPC console sent, in one of three
 * shapes:
 *
 *   `text`     a response whose body was read: JSON, or anything textual.
 *   `binary`   a response whose body was left alone. `com.atproto.sync.getRepo`
 *              answers with a whole repository, and a blob with a file;
 *              neither is something to pour into a page.
 *   `network`  no response at all. From a browser that is either a host that
 *              is down or one that does not allow cross-origin reads, and
 *              the two cannot be told apart, so the message names both.
 */
export type ConsoleResult = (
  | { kind: 'network' }
  | {
      kind: 'binary';
      status: number;
      ms: number;
      contentType: string | null;
      /** From Content-Length, when the host sent one. */
      bytes: number | null;
    }
  | {
      kind: 'text';
      status: number;
      ms: number;
      contentType: string | null;
      bytes: number;
      text: string;
      /** The parsed body, or undefined when it is not JSON. */
      json: unknown;
      /** The body was longer than the console reads and was cut. */
      truncated: boolean;
      /** `RateLimit-Remaining`, where the host exposes it to a page. */
      rateRemaining: string | null;
    }
) & {
  /** The address the request was sent to. */
  url: string;
  /** The host it went to, which for a PDS is only known once the account is resolved. */
  origin: string;
};

/** HTTP/2 carries no reason phrase, so the common ones are spelled here. */
const REASONS: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Above this the body is shown as plain text. The linked view makes an
 * element of every DID, at:// URI and URL in the JSON, and a page of a
 * hundred records has thousands of them.
 */
const LINKIFY_MAX_CHARS = 150_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'The host';
  }
}

/** A host's message as a sentence, whether or not it ended one. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? `${text.trim()} ` : `${text.trim()}. `;
}

/** What a failure most likely means, beyond the host's own message. */
function failureHint(status: number, error: string | null): string | null {
  if (status === 401 || error === 'AuthMissing' || error === 'AuthenticationRequired') {
    return 'This method needs a signed-in session. The console sends requests without one.';
  }
  if (status === 501 || error === 'MethodNotImplemented' || error === 'XRPCNotSupported') {
    return 'This host does not serve that method. Try sending it somewhere else.';
  }
  if (status === 404 && !error) {
    return 'This host does not serve that method, or does not serve XRPC at all.';
  }
  if (status === 429) return 'The host is rate limiting requests. Wait a little before sending again.';
  return null;
}

export default function XrpcConsoleResponse({
  run,
  summary,
  canPage,
  onNextPage,
}: {
  run: ToolRun<ConsoleResult> & { rerun: () => void };
  /** The method's lexicon, for the descriptions of the errors it names. */
  summary: LexiconSummary | null;
  /** The method takes a cursor, so a page that hands one back can be followed. */
  canPage: boolean;
  onNextPage: (cursor: string) => void;
}) {
  if (run.status === 'idle') {
    return <ToolEmpty>Fill in the parameters and send the request. The response appears here.</ToolEmpty>;
  }
  if (run.status === 'loading') return <ToolSkeleton rows={5} />;
  if (run.status === 'error') return <ToolError onRetry={run.rerun}>{run.error}</ToolError>;

  const result = run.data;

  if (result.kind === 'network') {
    return (
      <div className="fn-tool-xrpc-result">
        <ToolVerdict tone="fail" title="The request did not complete" icon={<X size={18} strokeWidth={2.6} />}>
          {hostOf(result.url)} did not answer, or it does not allow requests from a web page. The same request
          may still work from a terminal.
        </ToolVerdict>
        <ToolCode copy={curlFor(result.url)} label="curl command">
          {curlFor(result.url)}
        </ToolCode>
      </div>
    );
  }

  const reason = REASONS[result.status];
  const statusLine = `${result.status}${reason ? ` ${reason}` : ''}`;
  const ok = result.status >= 200 && result.status < 300;

  if (result.kind === 'binary') {
    return (
      <div className="fn-tool-xrpc-result">
        <ToolVerdict tone={ok ? 'info' : 'fail'} title={statusLine} icon={<Info size={18} />}>
          The response is {result.contentType ?? 'not text'}
          {result.bytes !== null ? `, ${formatBytes(result.bytes)}` : ''}, so it was not downloaded here. Open it
          in a new tab to save it.
        </ToolVerdict>
        <div>
          <a href={result.url} target="_blank" rel="noreferrer" className="fx-btn fx-btn-sm">
            <ExternalLink size={13} aria-hidden /> Open the response
          </a>
        </div>
      </div>
    );
  }

  const failure = ok ? null : readXrpcFailure(result.json);
  const named = failure ? summary?.errors.find((entry) => entry.name === failure.error) : undefined;
  const hint = ok ? null : failureHint(result.status, failure?.error ?? null);
  const facts = [
    formatDuration(result.ms),
    formatBytes(result.bytes),
    result.contentType?.split(';')[0] ?? null,
    result.rateRemaining ? `${result.rateRemaining} requests left` : null,
  ].filter(Boolean);
  const cursor = ok && canPage ? nextCursor(result.json) : null;
  const linkify = result.json !== undefined && result.text.length <= LINKIFY_MAX_CHARS;

  return (
    <div className="fn-tool-xrpc-result">
      <ToolVerdict
        tone={ok ? 'pass' : 'fail'}
        title={failure ? `${statusLine}: ${failure.error}` : statusLine}
        icon={ok ? <Check size={18} strokeWidth={2.6} /> : <X size={18} strokeWidth={2.6} />}
      >
        {failure?.message ? sentence(failure.message) : ''}
        {named?.description ? sentence(named.description) : ''}
        {hint ? `${hint} ` : ''}
        <span className="fn-tool-xrpc-facts">{facts.join(' · ')}</span>
      </ToolVerdict>

      {result.text === '' ? (
        <ToolEmpty>The response has no body.</ToolEmpty>
      ) : linkify ? (
        <ToolJson value={result.json} label="response" />
      ) : (
        <ToolCode copy={result.text} label="response">
          {result.json !== undefined ? JSON.stringify(result.json, null, 2) : result.text}
        </ToolCode>
      )}

      {result.truncated && (
        <p className="fn-tool-note">
          The response was longer than the console reads, so it is cut short here. Ask for fewer results, or use the
          curl command for the whole of it.
        </p>
      )}

      {cursor && (
        <div>
          <button type="button" className="fx-btn fx-btn-sm" onClick={() => onNextPage(cursor)}>
            Next page <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
