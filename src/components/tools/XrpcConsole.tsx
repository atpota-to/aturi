'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BookOpen, TriangleAlert } from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import { Nsid, Segmented } from '@/components/explore/lexicons/primitives';
import { lookupLexiconSchema } from '@/utils/atproto/lexiconSchemaLookup';
import { resolveMiniDoc } from '@/utils/atproto/slingshot';
import { toolHref } from '@/lib/tools/catalog';
import {
  HOST_CHOICES,
  buildRequestUrl,
  cleanValues,
  curlFor,
  defaultHostFor,
  fixedOriginFor,
  isComplete,
  isTextual,
  looksLikeMethodNsid,
  missingRequired,
  normalizeHostUrl,
  paramSetFromLexicon,
  pdsAccountFor,
  queriesFrom,
  requestFromSearch,
  requestToSearch,
  summarizeMethodLexicon,
  withExtraParams,
  type ConsoleRequest,
  type HostChoice,
  type LexiconSummary,
  type XrpcMethod,
  type XrpcParamSet,
  type XrpcParamSpec,
} from '@/lib/tools/xrpc';
import { ToolCard, ToolCode, ToolError, ToolSection, ToolShell, ToolVerdict, type ToolExample } from './ToolFrame';
import { useToolRun } from './useToolQuery';
import { XrpcMethodCatalog, XrpcMethodPicker } from './XrpcConsoleMethods';
import XrpcConsoleParams from './XrpcConsoleParams';
import XrpcConsoleResponse, { type ConsoleResult } from './XrpcConsoleResponse';

const SLUG = 'xrpc';

/**
 * Whole requests to try, as the query string would hold them. Each is
 * complete, so picking one sends it.
 */
const EXAMPLES: ToolExample[] = [
  { label: 'getProfile', value: 'method=app.bsky.actor.getProfile&p.actor=bsky.app' },
  {
    label: 'listRecords',
    value: 'method=com.atproto.repo.listRecords&p.repo=bsky.app&p.collection=app.bsky.feed.post&p.limit=3',
  },
  { label: 'getAuthorFeed', value: 'method=app.bsky.feed.getAuthorFeed&p.actor=bsky.app&p.limit=5' },
  { label: 'listHosts', value: 'method=com.atproto.sync.listHosts&p.limit=5' },
];

/** The most of a response body that is read. A page of a hundred records is well under it. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The method index: every lexicon in bluesky-social/atproto, as the MCP
 * server's documentation tools already hold it. It is 200KB of source, so it
 * is imported on demand and becomes a chunk only this page loads.
 */
async function loadManifest() {
  const { API_METHODS } = await import('@/lib/mcp/apiManifest');
  return API_METHODS;
}

type MethodLexicon = {
  paramSet: XrpcParamSet;
  summary: LexiconSummary | null;
  description: string;
  /**
   * Where the parameters were read from: the lexicon record its authority
   * published, the copy in the atproto repository, or nowhere, in which case
   * only the index's parameter names are known.
   */
  source: 'published' | 'repository' | 'names';
};

/**
 * Find a method's lexicon, so the form can be built from it.
 *
 * The published record comes first: it is the protocol's own answer
 * (`_lexicon` DNS record, then `com.atproto.lexicon.schema` in the
 * authority's repository), it covers any NSID rather than only the ones in
 * the index, and it is what the lexicons explorer shows. The index's link to
 * the JSON in the atproto repository is the fallback for a namespace that
 * publishes nothing.
 */
async function loadLexicon(nsid: string, signal: AbortSignal): Promise<MethodLexicon> {
  const entry = (await loadManifest()).find((method) => method.nsid === nsid);
  let doc: unknown = null;
  let source: MethodLexicon['source'] = 'names';

  const published = await lookupLexiconSchema(nsid).catch(() => null);
  if (published?.status === 'found') {
    doc = published.doc;
    source = 'published';
  } else if (entry?.raw) {
    try {
      const res = await fetch(entry.raw, { signal });
      if (res.ok) {
        doc = await res.json();
        source = 'repository';
      }
    } catch {
      // Unreachable or not JSON: fall through to the parameter names.
    }
  }

  const summary = doc ? summarizeMethodLexicon(doc) : null;
  return {
    paramSet: paramSetFromLexicon(doc, entry?.params ?? []),
    summary,
    description: summary?.description ?? entry?.description ?? '',
    source,
  };
}

