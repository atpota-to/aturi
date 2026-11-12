'use client';

import { useId, useState } from 'react';
import { Check, Plus, TriangleAlert, X } from 'lucide-react';
import { Segmented } from '@/components/explore/lexicons/primitives';
import {
  REPO_ACTIONS,
  addScope,
  analyzeScopeString,
  formatScope,
  parseScope,
  removeScopeAt,
  type AccountAction,
  type AccountAttr,
  type IdentityAttr,
  type ParsedScope,
  type RepoAction,
  type ScopeDraft,
} from '@/lib/tools/oauthScopes';
import { CheckMark, type CheckStatus } from './Checks';
import { ToolCard, ToolCode, ToolIntro, ToolSection, ToolVerdict, type ToolExample } from './ToolFrame';

export const SCOPE_EXAMPLES: ToolExample[] = [
  { label: 'Sign in only', value: 'atproto' },
  { label: 'Own records and uploads', value: 'atproto repo:app.example.post repo:app.example.like blob:*/*' },
  {
    label: 'Bluesky profile lookups',
    value: 'atproto rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview',
  },
  { label: 'App password equivalent', value: 'atproto transition:generic' },
];

const STATUS: Record<ParsedScope['status'], CheckStatus> = { valid: 'pass', unknown: 'warn', invalid: 'fail' };

type Kind = ScopeDraft['resource'] | 'transition';
const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'repo', label: 'Records', hint: 'Write records of a type to the account’s repository.' },
  { id: 'rpc', label: 'API calls', hint: 'Call a service on the account’s behalf, through its PDS.' },
  { id: 'blob', label: 'Uploads', hint: 'Upload images, video and other files.' },
  { id: 'account', label: 'Account', hint: 'The account’s email address, or importing a whole repository.' },
  { id: 'identity', label: 'Identity', hint: 'The account’s handle and DID document.' },
  { id: 'include', label: 'Permission set', hint: 'A bundle of permissions a lexicon’s author published, by NSID.' },
  { id: 'transition', label: 'Transitional', hint: 'The broad scopes that stand in for an app password.' },
];

const ACTION_LABEL: Record<RepoAction, string> = { create: 'Create', update: 'Update', delete: 'Delete' };

/** Several values in one field, separated by spaces or commas. */
function values(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="fn-tool-oauth-field">
      <label htmlFor={id}>{label}</label>
      <span className="fx-field">
        <input
          id={id}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {hint && <span className="fn-tool-oauth-field-hint">{hint}</span>}
    </div>
  );
}

/**
 * The form that adds one permission. It holds the parts, writes them as a
 * scope with the same serializer the tests round-trip, and reads that scope
 * back with the parser, so what it offers to add is checked by the very
 * rules the list below applies.
 */
