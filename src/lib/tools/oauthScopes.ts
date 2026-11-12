/**
 * Reading and writing atproto OAuth scope strings.
 *
 * A scope string is a space-separated list. Three kinds of item can appear:
 *
 *   atproto                 required by every atproto session (specs/oauth)
 *   transition:generic      the three "transitional" scopes that stand in for
 *   transition:chat.bsky    app-password access (specs/oauth)
 *   transition:email
 *   resource:positional?name=value&name=value
 *                           a granular permission (specs/permission)
 *
 * The permission spec defines five resources (`repo`, `rpc`, `blob`,
 * `account`, `identity`) and one meta resource (`include`, a permission set
 * by NSID). Each has one parameter that may be written after the colon
 * instead of by name: `repo:app.example.post` and
 * `repo?collection=app.example.post` are the same permission. Everything
 * here follows https://atproto.com/specs/permission; a resource it does not
 * list is reported as unknown rather than guessed at, since servers add
 * resources (this site's own client asks for a `space:` permission that is
 * still a proposal).
 *
 * Pure, so the page and the tests share it.
 */

import { isValidNsid } from '@/utils/atproto/spaceUri';

export type RepoAction = 'create' | 'update' | 'delete';
export const REPO_ACTIONS: readonly RepoAction[] = ['create', 'update', 'delete'];

export type AccountAttr = 'email' | 'repo';
export type AccountAction = 'read' | 'manage';
export type IdentityAttr = 'handle' | '*';

/** A permission in parts, as the builder holds it before it becomes a string. */
export type ScopeDraft =
  | { resource: 'repo'; collection: string[]; action: RepoAction[] }
  | { resource: 'rpc'; lxm: string[]; aud: string }
  | { resource: 'blob'; accept: string[] }
  | { resource: 'account'; attr: AccountAttr; action: AccountAction }
  | { resource: 'identity'; attr: IdentityAttr }
  | { resource: 'include'; nsid: string; aud?: string };

export type ScopeKind = 'atproto' | 'transition' | ScopeDraft['resource'] | 'unknown';

export type ParsedScope = {
  /** The item exactly as written. */
  raw: string;
  kind: ScopeKind;
  /**
   * `valid`: a scope the specs define, well formed. `unknown`: well formed,
   * but a resource the permission spec does not list. `invalid`: breaks the
   * syntax or the rules of its resource.
   */
  status: 'valid' | 'unknown' | 'invalid';
  /** What it grants, in a sentence. */
  meaning: string;
  /** Why it is invalid. Empty otherwise. */
  problems: string[];
  /** Worth knowing, but not wrong. */
  notes: string[];
  /** The permission in parts, for a valid granular scope. */
  draft?: ScopeDraft;
};

export type ScopeAnalysis = {
  scopes: ParsedScope[];
  /** What is wrong with the string as a whole. */
  problems: string[];
  notes: string[];
};

export const TRANSITION_SCOPES: Record<string, string> = {
  'transition:generic':
    'Broad access, equal to an app password: write any record, upload blobs, read and write preferences, and call most APIs. No account management and no DMs.',
  'transition:chat.bsky':
    'Direct messages: the chat.bsky APIs, as the “DM access” toggle on an app password allows.',
  'transition:email': 'Read the account’s email address and whether it is confirmed.',
};

/* -------------------------------------------------------------------------- *
 * Syntax
 * -------------------------------------------------------------------------- */

type ScopeSyntax = {
  resource: string;
  /** The part after the colon, decoded. Null when there is no colon. */
  positional: string | null;
  params: [name: string, value: string][];
  /** Parameters that are not `name=value`. */
  malformed: string[];
};

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Split one scope into its parts. Null when it falls outside the general
 * syntax altogether: the spec allows only printable, non-whitespace ASCII.
 */