async function originFor(request: ConsoleRequest, signal: AbortSignal): Promise<string> {
  const fixed = fixedOriginFor(request.host);
  if (fixed) return fixed;
  if (request.host === 'other') {
    const host = normalizeHostUrl(request.url);
    if (!host.ok) throw new Error(host.reason);
    return host.origin;
  }
  const account = pdsAccountFor(request);
  if (!account) {
    throw new Error('Name the account whose PDS should answer, or send the request somewhere else.');
  }
  const identity = await resolveMiniDoc(account, signal);
  if (!identity?.pds) throw new Error(`No PDS could be found for ${account}. Check the handle or DID.`);
  return identity.pds.replace(/\/$/, '');
}

async function readBody(res: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text();
    return { text, bytes: new TextEncoder().encode(text).length, truncated: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes + value.byteLength > MAX_BODY_BYTES) {
      text += decoder.decode(value.subarray(0, MAX_BODY_BYTES - bytes), { stream: true });
      bytes = MAX_BODY_BYTES;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), bytes, truncated };
}

/**
 * Send one request, straight from the browser. There is no proxy behind
 * this: the host sees the visitor, and a host that does not allow
 * cross-origin reads cannot be asked at all.
 *
 * Problems with the request itself (no host to send it to) are thrown.
 * Whatever the host does, an error status included, is a result.
 */
async function sendRequest(
  request: ConsoleRequest,
  specs: XrpcParamSpec[],
  signal: AbortSignal,
): Promise<ConsoleResult> {
  const origin = await originFor(request, signal);
  const url = buildRequestUrl(origin, request.method, request.params, specs);
  const started = performance.now();

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    return { kind: 'network', url, origin };
  }

  const contentType = res.headers.get('content-type');
  if (!isTextual(contentType)) {
    const declared = Number(res.headers.get('content-length') ?? '');
    await res.body?.cancel().catch(() => undefined);
    return {
      kind: 'binary',
      url,
      origin,
      status: res.status,
      ms: performance.now() - started,
      contentType,
      bytes: Number.isFinite(declared) && declared > 0 ? declared : null,
    };
  }

  const body = await readBody(res);
  let json: unknown;
  try {
    json = body.truncated ? undefined : JSON.parse(body.text);
  } catch {
    json = undefined;
  }
  return {
    kind: 'text',
    url,
    origin,
    status: res.status,
    ms: performance.now() - started,
    contentType,
    bytes: body.bytes,
    text: body.text,
    json,
    truncated: body.truncated,
    rateRemaining: res.headers.get('ratelimit-remaining'),
  };
}

/** What is being edited, before Send writes it into the link. */
type Draft = Pick<ConsoleRequest, 'host' | 'acct' | 'url' | 'params'>;

const draftOf = (request: ConsoleRequest): Draft => ({
  host: request.host,
  acct: request.acct,
  url: request.url,
  params: request.params,
});

const SOURCE_NOTE: Record<MethodLexicon['source'], string> = {
  published: 'Parameters are read from the lexicon this method’s authority published.',
  repository: 'Parameters are read from the lexicon in the atproto repository.',
  names: 'This method’s lexicon could not be found, so its parameters are plain text fields.',
};

/**
 * Pick an atproto query, fill in its parameters, send it, read the response.
 * The logic is in src/lib/tools/xrpc.ts; this holds the state and draws it.
 *
 * The link is the request. Send writes the method, the host and the
 * parameters into the query string, and the request that runs is the one
 * the query string describes, so any response can be shared or bookmarked
 * and Back returns to the request before it.
 *
 * A request that arrives by link is sent on its own only when it is whole:
 * the lexicon is in hand, every required parameter has a value and there is
 * a host to ask. Choosing a method from the list is not a request to send
 * it, even when it takes no parameters, so those links are remembered as
 * unsent until Send is pressed.
 *
 * No signed-in mode. The site's OAuth proxy carries a fixed list of methods
 * (src/app/api/oauth/xrpc/[nsid]/route.ts), not arbitrary ones, and the
 * console does not widen it; a method that needs a session answers 401 and
 * the response says why.
 */