function ScopeBuilder({ onAdd }: { onAdd: (scope: string) => void }) {
  const [kind, setKind] = useState<Kind>('repo');
  const [collection, setCollection] = useState('');
  const [actions, setActions] = useState<RepoAction[]>([...REPO_ACTIONS]);
  const [lxm, setLxm] = useState('');
  const [aud, setAud] = useState('');
  const [accept, setAccept] = useState('*/*');
  const [accountAttr, setAccountAttr] = useState<AccountAttr>('email');
  const [accountAction, setAccountAction] = useState<AccountAction>('read');
  const [identityAttr, setIdentityAttr] = useState<IdentityAttr>('handle');
  const [nsid, setNsid] = useState('');
  const [includeAud, setIncludeAud] = useState('');
  const [transition, setTransition] = useState('generic');

  let candidate: string | null = null;
  if (kind === 'repo' && values(collection).length && actions.length) {
    candidate = formatScope({ resource: 'repo', collection: values(collection), action: actions });
  } else if (kind === 'rpc' && values(lxm).length && aud.trim()) {
    candidate = formatScope({ resource: 'rpc', lxm: values(lxm), aud: aud.trim() });
  } else if (kind === 'blob' && values(accept).length) {
    candidate = formatScope({ resource: 'blob', accept: values(accept) });
  } else if (kind === 'account') {
    candidate = formatScope({ resource: 'account', attr: accountAttr, action: accountAction });
  } else if (kind === 'identity') {
    candidate = formatScope({ resource: 'identity', attr: identityAttr });
  } else if (kind === 'include' && nsid.trim()) {
    candidate = formatScope({ resource: 'include', nsid: nsid.trim(), aud: includeAud.trim() || undefined });
  } else if (kind === 'transition') {
    candidate = `transition:${transition}`;
  }
  const parsed = candidate ? parseScope(candidate) : null;
  const current = KINDS.find((k) => k.id === kind);

  return (
    <ToolCard className="fn-tool-oauth-builder">
      <div className="fn-tool-choices" role="group" aria-label="Kind of permission">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`fn-chip${k.id === kind ? ' fn-chip-mine' : ''}`}
            aria-pressed={k.id === kind}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      {current && <p className="fn-tool-oauth-kind-hint">{current.hint}</p>}

      <div className="fn-tool-oauth-fields">
        {kind === 'repo' && (
          <>
            <Field
              label="Collection"
              value={collection}
              onChange={setCollection}
              placeholder="app.example.post"
              hint="An NSID, several separated by spaces, or * for every collection."
            />
            <div className="fn-tool-oauth-field">
              <span className="fn-tool-oauth-field-label">Actions</span>
              <div className="fn-tool-choices" role="group" aria-label="Actions">
                {REPO_ACTIONS.map((action) => {
                  const on = actions.includes(action);
                  return (
                    <button
                      key={action}
                      type="button"
                      className={`fn-chip${on ? ' fn-chip-mine' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        setActions(on ? actions.filter((a) => a !== action) : REPO_ACTIONS.filter((a) => a === action || actions.includes(a)))
                      }
                    >
                      {on && <Check size={12} aria-hidden />}
                      {ACTION_LABEL[action]}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
        {kind === 'rpc' && (
          <>
            <Field
              label="Method"
              value={lxm}
              onChange={setLxm}
              placeholder="app.bsky.actor.getProfile"
              hint="The NSID of an API method, or * for every method on one service."
            />
            <Field
              label="Service"
              value={aud}
              onChange={setAud}
              placeholder="did:web:api.bsky.app#bsky_appview"
              hint="A DID and its service fragment, or * for any service."
            />
          </>
        )}
        {kind === 'blob' && (
          <Field
            label="Accepts"
            value={accept}
            onChange={setAccept}
            placeholder="*/*"
            hint="MIME types or patterns such as image/* or video/mp4."
          />
        )}
        {kind === 'account' && (
          <>
            <div className="fn-tool-oauth-field">
              <span className="fn-tool-oauth-field-label">Attribute</span>
              <Segmented
                ariaLabel="Account attribute"
                options={[
                  { value: 'email', label: 'Email address' },
                  { value: 'repo', label: 'Repository import' },
                ]}
                value={accountAttr}
                onChange={setAccountAttr}
              />
            </div>
            <div className="fn-tool-oauth-field">
              <span className="fn-tool-oauth-field-label">Access</span>
              <Segmented
                ariaLabel="Degree of access"
                options={[
                  { value: 'read', label: 'Read' },
                  { value: 'manage', label: 'Manage' },
                ]}
                value={accountAction}
                onChange={setAccountAction}
              />
            </div>
          </>
        )}
        {kind === 'identity' && (
          <div className="fn-tool-oauth-field">
            <span className="fn-tool-oauth-field-label">Attribute</span>
            <Segmented
              ariaLabel="Identity attribute"
              options={[
                { value: 'handle', label: 'Handle' },
                { value: '*', label: 'Handle and DID document' },
              ]}
              value={identityAttr}
              onChange={setIdentityAttr}
            />
          </div>
        )}
        {kind === 'include' && (
          <>
            <Field
              label="Permission set"
              value={nsid}
              onChange={setNsid}
              placeholder="com.example.authBasicFeatures"
              hint="The NSID of a permission-set lexicon."
            />
            <Field
              label="Service (optional)"
              value={includeAud}
              onChange={setIncludeAud}
              placeholder="did:web:api.example.com#svc_appview"
              hint="Passed down to the API calls in the set that inherit their audience."
            />
          </>
        )}
        {kind === 'transition' && (
          <div className="fn-tool-oauth-field">
            <span className="fn-tool-oauth-field-label">Scope</span>
            <Segmented
              ariaLabel="Transitional scope"
              options={[
                { value: 'generic', label: 'generic' },
                { value: 'chat.bsky', label: 'chat.bsky' },
                { value: 'email', label: 'email' },
              ]}
              value={transition}
              onChange={setTransition}
            />
          </div>
        )}
      </div>

      <div className="fn-tool-oauth-preview" data-status={parsed?.status}>
        <div className="fn-tool-oauth-preview-text">
          {parsed ? (
            <>
              <code>{parsed.raw}</code>
              <span>{parsed.status === 'invalid' ? parsed.problems[0] : parsed.meaning}</span>
            </>
          ) : (
            <span>Fill in the fields above to see the scope.</span>
          )}
        </div>
        <button
          type="button"
          className="fx-btn"
          disabled={!parsed || parsed.status === 'invalid'}
          onClick={() => parsed && onAdd(parsed.raw)}
        >
          <Plus size={14} aria-hidden /> Add scope
        </button>
      </div>
    </ToolCard>
  );
}

/**
 * The scope view: the string read item by item, a form that adds to it, and
 * the result to copy. The string in the link is the only state, so every
 * list built here can be shared as it stands.
 */
export default function OAuthCheckerScopes({
  scope,
  onChange,
}: {
  scope: string;
  onChange: (scope: string) => void;
}) {
  const analysis = analyzeScopeString(scope);
  const { scopes } = analysis;
  const invalid = scopes.filter((s) => s.status === 'invalid').length;
  const unknown = scopes.filter((s) => s.status === 'unknown').length;
  const count = scopes.length === 1 ? 'one scope' : `${scopes.length} scopes`;
  const normalized = scopes.map((s) => s.raw).join(' ');

  return (
    <>
      {scopes.length > 0 && (
        <ToolVerdict
          tone={invalid > 0 || analysis.problems.length > 0 ? 'fail' : unknown > 0 ? 'warn' : 'pass'}
          title={
            invalid > 0
              ? scopes.length === 1
                ? 'This scope is not valid'
                : `${invalid} of ${scopes.length} scopes ${invalid === 1 ? 'is' : 'are'} not valid`
              : analysis.problems.length > 0
                ? 'This string would be refused'
                : unknown > 0
                  ? `${sentenceCase(count)}, ${unknown === 1 ? 'one' : unknown} outside the permission spec`
                  : `${sentenceCase(count)}, all valid`
          }
          icon={
            invalid > 0 || analysis.problems.length > 0 ? (
              <X size={18} strokeWidth={2.6} />
            ) : unknown > 0 ? (
              <TriangleAlert size={18} />
            ) : (
              <Check size={18} strokeWidth={2.6} />
            )
          }
        >
          {analysis.problems[0] ??
            (invalid > 0
              ? 'An authorization server drops or rejects a scope it cannot read.'
              : unknown > 0
                ? 'A server that does not know a resource will not grant it.'
                : 'Each one is read below, in the words a consent screen would need.')}
        </ToolVerdict>
      )}

      {scopes.length > 0 && (
        <ToolSection title="Scopes" meta={analysis.notes[0] ?? count}>
          <ol className="fx-card fn-tool-checks" aria-label="Scopes in this string">
            {scopes.map((item, index) => (
              <li key={`${index}:${item.raw}`} className="fn-tool-check" data-status={STATUS[item.status]}>
                <CheckMark status={STATUS[item.status]} />
                <div className="fn-tool-check-body">
                  <div className="fn-tool-check-head">
                    <code className="fn-tool-oauth-scope">{item.raw}</code>
                    <button
                      type="button"
                      className="fn-tool-oauth-remove"
                      aria-label={`Remove ${item.raw}`}
                      title="Remove"
                      onClick={() => onChange(removeScopeAt(scope, index))}
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                  <p className="fn-tool-check-summary">{item.meaning}</p>
                  {item.problems.map((problem) => (
                    <p key={problem} className="fn-tool-oauth-problem">
                      {problem}
                    </p>
                  ))}
                  {item.notes.map((note) => (
                    <p key={note} className="fn-tool-oauth-note">
                      {note}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </ToolSection>
      )}

      {scopes.length === 0 && (
        <ToolIntro
          title="What a scope string holds"
          items={[
            {
              term: 'atproto, always',
              text: (
                <>
                  Every atproto session asks for <code>atproto</code>. On its own it signs the account in
                  and grants nothing else.
                </>
              ),
            },
            {
              term: 'Granular permissions',
              text: (
                <>
                  One item per thing the app does: <code>repo:</code> to write a record type,{' '}
                  <code>rpc:</code> to call a service, <code>blob:</code> to upload, and{' '}
                  <code>account:</code> or <code>identity:</code> for the account itself.
                </>
              ),
            },
            {
              term: 'Permission sets',
              text: (
                <>
                  <code>include:</code> names a bundle that a lexicon’s author published, so a consent
                  screen can show one line instead of dozens.
                </>
              ),
            },
            {
              term: 'Transitional scopes',
              text: (
                <>
                  <code>transition:generic</code> and its two companions give the broad access an app
                  password had. They are meant to go away.
                </>
              ),
            },
          ]}
        >
          <p className="fn-tool-note fn-tool-oauth-source">
            The grammar is the{' '}
            <a href="https://atproto.com/specs/permission" target="_blank" rel="noreferrer">
              atproto permission specification
            </a>
            . A client’s metadata has to list every scope it might ask for.
          </p>
        </ToolIntro>
      )}

      <ToolSection title="Add a permission">
        <ScopeBuilder onAdd={(next) => onChange(addScope(scope, next))} />
      </ToolSection>

      {scopes.length > 0 && (
        <ToolSection title="Scope string">
          <div className="fn-tool-oauth-out">
            <ToolCode copy={normalized} label="scope string">
              {normalized}
            </ToolCode>
            <p className="fn-tool-note">In a client metadata document:</p>
            <ToolCode copy={`"scope": ${JSON.stringify(normalized)}`} label="metadata field">
              {`"scope": ${JSON.stringify(normalized)}`}
            </ToolCode>
          </div>
        </ToolSection>
      )}
    </>
  );
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