function parseSyntax(raw: string): ScopeSyntax | null {
  if (!/^[\x21-\x7e]+$/.test(raw)) return null;
  const question = raw.indexOf('?');
  const head = question === -1 ? raw : raw.slice(0, question);
  const query = question === -1 ? '' : raw.slice(question + 1);
  const colon = head.indexOf(':');
  const resource = colon === -1 ? head : head.slice(0, colon);
  if (!resource) return null;

  let positional: string | null = null;
  if (colon !== -1) {
    positional = decode(head.slice(colon + 1));
    if (positional === null) return null;
  }

  const params: [string, string][] = [];
  const malformed: string[] = [];
  for (const pair of query ? query.split('&') : []) {
    const equals = pair.indexOf('=');
    const name = equals === -1 ? null : decode(pair.slice(0, equals));
    const value = equals === -1 ? null : decode(pair.slice(equals + 1));
    if (!name || value === null || value === '') malformed.push(pair);
    else params.push([name, value]);
  }
  return { resource, positional, params, malformed };
}

/**
 * Percent-encode a value for a scope string. The spec's own examples leave
 * `:`, `/` and `*` bare and encode `#` (`aud=did:web:api.example.com%23svc`),
 * which is `encodeURIComponent` with two characters put back.
 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/%3A/g, ':').replace(/%2F/g, '/');
}

/* -------------------------------------------------------------------------- *
 * Semantics, one resource at a time
 * -------------------------------------------------------------------------- */

type ParamShape = 'one' | 'many';

/** Each resource's parameters, and which one may be written after the colon. */
const RESOURCES: Record<ScopeDraft['resource'], { positional: string; params: Record<string, ParamShape> }> = {
  repo: { positional: 'collection', params: { collection: 'many', action: 'many' } },
  rpc: { positional: 'lxm', params: { lxm: 'many', aud: 'one' } },
  blob: { positional: 'accept', params: { accept: 'many' } },
  account: { positional: 'attr', params: { attr: 'one', action: 'one' } },
  identity: { positional: 'attr', params: { attr: 'one' } },
  // The spec only ever writes the set's NSID after the colon and never names
  // the parameter, so the by-name form is not accepted here.
  include: { positional: '', params: { aud: 'one' } },
};

