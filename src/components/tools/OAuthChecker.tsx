'use client';

import { Check, KeyRound, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Segmented } from '@/components/explore/lexicons/primitives';
import { toolHref } from '@/lib/tools/catalog';
import {
  buildClientChecks,
  clientKind,
  clientVerdict,
  parseClientId,
  readLoopbackClient,
  type ClientMetadataProbe,
  type OAuthCheck,
} from '@/lib/tools/oauth';
import { CheckList, type CheckItem } from './Checks';
import OAuthCheckerScopes, { SCOPE_EXAMPLES } from './OAuthCheckerScopes';
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
  ToolTextForm,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'oauth';

type View = 'client' | 'scopes';
const VIEWS: { value: View; label: string }[] = [
  { value: 'client', label: 'Check a client' },
  { value: 'scopes', label: 'Build scopes' },
];

/**
 * Both of this site's own documents, which are live, and the development
 * form, which needs no document at all.
 */
const CLIENT_EXAMPLES = [
  { label: 'aturi.to (web)', value: 'https://aturi.to/oauth-client-metadata.json' },
  { label: 'Aturi for iOS (native)', value: 'https://aturi.to/oauth-client-metadata-ios.json' },
  {
    label: 'localhost (development)',
    value: 'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=atproto',
  },
];

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

function toItems(checks: OAuthCheck[]): CheckItem[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
    fix: check.fix?.map((line, index) => <p key={index}>{line}</p>),
  }));
}

/**
 * Fetch the document through the tool route. A failure of the route itself
 * is reported as `null`, which the check list reads as "could not look".
 */
async function fetchProbe(clientId: string, signal: AbortSignal): Promise<ClientMetadataProbe | null> {
  try {
    const res = await fetch(`/api/tools/oauth?client_id=${encodeURIComponent(clientId)}`, { signal });
    const body = (await res.json()) as ({ ok: true } & ClientMetadataProbe) | { ok: false };
    return body.ok ? body : null;
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

function describeKind(document: unknown): string | null {
  const kind = clientKind(document);
  if (!kind) return null;
  return `${kind.confidential ? 'Confidential' : 'Public'} ${kind.application} client`;
}

function ClientView({
  raw,
  onReadScopes,
}: {
  raw: string;
  onReadScopes: (scope: string) => void;
}) {
  const input = raw ? parseClientId(raw) : null;
  const hosted = input?.ok && input.kind === 'hosted' ? input.clientId : null;
  const run = useToolRun<ClientMetadataProbe | null>(hosted, ({ signal }) => fetchProbe(hosted as string, signal));

  if (!raw) {
    return (
      <ToolIntro
        items={[
          {
            term: 'The document is served correctly',
            text: (
              <>
                A <code>client_id</code> is an https URL with no port. It has to answer 200 with{' '}
                <code>application/json</code>, without redirecting, and repeat its own URL as{' '}
                <code>client_id</code>.
              </>
            ),
          },
          {
            term: 'The required fields are there',
            text: (
              <>
                <code>grant_types</code> with <code>authorization_code</code>, <code>response_types</code>{' '}
                with <code>code</code>, a <code>scope</code> that includes <code>atproto</code>, and{' '}
                <code>dpop_bound_access_tokens</code> set to true.
              </>
            ),
          },
          {
            term: 'Redirect URIs fit the client type',
            text: (
              <>
                A web client redirects to https URLs. A native client may use a scheme of its own, which
                must be the <code>client_id</code>’s hostname in reverse.
              </>
            ),
          },
          {
            term: 'A confidential client publishes its key',
            text: (
              <>
                <code>private_key_jwt</code> needs a public key in <code>jwks</code> or at a{' '}
                <code>jwks_uri</code>, one or the other. The key set itself is not fetched.
              </>
            ),
          },
        ]}
      >
        <p className="fn-tool-note fn-tool-oauth-source">
          The rules are the Clients section of the{' '}
          <a href="https://atproto.com/specs/oauth" target="_blank" rel="noreferrer">
            atproto OAuth specification
          </a>
          .
        </p>
      </ToolIntro>
    );
  }
  if (!input || !input.ok) {
    return <ToolError>{input?.reason ?? 'Enter a client_id.'}</ToolError>;
  }

  const loopback = input.kind === 'loopback' ? readLoopbackClient(input.clientId) : null;
  const probe = run.status === 'loading' ? undefined : (run.data ?? null);
  const checks = loopback ? loopback.checks : buildClientChecks(probe, input.clientId);
  const verdict = clientVerdict(checks, input.kind);
  const document = loopback ? loopback.document : probe?.document;
  const fields = typeof document === 'object' && document !== null ? (document as Record<string, unknown>) : null;
  const kind = describeKind(document);
  const scope = typeof fields?.scope === 'string' ? fields.scope : null;

  return (
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
          loopback ? (
            'Read from the URL'
          ) : run.status === 'loading' ? (
            'Checking…'
          ) : (
            <button type="button" className="fn-tool-link" onClick={run.rerun}>
              Check again
            </button>
          )
        }
      >
        <CheckList checks={toItems(checks)} label={`Checks for ${input.clientId}`} />
      </ToolSection>

      {fields && (
        <ToolSection title={loopback ? 'Implied metadata' : 'Client'}>
          <ToolCard>
            <ToolFacts>
              {typeof fields.client_name === 'string' && (
                <ToolFact label="Name" plain>
                  {fields.client_name}
                </ToolFact>
              )}
              {kind && (
                <ToolFact label="Kind" plain>
                  {kind}
                </ToolFact>
              )}
              <ToolFact label="Client ID" copy={input.clientId} wide>
                {input.clientId}
              </ToolFact>
            </ToolFacts>
            {loopback && (
              <p className="fn-tool-note fn-tool-oauth-implied">
                A server that supports this form builds the document below from the URL, and adds a{' '}
                <code>client_name</code> of its own choosing.
              </p>
            )}
            {scope && (
              <div className="fn-tool-actions">
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => onReadScopes(scope)}>
                  Read its scopes
                </button>
              </div>
            )}
          </ToolCard>
        </ToolSection>
      )}

      {fields && (
        <ToolSection title={loopback ? 'Document a server derives' : 'Document'}>
          <ToolJson value={document} label="document" />
          {!loopback && probe?.otherFields?.length ? (
            <p className="fn-tool-note fn-tool-oauth-others">
              Shown are the fields client metadata defines. The document also carries{' '}
              {probe.otherFields.map((name, index) => (
                <span key={name}>
                  {index > 0 ? ', ' : ''}
                  <code>{name}</code>
                </span>
              ))}
              , which a server ignores.
            </p>
          ) : null}
        </ToolSection>
      )}
    </>
  );
}