export default function XrpcConsole() {
  const pathname = usePathname();
  const serialized = useSearchParams().toString();
  const request = useMemo(() => requestFromSearch(new URLSearchParams(serialized)), [serialized]);
  const canonical = requestToSearch(request);
  const methodValid = looksLikeMethodNsid(request.method);

  const [query, setQuery] = useState(request.method);
  const [draft, setDraft] = useState<Draft>(() => draftOf(request));
  const [seen, setSeen] = useState(canonical);
  if (seen !== canonical) {
    setSeen(canonical);
    setDraft(draftOf(request));
    setQuery(request.method);
  }
  /** Links made by choosing a method, which are not sent until asked. */
  const [unsent, setUnsent] = useState<string[]>([]);
  /** The link Send was last pressed on, which runs whether or not it is whole. */
  const [forced, setForced] = useState<string | null>(null);

  const index = useToolRun<XrpcMethod[]>('index', async () => queriesFrom(await loadManifest()));
  const lexicon = useToolRun<MethodLexicon>(methodValid ? request.method : null, ({ signal }) =>
    loadLexicon(request.method, signal),
  );
  const paramSet = lexicon.data?.paramSet ?? null;
  const specs = paramSet?.specs ?? [];
  const summary = lexicon.data?.summary ?? null;
  /** A lexicon that says the method is something other than a query: a procedure typed in by hand. */
  const notAQuery = summary?.type && summary.type !== 'query' ? summary.type : null;

  const runKey =
    !methodValid || notAQuery || unsent.includes(canonical)
      ? null
      : forced === canonical || (lexicon.status !== 'loading' && isComplete(request, paramSet))
        ? canonical
        : null;
  const run = useToolRun<ConsoleResult>(runKey, ({ signal }) => sendRequest(request, specs, signal));

  function go(next: ConsoleRequest) {
    const search = requestToSearch(next);
    const url = `${pathname}${search ? `?${search}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, '', url);
    }
  }

  function pick(nsid: string) {
    if (nsid === request.method) {
      setQuery(nsid);
      return;
    }
    const next: ConsoleRequest = { method: nsid, host: defaultHostFor(nsid), acct: '', url: '', params: {} };
    const search = requestToSearch(next);
    setUnsent((prev) => (prev.includes(search) ? prev : [...prev, search]));
    go(next);
  }

  function send(next: ConsoleRequest) {
    const search = requestToSearch(next);
    setUnsent((prev) => prev.filter((entry) => entry !== search));
    setForced(search);
    if (search !== canonical) go(next);
    else if (runKey === search) run.rerun();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send({ method: request.method, ...draft });
  }

  const setParam = (name: string, values: string[]) =>
    setDraft((prev) => ({ ...prev, params: { ...prev.params, [name]: values } }));

  // The address the draft would be sent to, where it is known without
  // asking anyone. A PDS is only known once a request has resolved it.
  const draftAccount = pdsAccountFor(draft);
  const typedHost = normalizeHostUrl(draft.url);
  const previewOrigin =
    draft.host === 'pds'
      ? run.data && request.host === 'pds' && pdsAccountFor(request) === draftAccount
        ? run.data.origin
        : null
      : draft.host === 'other'
        ? typedHost.ok
          ? typedHost.origin
          : null
        : fixedOriginFor(draft.host);
  const previewUrl = buildRequestUrl(
    previewOrigin ?? (draft.host === 'pds' ? `https://{PDS${draftAccount ? ` of ${draftAccount}` : ''}}` : 'https://{host}'),
    request.method,
    draft.params,
    specs,
  );
  const missing = paramSet?.source === 'lexicon' ? missingRequired(specs, draft.params) : [];
  const hostHint = HOST_CHOICES.find((choice) => choice.value === draft.host)?.hint;

  return (
    <ToolShell
      slug={SLUG}
      wide
      share={canonical ? `${toolHref(SLUG)}?${canonical}` : undefined}
      form={
        <XrpcMethodPicker
          methods={index.data}
          selected={methodValid ? request.method : ''}
          query={query}
          onQuery={setQuery}
          onPick={pick}
          examples={EXAMPLES}
          onExample={(value) => send(requestFromSearch(new URLSearchParams(value)))}
        />
      }
    >
      {index.status === 'error' && (
        <ToolError onRetry={index.rerun}>The list of methods could not be loaded.</ToolError>
      )}
      {request.method && !methodValid && (
        <ToolError>
          <code>{request.method}</code> is not a method name. A method is an NSID such as{' '}
          <code>app.bsky.actor.getProfile</code>.
        </ToolError>
      )}

      {!methodValid ? (
        index.status !== 'error' && <XrpcMethodCatalog methods={index.data} query={query} onPick={pick} />
      ) : (
        <div className="fn-tool-xrpc-grid">
          <ToolSection
            title="Request"
            meta={
              <button
                type="button"
                className="fn-tool-link"
                onClick={() => go({ method: '', host: 'appview', acct: '', url: '', params: {} })}
              >
                All methods
              </button>
            }
          >
            <ToolCard>
              <form className="fn-tool-xrpc-form" onSubmit={submit}>
                <div className="fn-tool-xrpc-method">
                  <h3 className="fn-tool-xrpc-nsid">
                    <Nsid value={request.method} />
                  </h3>
                  {lexicon.data?.description && <p>{lexicon.data.description}</p>}
                  <div>
                    <Link
                      href={`/explore/lexicons/${encodeURIComponent(request.method)}`}
                      prefetch={false}
                      className="fx-btn fx-btn-sm"
                    >
                      <BookOpen size={13} aria-hidden /> Lexicon
                    </Link>
                  </div>
                </div>

                {notAQuery && (
                  <ToolVerdict tone="warn" title={`This is a ${notAQuery}, not a query`} icon={<TriangleAlert size={18} />}>
                    The console sends queries, which only read. It does not send procedures or open subscriptions.
                  </ToolVerdict>
                )}

                <fieldset className="fn-tool-xrpc-block">
                  <legend>Send to</legend>
                  <Segmented
                    ariaLabel="Where to send the request"
                    options={HOST_CHOICES}
                    value={draft.host}
                    onChange={(host: HostChoice) => setDraft((prev) => ({ ...prev, host }))}
                  />
                  {hostHint && <p className="fn-tool-note">{hostHint}.</p>}
                  {draft.host === 'pds' && (
                    <>
                      <span className="fx-field fn-tool-xrpc-field">
                        <input
                          type="text"
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label="Account whose PDS to ask"
                          placeholder="Handle or DID"
                          value={draft.acct}
                          onChange={(event) => setDraft((prev) => ({ ...prev, acct: event.target.value.trim() }))}
                        />
                      </span>
                      <p className="fn-tool-note">
                        Left empty, the request goes to the PDS of the repo it asks about.
                      </p>
                    </>
                  )}
                  {draft.host === 'other' && (
                    <span className="fx-field fn-tool-xrpc-field">
                      <input
                        type="text"
                        inputMode="url"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label="Host to send the request to"
                        placeholder="pds.example.com"
                        value={draft.url}
                        onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value.trim() }))}
                      />
                    </span>
                  )}
                </fieldset>

                <fieldset className="fn-tool-xrpc-block">
                  <legend>Parameters</legend>
                  {lexicon.status === 'loading' ? (
                    <div className="fn-tool-xrpc-waiting" aria-hidden>
                      <span className="fn-skel" style={{ width: '34%', height: 12 }} />
                      <span className="fn-skel" data-shape="control" style={{ width: '100%', height: 32 }} />
                      <span className="fn-skel" style={{ width: '26%', height: 12 }} />
                      <span className="fn-skel" data-shape="control" style={{ width: '100%', height: 32 }} />
                    </div>
                  ) : (
                    <>
                      <XrpcConsoleParams
                        specs={withExtraParams(specs, draft.params)}
                        values={draft.params}
                        onChange={setParam}
                        lexiconKnown={paramSet?.source === 'lexicon'}
                      />
                      {lexicon.data && lexicon.data.source !== 'published' && (
                        <p className="fn-tool-note">{SOURCE_NOTE[lexicon.data.source]}</p>
                      )}
                    </>
                  )}
                </fieldset>

                <div className="fn-tool-xrpc-send">
                  <button
                    type="submit"
                    className="fn-searchbox-submit"
                    disabled={run.status === 'loading' || Boolean(notAQuery)}
                  >
                    {run.status === 'loading' ? 'Sending…' : 'Send'}
                  </button>
                  {missing.length > 0 && (
                    <span className="fn-tool-note" role="status">
                      Still needed: {missing.join(', ')}
                    </span>
                  )}
                </div>

                <div className="fn-tool-xrpc-preview">
                  <ToolCode copy={previewOrigin ? previewUrl : undefined} label="request URL">
                    {`GET ${previewUrl}`}
                  </ToolCode>
                  {previewOrigin && <CopyButton value={curlFor(previewUrl)} label="Copy as curl" compact />}
                </div>
              </form>
            </ToolCard>
          </ToolSection>

          <ToolSection
            title="Response"
            meta={run.status === 'done' && run.data.kind !== 'network' ? new URL(run.data.url).host : null}
          >
            <XrpcConsoleResponse
              run={run}
              summary={summary}
              canPage={specs.some((spec) => spec.name === 'cursor')}
              onNextPage={(cursor) =>
                send({ ...request, params: { ...cleanValues(request.params), cursor: [cursor] } })
              }
            />
          </ToolSection>
        </div>
      )}
    </ToolShell>
  );
}