const MIME_PATTERN = /^(\*\/\*|[A-Za-z0-9!#$&^_.+-]+\/(\*|[A-Za-z0-9!#$&^_.+-]+))$/;
/** A DID followed by the required service fragment, e.g. `did:web:api.example.com#svc`. */
const AUD_PATTERN = /^did:[a-z]+:[A-Za-z0-9._:%-]+#[A-Za-z0-9._~-]+$/;

function list(values: string[], all: string): string {
  if (values.includes('*')) return all;
  if (values.length === 0) return 'nothing';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Reading = { meaning: string; problems: string[]; notes: string[]; draft?: ScopeDraft };

/** Collect a resource's parameters by name, reporting what the syntax got wrong. */
function gather(
  syntax: ScopeSyntax,
  resource: ScopeDraft['resource'],
  problems: string[],
): Record<string, string[]> {
  const spec = RESOURCES[resource];
  const values: Record<string, string[]> = {};
  if (syntax.positional !== null && spec.positional) {
    if (syntax.positional === '') problems.push(`Nothing follows the colon. Write ${resource}:<${spec.positional}>.`);
    else values[spec.positional] = [syntax.positional];
  }
  for (const pair of syntax.malformed) {
    problems.push(`“${pair}” is not a name=value parameter.`);
  }
  for (const [name, value] of syntax.params) {
    if (!(name in spec.params)) {
      problems.push(`${name} is not a parameter of ${resource} permissions.`);
      continue;
    }
    if (name === spec.positional && syntax.positional !== null) {
      problems.push(`${name} is given after the colon and again as a parameter. Use one form.`);
      continue;
    }
    (values[name] ??= []).push(value);
  }
  for (const [name, shape] of Object.entries(spec.params)) {
    if (shape === 'one' && (values[name]?.length ?? 0) > 1) {
      problems.push(`${name} takes a single value.`);
    }
  }
  return values;
}

function checkNsids(values: string[], what: string, problems: string[]): void {
  for (const value of values) {
    if (value === '*') continue;
    if (value.includes('*')) {
      problems.push(`${value} is a partial wildcard, which is not supported. Use * or a full NSID.`);
    } else if (!isValidNsid(value)) {
      problems.push(`${value} is not a valid NSID for ${what}.`);
    }
  }
}

function readRepo(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const notes: string[] = [];
  const values = gather(syntax, 'repo', problems);
  const collection = values.collection ?? [];
  const action = values.action ?? [];
  if (collection.length === 0 && syntax.positional !== '') {
    problems.push('A repo permission needs a collection: an NSID, or * for every collection.');
  }
  checkNsids(collection, 'a record type', problems);
  for (const value of action) {
    if (!(REPO_ACTIONS as readonly string[]).includes(value)) {
      problems.push(`${value} is not an action. The actions are create, update and delete.`);
    }
  }
  if (new Set(action).size !== action.length) problems.push('Each action can be listed once.');
  if (collection.includes('*')) notes.push('A wildcard collection cannot be used inside a permission set, only in a scope string.');

  const actions = REPO_ACTIONS.filter((a) => action.length === 0 || action.includes(a));
  const verbs = actions.length === 3 ? 'create, update and delete' : actions.join(' and ');
  return {
    meaning: sentence(`${verbs} records in ${list(collection, 'every collection')}.`),
    problems,
    notes,
    draft: problems.length ? undefined : { resource: 'repo', collection, action: actions },
  };
}

function readRpc(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const values = gather(syntax, 'rpc', problems);
  const lxm = values.lxm ?? [];
  const aud = values.aud?.[0];
  if (lxm.length === 0 && syntax.positional !== '') {
    problems.push('An rpc permission needs a method: an NSID, or * for every method.');
  }
  checkNsids(lxm, 'an API method', problems);
  if (!aud) {
    problems.push('An rpc scope always needs aud: the service it may call, as a DID and service fragment, or *.');
  } else if (aud !== '*' && !AUD_PATTERN.test(aud)) {
    problems.push(`${aud} is not a service reference. Write a DID followed by its service fragment, such as did:web:api.example.com#svc_appview.`);
  }
  if (aud === '*' && lxm.includes('*')) {
    problems.push('The method and the audience cannot both be *. Any method on any service is not a permission that can be granted.');
  }
  return {
    meaning: `Call ${list(lxm, 'any API method')} on ${!aud ? 'a service' : aud === '*' ? 'any service' : aud}.`,
    problems,
    notes: [],
    draft: problems.length || !aud ? undefined : { resource: 'rpc', lxm, aud },
  };
}

function readBlob(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const values = gather(syntax, 'blob', problems);
  const accept = values.accept ?? [];
  if (accept.length === 0 && syntax.positional !== '') {
    problems.push('A blob permission needs the MIME types it accepts, such as */* or image/*.');
  }
  for (const value of accept) {
    if (!MIME_PATTERN.test(value)) problems.push(`${value} is not a MIME type or pattern such as image/* or */*.`);
  }
  return {
    meaning: accept.includes('*/*') ? 'Upload files of any type.' : `Upload ${list(accept, 'any')} files.`,
    problems,
    notes: ['Blob permissions cannot be part of a permission set. They are always requested directly.'],
    draft: problems.length ? undefined : { resource: 'blob', accept },
  };
}

function readAccount(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const notes: string[] = [];
  const values = gather(syntax, 'account', problems);
  const attr = values.attr?.[0];
  const action = values.action?.[0] ?? 'read';
  if (!attr) {
    if (syntax.positional !== '') problems.push('An account permission needs an attribute: email or repo.');
  } else if (attr !== 'email' && attr !== 'repo') {
    problems.push(`${attr} is not an account attribute. The attributes are email and repo, and a wildcard is not supported.`);
  }
  if (action !== 'read' && action !== 'manage') {
    problems.push(`${action} is not an action. An account permission takes read or manage.`);
  }
  let meaning = 'Control part of the account’s hosting details.';
  if (attr === 'email') {
    meaning =
      action === 'manage'
        ? 'Read and change the account’s email address.'
        : 'Read the account’s email address and whether it is confirmed.';
  } else if (attr === 'repo') {
    meaning =
      action === 'manage'
        ? 'Replace the whole repository from a CAR file, as an account migration does.'
        : 'Nothing: reading the repository needs no permission.';
    if (action !== 'manage') notes.push('account:repo only does something with action=manage.');
  }
  return {
    meaning,
    problems,
    notes,
    draft:
      problems.length || !attr
        ? undefined
        : { resource: 'account', attr: attr as AccountAttr, action: action as AccountAction },
  };
}

function readIdentity(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const values = gather(syntax, 'identity', problems);
  const attr = values.attr?.[0];
  if (!attr) {
    if (syntax.positional !== '') problems.push('An identity permission needs an attribute: handle, or * for full control.');
  } else if (attr !== 'handle' && attr !== '*') {
    problems.push(`${attr} is not an identity attribute. The attributes are handle and *.`);
  }
  return {
    meaning: attr === '*' ? 'Full control of the account’s DID document and handle.' : 'Change the account’s handle.',
    problems,
    notes:
      attr === '*' || attr === 'handle'
        ? ['A PDS can only act on this when it controls the DID document, which it does not for a did:web account.']
        : [],
    draft: problems.length || !attr ? undefined : { resource: 'identity', attr: attr as IdentityAttr },
  };
}

function readInclude(syntax: ScopeSyntax): Reading {
  const problems: string[] = [];
  const notes: string[] = [];
  const values = gather(syntax, 'include', problems);
  const nsid = syntax.positional ?? '';
  const aud = values.aud?.[0];
  if (!nsid) {
    problems.push('Name the permission set after the colon: include:<NSID>.');
  } else if (!isValidNsid(nsid)) {
    problems.push(`${nsid} is not a valid NSID for a permission set.`);
  }
  if (aud && aud !== '*' && !AUD_PATTERN.test(aud)) {
    problems.push(`${aud} is not a service reference. Write a DID followed by its service fragment.`);
  }
  if (!aud) {
    notes.push('No aud is given, so any API calls in the set that inherit their audience are dropped.');
  }
  return {
    meaning: `Everything in the permission set ${nsid || '(unnamed)'}${
      aud ? `, with its inherited API calls sent to ${aud === '*' ? 'any service' : aud}` : ''
    }.`,
    problems,
    notes,
    draft: problems.length || !nsid ? undefined : { resource: 'include', nsid, ...(aud ? { aud } : {}) },
  };
}

const READERS: Record<ScopeDraft['resource'], (syntax: ScopeSyntax) => Reading> = {
  repo: readRepo,
  rpc: readRpc,
  blob: readBlob,
  account: readAccount,
  identity: readIdentity,
  include: readInclude,
};

/** Read one item of a scope string. */
export function parseScope(raw: string): ParsedScope {
  const base = { raw, notes: [] as string[] };
  if (raw === 'atproto') {
    return {
      ...base,
      kind: 'atproto',
      status: 'valid',
      meaning: 'Required. Says the client follows the atproto OAuth profile. On its own it only identifies the account.',
      problems: [],
    };
  }

  const syntax = parseSyntax(raw);
  if (!syntax) {
    return {
      ...base,
      kind: 'unknown',
      status: 'invalid',
      meaning: 'Not a scope.',
      problems: ['A scope can only use printable ASCII characters, with anything else percent-encoded.'],
    };
  }

  if (syntax.resource === 'atproto') {
    return {
      ...base,
      kind: 'atproto',
      status: 'invalid',
      meaning: 'The atproto scope, with something added to it.',
      problems: ['atproto takes no parameters. Write it on its own.'],
    };
  }

  if (syntax.resource === 'transition') {
    const meaning = TRANSITION_SCOPES[raw];
    return meaning
      ? {
          ...base,
          kind: 'transition',
          status: 'valid',
          meaning,
          problems: [],
          notes: ['A transitional scope. The intent is to retire these in favour of granular permissions.'],
        }
      : {
          ...base,
          kind: 'transition',
          status: 'invalid',
          meaning: 'Not one of the transitional scopes.',
          problems: ['The transitional scopes are transition:generic, transition:chat.bsky and transition:email.'],
        };
  }

  if (Object.hasOwn(READERS, syntax.resource)) {
    const kind = syntax.resource as ScopeDraft['resource'];
    const reading = READERS[kind](syntax);
    const notes = reading.problems.length ? [] : reading.notes;
    // Both forms parse, but every example in the spec encodes it, and so do
    // the servers' own scope formatters.
    if (!reading.problems.length && raw.includes('#')) {
      notes.push('Write the # in a service reference as %23, as the spec’s examples do.');
    }
    return {
      raw,
      kind,
      status: reading.problems.length ? 'invalid' : 'valid',
      meaning: reading.meaning,
      problems: reading.problems,
      notes,
      draft: reading.draft,
    };
  }

  return {
    ...base,
    kind: 'unknown',
    status: 'unknown',
    meaning: `A “${syntax.resource}” permission, which the permission spec does not define.`,
    problems: [],
    notes: [
      'The spec defines repo, rpc, blob, account, identity and include. A server that does not know this resource will not grant it.',
    ],
  };
}

/** Split a scope string into its items, on any run of whitespace. */
export function splitScopes(input: string): string[] {
  return input.split(/\s+/).filter(Boolean);
}

/** Read a whole scope string: every item, and what is wrong with the set. */
export function analyzeScopeString(input: string): ScopeAnalysis {
  const items = splitScopes(input);
  const scopes = items.map(parseScope);
  const problems: string[] = [];
  const notes: string[] = [];

  if (items.length > 0 && !items.includes('atproto')) {
    problems.push('The atproto scope is missing. Every atproto session has to ask for it.');
  }
  if (items.includes('transition:chat.bsky') && !items.includes('transition:generic')) {
    problems.push('transition:chat.bsky does nothing without transition:generic.');
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) repeated.add(item);
    seen.add(item);
  }
  if (repeated.size > 0) {
    notes.push(`Listed more than once: ${[...repeated].join(', ')}.`);
  }
  return { scopes, problems, notes };
}

/* -------------------------------------------------------------------------- *
 * Writing
 * -------------------------------------------------------------------------- */

function withPositional(resource: string, name: string, values: string[], rest: string[]): string {
  // One value goes after the colon; several can only be written by name.
  if (values.length === 1) {
    return `${resource}:${encode(values[0])}${rest.length ? `?${rest.join('&')}` : ''}`;
  }
  const params = [...values.map((value) => `${name}=${encode(value)}`), ...rest];
  return `${resource}?${params.join('&')}`;
}

/**
 * Write a permission as a scope. Defaults are left out, as the spec's
 * examples do: all three repo actions is the same as none listed, and an
 * account permission reads unless it says otherwise.
 */
export function formatScope(draft: ScopeDraft): string {
  switch (draft.resource) {
    case 'repo': {
      const actions = REPO_ACTIONS.filter((a) => draft.action.includes(a));
      const rest = actions.length === 0 || actions.length === 3 ? [] : actions.map((a) => `action=${a}`);
      return withPositional('repo', 'collection', draft.collection, rest);
    }
    case 'rpc':
      return withPositional('rpc', 'lxm', draft.lxm, [`aud=${encode(draft.aud)}`]);
    case 'blob':
      return withPositional('blob', 'accept', draft.accept, []);
    case 'account':
      return `account:${draft.attr}${draft.action === 'manage' ? '?action=manage' : ''}`;
    case 'identity':
      return `identity:${draft.attr}`;
    case 'include':
      return `include:${encode(draft.nsid)}${draft.aud ? `?aud=${encode(draft.aud)}` : ''}`;
  }
}

/** Add an item to a scope string, keeping `atproto` first and skipping a repeat. */
export function addScope(input: string, scope: string): string {
  const items = splitScopes(input);
  if (!items.includes('atproto')) items.unshift('atproto');
  if (scope && !items.includes(scope)) items.push(scope);
  return items.join(' ');
}

/** Remove the item at `index` from a scope string. */
export function removeScopeAt(input: string, index: number): string {
  return splitScopes(input)
    .filter((_, i) => i !== index)
    .join(' ');
}