/**
 * Checks an OAuth client metadata document against the atproto profile, and
 * builds or reads a scope string. The rules are in src/lib/tools/oauth.ts and
 * oauthScopes.ts; this gathers the document and draws both views.
 */
export default function OAuthChecker() {
  const [query, setQuery] = useToolQuery(['view', 'client_id', 'scope'] as const);
  const view: View = query.view === 'scopes' ? 'scopes' : 'client';

  const share =
    view === 'scopes'
      ? `${toolHref(SLUG)}?view=scopes${query.scope ? `&scope=${encodeURIComponent(query.scope)}` : ''}`
      : query.client_id
        ? `${toolHref(SLUG)}?client_id=${encodeURIComponent(query.client_id)}`
        : undefined;

  return (
    <ToolShell
      slug={SLUG}
      share={share}
      form={
        <div className="fn-tool-oauth-head">
          <Segmented
            ariaLabel="What to do"
            options={VIEWS}
            value={view}
            onChange={(next) => setQuery({ view: next === 'client' ? '' : next }, { replace: true })}
          />
          {view === 'client' ? (
            <ToolForm
              value={query.client_id}
              onSubmit={(value) => setQuery({ client_id: value })}
              label="client_id to check"
              placeholder="https://app.example.com/oauth-client-metadata.json"
              examples={CLIENT_EXAMPLES}
              icon={<KeyRound size={17} />}
              mono
            />
          ) : (
            <ToolTextForm
              value={query.scope}
              onSubmit={(value) => setQuery({ scope: value.split(/\s+/).filter(Boolean).join(' ') })}
              label="Scope string to read"
              placeholder="atproto repo:app.example.post blob:*/*"
              submitLabel="Read"
              rows={3}
              examples={SCOPE_EXAMPLES}
            />
          )}
        </div>
      }
    >
      {view === 'client' ? (
        <ClientView
          raw={query.client_id}
          onReadScopes={(scope) => setQuery({ view: 'scopes', scope })}
        />
      ) : (
        <OAuthCheckerScopes scope={query.scope} onChange={(scope) => setQuery({ scope })} />
      )}
    </ToolShell>
  );
}
