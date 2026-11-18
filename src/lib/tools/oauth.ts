/**
 * The OAuth client checker's logic: what an atproto client metadata document
 * has to say, and how to read one.
 *
 * In atproto a client is not registered with anyone. Its `client_id` is the
 * URL of a JSON document it publishes, and every authorization server fetches
 * that document and decides from it whether to deal with the client. The
 * rules below are the "Clients" section of https://atproto.com/specs/oauth,
 * one check per rule, each in the spec's own terms.
 *
 * Everything here is pure. The document is on an arbitrary host, so the read
 * happens on the server (src/app/api/tools/oauth) and arrives as a
 * `ClientMetadataProbe`. A `http://localhost` client_id is the exception: it
 * has no document at all, and its metadata is derived from the URL itself.
 */

import { analyzeScopeString } from './oauthScopes';

export type OAuthCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type OAuthCheck = {
  id: string;
  status: OAuthCheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each. */
  detail?: string[];
  /** What to change, one paragraph each. */
  fix?: string[];
};

export type OAuthVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
};

/* -------------------------------------------------------------------------- *
 * The client_id
 * -------------------------------------------------------------------------- */

export type ClientIdInput =
  /** A document on the web, to be fetched. */
  | { ok: true; kind: 'hosted'; clientId: string }
  /** The development form: no document, metadata implied by the URL. */
  | { ok: true; kind: 'loopback'; clientId: string }
  | { ok: false; reason: string };

/**
 * Decide what was typed. The string is kept exactly as given (a bare host
 * only gains its `https://`), because the document must repeat it character
 * for character and a tidied URL would hide a mismatch.
 */
export function parseClientId(raw: string): ClientIdInput {
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a client_id: the URL of a client metadata document.' };
  if (/\s/.test(value)) return { ok: false, reason: 'A client_id is a single URL, with no spaces.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a well-formed URL.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'A client_id cannot carry a username or password.' };
  }
  if (url.protocol === 'http:') {
    if (url.hostname === 'localhost') return { ok: true, kind: 'loopback', clientId: value };
    return {
      ok: false,
      reason: 'A client_id must be an https URL. The one exception is http://localhost, for development.',
    };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'A client_id must be an https URL.' };
  }
  // The URL parser drops a default port, so `:443` has to be read off the text.
  if (/^https:\/\/[^/?#]*:\d+/i.test(value)) {
    return { ok: false, reason: 'A client_id cannot include a port number.' };
  }
  if (!url.hostname.includes('.')) {
    return { ok: false, reason: 'A client_id needs a public hostname, such as app.example.com.' };
  }
  return { ok: true, kind: 'hosted', clientId: value };
}

/* -------------------------------------------------------------------------- *
 * What the server route reports
 * -------------------------------------------------------------------------- */

export type ClientMetadataProbe = {
  clientId: string;
  /** `answered`: the host returned a response, whatever its status. */
  status: 'answered' | 'error';
  httpStatus?: number;
  contentType?: string | null;
  /** Each URL a redirect led away from, in order. */
  redirectedFrom?: string[];
  finalUrl?: string;
  /**
   * The body, parsed, and cut down to the fields client metadata defines
   * (CLIENT_METADATA_FIELDS). Absent when it was not a JSON object.
   */
  document?: unknown;
  /** Names of the fields the document carried that were left out. */
  otherFields?: string[];
  /** Why there is no document: not JSON, or longer than the cap. */
  bodyProblem?: string;
  error?: string;
};

/**
 * The fields a client metadata document may carry: the ones the atproto
 * profile names, and the rest of OAuth dynamic client registration (RFC 7591)
 * that a document written for several servers is likely to include.
 *
 * The route returns these and only the names of anything else. That is what
 * the checker reads, and it keeps the route from handing back whatever JSON
 * an arbitrary address happens to serve.
 */
export const CLIENT_METADATA_FIELDS = [
  'client_id',
  'client_name',
  'client_uri',
  'logo_uri',
  'tos_uri',
  'policy_uri',
  'redirect_uris',
  'scope',
  'grant_types',
  'response_types',
  'application_type',
  'token_endpoint_auth_method',
  'token_endpoint_auth_signing_alg',
  'dpop_bound_access_tokens',
  'jwks',
  'jwks_uri',
  'contacts',
  'software_id',
  'software_version',
  'subject_type',
  'authorization_signed_response_alg',
] as const;

/** Split a parsed body into the metadata fields and the names of the rest. */
export function narrowClientMetadata(body: Record<string, unknown>): {
  document: Record<string, unknown>;
  otherFields: string[];
} {
  const known = new Set<string>(CLIENT_METADATA_FIELDS);
  const document: Record<string, unknown> = {};
  const otherFields: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (known.has(key)) document[key] = value;
    else if (otherFields.length < 40) otherFields.push(key.slice(0, 80));
  }
  return { document, otherFields };
}

/* -------------------------------------------------------------------------- *
 * Reading a document
 * -------------------------------------------------------------------------- */

type Doc = Record<string, unknown>;

function isObject(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** `app.example.com` → `com.example.app`, the scheme a native redirect must use. */
export function reverseDomain(hostname: string): string {
  return hostname.toLowerCase().split('.').reverse().join('.');
}

export type ClientKind = {
  application: 'web' | 'native';
  /** Confidential clients authenticate with a key; public ones do not. */
  confidential: boolean;
};

export function clientKind(document: unknown): ClientKind | null {
  if (!isObject(document)) return null;
  return {
    application: document.application_type === 'native' ? 'native' : 'web',
    confidential: document.token_endpoint_auth_method === 'private_key_jwt',
  };
}

/** Why a redirect URI breaks the rules for its client type, or null when it is fine. */
export function redirectUriProblem(uri: string, application: 'web' | 'native', clientId: string): string | null {
  const client = parseUrl(clientId);
  const custom = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(uri);
  const scheme = custom?.[1].toLowerCase();

  if (scheme === 'https') {
    const url = parseUrl(uri);
    if (!url) return 'not a well-formed URL';
    if (/^https:\/\/[^/?#]*:443(?=[/?#]|$)/i.test(uri)) return 'names the default port, which must be left out';
    if (application === 'native' && client && url.origin !== client.origin) {
      return `an https redirect for a native client must be on the client_id's origin, ${client.origin}`;
    }
    return null;
  }
  if (scheme === 'http') {
    return 'plain http is only allowed for the http://localhost development client';
  }
  if (application === 'web') {
    return 'a web client redirects to an https URL';
  }
  if (!custom || !scheme) return 'not a URL or an app scheme';
  // Native, with a scheme of the app's own.
  const expected = client ? reverseDomain(client.hostname) : null;
  if (expected && scheme !== expected) {
    return `the scheme must be ${expected}, the client_id's hostname in reverse`;
  }
  const rest = custom[2];
  if (!/^\/[^/]/.test(rest)) {
    return 'the scheme must be followed by one colon, one slash, then a path, such as :/callback';
  }
  return null;
}

/**
 * One row for everything that reads the document, when there is none. Nine
 * rows saying "not checked" would bury the one that says why.
 */
const NO_DOCUMENT: OAuthCheck = {
  id: 'document',
  status: 'skip',
  title: 'Fields in the document',
  summary: 'Not checked, because there is no document to read.',
};

const PENDING = (id: string, title: string): OAuthCheck => ({ id, status: 'pending', title, summary: 'Checking…' });

const TITLES = {
  served: 'Document is served',
  clientId: 'client_id matches',
  applicationType: 'Application type',
  grantTypes: 'Grant types',
  responseTypes: 'Response types',
  scope: 'Scope',
  redirectUris: 'Redirect URIs',
  dpop: 'DPoP',
  auth: 'Client authentication',
  display: 'Name and links',
} as const;

const DOCUMENT_CHECKS: [id: string, title: string][] = [
  ['client_id', TITLES.clientId],
  ['application_type', TITLES.applicationType],
  ['grant_types', TITLES.grantTypes],
  ['response_types', TITLES.responseTypes],
  ['scope', TITLES.scope],
  ['redirect_uris', TITLES.redirectUris],
  ['dpop', TITLES.dpop],
  ['auth', TITLES.auth],
  ['display', TITLES.display],
];

function servedCheck(probe: ClientMetadataProbe): OAuthCheck {
  const title = TITLES.served;
  const detail = [`GET ${probe.clientId}`];
  for (const from of probe.redirectedFrom ?? []) {
    if (from !== probe.clientId) detail.push(`→ redirected from ${from}`);
  }
  if (probe.status === 'error') {
    return {
      id: 'served',
      status: 'fail',
      title,
      summary: `The document could not be fetched: ${probe.error ?? 'no answer'}.`,
      detail,
      fix: ['Authorization servers fetch this URL from the public web. It has to answer there, over https.'],
    };
  }
  detail.push(`→ HTTP ${probe.httpStatus}${probe.contentType ? `, ${probe.contentType}` : ''}`);
  if ((probe.redirectedFrom?.length ?? 0) > 0) {
    detail.push(`→ ended at ${probe.finalUrl}`);
    return {
      id: 'served',
      status: 'fail',
      title,
      summary: 'The address redirects. The response must be a 200 at the client_id itself, not a redirect.',
      detail,
      fix: [`Serve the document at this exact URL, or use ${probe.finalUrl} as the client_id.`],
    };
  }
  if (probe.httpStatus !== 200) {
    return {
      id: 'served',
      status: 'fail',
      title,
      summary: `The address answered HTTP ${probe.httpStatus}. The status must be exactly 200.`,
      detail,
    };
  }
  if (probe.document === undefined || !isObject(probe.document)) {
    return {
      id: 'served',
      status: 'fail',
      title,
      summary: probe.bodyProblem ?? 'The body is JSON, but not an object. The document must be a JSON object.',
      detail,
    };
  }
  const mediaType = (probe.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return {
      id: 'served',
      status: 'fail',
      title,
      summary: `Served as ${mediaType || 'no content type'}. The Content-Type must be application/json.`,
      detail,
      fix: ['Set the Content-Type header for this path. A static host often picks it from the .json extension.'],
    };
  }
  return { id: 'served', status: 'pass', title, summary: 'Answers 200 with a JSON object, as application/json.', detail };
}

function clientIdCheck(doc: Doc, clientId: string): OAuthCheck {
  const title = TITLES.clientId;
  if (typeof doc.client_id !== 'string') {
    return {
      id: 'client_id',
      status: 'fail',
      title,
      summary: 'The document has no client_id. It is required, and must be the URL the document is served from.',
      fix: [`Add "client_id": "${clientId}".`],
    };
  }
  if (doc.client_id !== clientId) {
    return {
      id: 'client_id',
      status: 'fail',
      title,
      summary: 'The client_id in the document must exactly match the URL it was fetched from, character for character.',
      detail: [`fetched   ${clientId}`, `document  ${doc.client_id}`],
      fix: ['Make the two identical, including the scheme, any trailing slash and the path.'],
    };
  }
  return { id: 'client_id', status: 'pass', title, summary: 'The document names the URL it was fetched from.' };
}

function applicationTypeCheck(doc: Doc): OAuthCheck {
  const title = TITLES.applicationType;
  const value = doc.application_type;
  if (value === undefined) {
    return { id: 'application_type', status: 'info', title, summary: 'Not set, so servers treat this as a web client.' };
  }
  if (value === 'web' || value === 'native') {
    return {
      id: 'application_type',
      status: 'pass',
      title,
      summary:
        value === 'web'
          ? 'A web client: it redirects to https URLs that open in a browser.'
          : 'A native client: it may redirect to a URL scheme of its own.',
    };
  }
  return {
    id: 'application_type',
    status: 'fail',
    title,
    summary: `application_type is ${JSON.stringify(value)}. It must be web or native.`,
  };
}

function grantTypesCheck(doc: Doc): OAuthCheck {
  const title = TITLES.grantTypes;
  const values = stringArray(doc.grant_types);
  if (!values) {
    return {
      id: 'grant_types',
      status: 'fail',
      title,
      summary: 'grant_types is required, as an array of strings that includes authorization_code.',
      fix: ['Add "grant_types": ["authorization_code", "refresh_token"].'],
    };
  }
  if (!values.includes('authorization_code')) {
    return {
      id: 'grant_types',
      status: 'fail',
      title,
      summary: 'grant_types must include authorization_code. It is the only grant the atproto profile supports.',
      detail: [values.join(', ') || '(empty)'],
    };
  }
  const others = values.filter((v) => v !== 'authorization_code' && v !== 'refresh_token');
  if (others.length > 0) {
    return {
      id: 'grant_types',
      status: 'warn',
      title,
      summary: `Lists ${others.join(', ')}, which the atproto profile does not use. Only the authorization code grant is supported.`,
      detail: [values.join(', ')],
    };
  }
  return {
    id: 'grant_types',
    status: 'pass',
    title,
    summary: values.includes('refresh_token')
      ? 'Includes authorization_code, and refresh_token so sessions can be renewed.'
      : 'Includes authorization_code. Without refresh_token the client cannot refresh its tokens.',
  };
}

function responseTypesCheck(doc: Doc): OAuthCheck {
  const title = TITLES.responseTypes;
  const values = stringArray(doc.response_types);
  if (!values || !values.includes('code')) {
    return {
      id: 'response_types',
      status: 'fail',
      title,
      summary: 'response_types is required, as an array that includes code.',
      detail: values ? [values.join(', ') || '(empty)'] : undefined,
      fix: ['Add "response_types": ["code"].'],
    };
  }
  return { id: 'response_types', status: 'pass', title, summary: 'Includes code.' };
}

function scopeCheck(doc: Doc): OAuthCheck {
  const title = TITLES.scope;
  if (typeof doc.scope !== 'string') {
    return {
      id: 'scope',
      status: 'fail',
      title,
      summary: 'scope is required, as one space-separated string that includes atproto.',
      fix: ['Add "scope": "atproto", followed by every other scope the client might ask for.'],
    };
  }
  const analysis = analyzeScopeString(doc.scope);
  const names = analysis.scopes.map((s) => s.raw);
  if (!names.includes('atproto')) {
    return {
      id: 'scope',
      status: 'fail',
      title,
      summary: 'scope must include atproto. Without it no server treats this as an atproto client.',
      detail: names.length ? names : ['(empty)'],
    };
  }
  const invalid = analysis.scopes.filter((s) => s.status === 'invalid');
  const unknown = analysis.scopes.filter((s) => s.status === 'unknown');
  if (invalid.length > 0 || analysis.problems.length > 0) {
    return {
      id: 'scope',
      status: 'warn',
      title,
      summary:
        invalid.length > 0
          ? `Includes atproto, but ${invalid.length === 1 ? 'one scope is' : `${invalid.length} scopes are`} not valid under the permission spec.`
          : analysis.problems[0],
      detail: [...invalid.map((s) => `${s.raw} → ${s.problems[0]}`), ...(invalid.length ? analysis.problems : [])],
    };
  }
  const count = names.length === 1 ? 'one scope' : `${names.length} scopes`;
  return {
    id: 'scope',
    status: 'pass',
    title,
    summary:
      unknown.length > 0
        ? `Declares ${count}, including atproto. ${unknown.length === 1 ? 'One is' : `${unknown.length} are`} for a resource the permission spec does not define.`
        : `Declares ${count}, including atproto. A request can ask for any subset of these.`,
    detail: names,
  };
}

function redirectUrisCheck(doc: Doc, clientId: string): OAuthCheck {
  const title = TITLES.redirectUris;
  const values = stringArray(doc.redirect_uris);
  if (!values || values.length === 0) {
    return {
      id: 'redirect_uris',
      status: 'fail',
      title,
      summary: 'redirect_uris is required, as an array with at least one URI.',
    };
  }
  const application = doc.application_type === 'native' ? 'native' : 'web';
  const results = values.map((uri) => ({ uri, problem: redirectUriProblem(uri, application, clientId) }));
  const bad = results.filter((r) => r.problem);
  const detail = results.map((r) => (r.problem ? `${r.uri} → ${r.problem}` : r.uri));
  if (bad.length > 0) {
    return {
      id: 'redirect_uris',
      status: 'fail',
      title,
      summary: `${bad.length === 1 ? 'One redirect URI does' : `${bad.length} redirect URIs do`} not fit a ${application} client.`,
      detail,
      fix: [
        application === 'web'
          ? 'A web client’s redirect URIs are https URLs. A port is allowed, but not the default one.'
          : 'A native client’s redirect URIs use the client_id’s hostname in reverse as the scheme (com.example.app:/callback), or an https URL on the client_id’s own origin.',
      ],
    };
  }
  return {
    id: 'redirect_uris',
    status: 'pass',
    title,
    summary: `${values.length === 1 ? 'One redirect URI' : `${values.length} redirect URIs`}, in the form a ${application} client uses.`,
    detail,
  };
}

function dpopCheck(doc: Doc): OAuthCheck {
  const title = TITLES.dpop;
  if (doc.dpop_bound_access_tokens !== true) {
    return {
      id: 'dpop',
      status: 'fail',
      title,
      summary: 'dpop_bound_access_tokens must be present and true. DPoP is mandatory for every atproto client.',
      fix: ['Add "dpop_bound_access_tokens": true.'],
    };
  }
  return { id: 'dpop', status: 'pass', title, summary: 'dpop_bound_access_tokens is true.' };
}

function authCheck(doc: Doc): OAuthCheck {
  const title = TITLES.auth;
  const method = doc.token_endpoint_auth_method;
  const alg = doc.token_endpoint_auth_signing_alg;
  const hasJwks = doc.jwks !== undefined;
  const hasJwksUri = doc.jwks_uri !== undefined;

  if (alg === 'none') {
    return {
      id: 'auth',
      status: 'fail',
      title,
      summary: 'token_endpoint_auth_signing_alg is none, which is never allowed.',
      fix: ['Use ES256, or leave the field out for a public client.'],
    };
  }

  if (method === undefined || method === 'none') {
    return {
      id: 'auth',
      status: 'pass',
      title,
      summary:
        'A public client: it does not authenticate with a key. Servers limit sessions for public clients to about two weeks.',
      detail: hasJwks || hasJwksUri ? ['Keys are published, but a public client does not use them.'] : undefined,
    };
  }

  if (method !== 'private_key_jwt') {
    return {
      id: 'auth',
      status: 'fail',
      title,
      summary: `token_endpoint_auth_method is ${JSON.stringify(method)}. atproto has no client secrets: a confidential client must use private_key_jwt.`,
      fix: ['Set it to private_key_jwt and publish a public key, or to none for a public client.'],
    };
  }

  // Confidential from here on.
  if (hasJwks && hasJwksUri) {
    return {
      id: 'auth',
      status: 'fail',
      title,
      summary: 'Both jwks and jwks_uri are set. A confidential client provides one or the other, not both.',
    };
  }
  if (!hasJwks && !hasJwksUri) {
    return {
      id: 'auth',
      status: 'fail',
      title,
      summary: 'A confidential client must publish at least one public key, in jwks or at a jwks_uri.',
      fix: ['Add "jwks_uri" with the https URL of the key set, or inline the keys as "jwks": { "keys": [...] }.'],
    };
  }
  const detail: string[] = [];
  if (hasJwks) {
    const keys = isObject(doc.jwks) && Array.isArray(doc.jwks.keys) ? doc.jwks.keys : null;
    if (!keys || keys.length === 0) {
      return {
        id: 'auth',
        status: 'fail',
        title,
        summary: 'jwks must be an object with a keys array holding at least one public key.',
      };
    }
    if (keys.some((key) => isObject(key) && 'd' in key)) {
      return {
        id: 'auth',
        status: 'fail',
        title,
        summary: 'A key in jwks includes its private part (d). This document is public: publish public keys only.',
        fix: ['Remove the private key from the document and replace it, since it has been exposed.'],
      };
    }
    detail.push(`jwks: ${keys.length === 1 ? 'one key' : `${keys.length} keys`}`);
  } else {
    const url = typeof doc.jwks_uri === 'string' ? parseUrl(doc.jwks_uri) : null;
    if (!url || url.protocol !== 'https:') {
      return {
        id: 'auth',
        status: 'fail',
        title,
        summary: 'jwks_uri must be a fully qualified https URL.',
        detail: [String(doc.jwks_uri)],
      };
    }
    detail.push(`jwks_uri: ${doc.jwks_uri} (not fetched here)`);
  }
  if (alg === undefined) {
    return {
      id: 'auth',
      status: 'warn',
      title,
      summary: 'A confidential client, but token_endpoint_auth_signing_alg is not set. Servers compare it with the algorithms they support.',
      detail,
      fix: ['Add "token_endpoint_auth_signing_alg": "ES256", the algorithm every server must support.'],
    };
  }
  if (alg !== 'ES256') {
    return {
      id: 'auth',
      status: 'warn',
      title,
      summary: `A confidential client signing with ${String(alg)}. ES256 is the algorithm every server must support; others may be refused.`,
      detail,
    };
  }
  return {
    id: 'auth',
    status: 'pass',
    title,
    summary: 'A confidential client: it signs with a key (private_key_jwt, ES256), so servers may grant it longer sessions.',
    detail,
  };
}

function displayCheck(doc: Doc, clientId: string): OAuthCheck {
  const title = TITLES.display;
  const client = parseUrl(clientId);
  const problems: string[] = [];
  const detail: string[] = [];

  if (typeof doc.client_name === 'string' && doc.client_name) detail.push(`client_name: ${doc.client_name}`);
  if (doc.client_uri !== undefined) {
    const url = typeof doc.client_uri === 'string' ? parseUrl(doc.client_uri) : null;
    detail.push(`client_uri: ${String(doc.client_uri)}`);
    if (!url) problems.push('client_uri is not a URL.');
    else if (client && url.hostname !== client.hostname) {
      problems.push(`client_uri must have the same hostname as the client_id, ${client.hostname}.`);
    }
  }
  for (const field of ['logo_uri', 'tos_uri', 'policy_uri'] as const) {
    if (doc[field] === undefined) continue;
    const url = typeof doc[field] === 'string' ? parseUrl(doc[field] as string) : null;
    detail.push(`${field}: ${String(doc[field])}`);
    if (!url || url.protocol !== 'https:') problems.push(`${field} must be an https URL.`);
  }

  if (problems.length > 0) {
    return { id: 'display', status: 'fail', title, summary: problems.join(' '), detail };
  }
  const missing = (['client_name', 'client_uri', 'logo_uri', 'tos_uri', 'policy_uri'] as const).filter(
    (field) => doc[field] === undefined,
  );
  if (missing.length > 0) {
    return {
      id: 'display',
      status: 'info',
      title,
      summary: `Optional but recommended, and not set: ${missing.join(', ')}. Servers only show these for clients they trust.`,
      detail: detail.length ? detail : undefined,
    };
  }
  return {
    id: 'display',
    status: 'pass',
    title,
    summary: 'A name, a homepage on the client_id’s host, and https links for the logo, terms and policy.',
    detail,
  };
}

/**
 * Build the check list for a hosted client. `probe` undefined means the
 * fetch is still on its way; `null` means the lookup service itself failed.
 */
export function buildClientChecks(probe: ClientMetadataProbe | null | undefined, clientId: string): OAuthCheck[] {
  if (probe === undefined) {
    return [PENDING('served', TITLES.served), ...DOCUMENT_CHECKS.map(([id, title]) => PENDING(id, title))];
  }
  if (probe === null) {
    return [
      { id: 'served', status: 'fail', title: TITLES.served, summary: 'The lookup service did not answer. Try again in a moment.' },
      NO_DOCUMENT,
    ];
  }
  const served = servedCheck(probe);
  const doc = probe.document;
  if (!isObject(doc)) return [served, NO_DOCUMENT];
  return [
    served,
    clientIdCheck(doc, clientId),
    applicationTypeCheck(doc),
    grantTypesCheck(doc),
    responseTypesCheck(doc),
    scopeCheck(doc),
    redirectUrisCheck(doc, clientId),
    dpopCheck(doc),
    authCheck(doc),
    displayCheck(doc, clientId),
  ];
}

/* -------------------------------------------------------------------------- *
 * The localhost development client
 * -------------------------------------------------------------------------- */

/** The redirect URIs a loopback client gets when it names none. */
export const LOOPBACK_DEFAULT_REDIRECTS = ['http://127.0.0.1/', 'http://[::1]/'];

export type LoopbackClient = {
  checks: OAuthCheck[];
  /** The metadata a server derives from the URL, as the spec lists it. */
  document: Record<string, unknown>;
};

/**
 * Read a `http://localhost` client_id. There is nothing to fetch: the spec
 * gives this form a virtual metadata document, with the redirect URIs and
 * scope taken from the URL's own query string.
 */
export function readLoopbackClient(clientId: string): LoopbackClient {
  const url = new URL(clientId);
  const checks: OAuthCheck[] = [];

  const formProblems: string[] = [];
  if (/^http:\/\/localhost:\d+/i.test(clientId) || url.port) {
    formProblems.push('The client_id cannot name a port. Ports belong on the redirect_uri, where they are ignored when matching.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    formProblems.push('The path must be empty. Everything else goes in the query string.');
  }
  checks.push(
    formProblems.length
      ? {
          id: 'form',
          status: 'fail',
          title: 'Development client_id',
          summary: formProblems.join(' '),
          fix: ['Use http://localhost, then ?redirect_uri=… and &scope=… as needed.'],
        }
      : {
          id: 'form',
          status: 'pass',
          title: 'Development client_id',
          summary: 'The http://localhost form: plain http, the hostname localhost, no port and no path. There is no document to fetch.',
        },
  );

  const redirects = url.searchParams.getAll('redirect_uri');
  const redirectProblems = redirects
    .map((uri) => {
      const parsed = parseUrl(uri);
      if (!parsed) return `${uri} → not a well-formed URL`;
      if (parsed.protocol !== 'http:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]')) {
        return `${uri} → must be an http URL on 127.0.0.1 or [::1]`;
      }
      return null;
    })
    .filter((problem): problem is string => problem !== null);
  if (redirectProblems.length > 0) {
    checks.push({
      id: 'redirect_uris',
      status: 'fail',
      title: TITLES.redirectUris,
      summary: 'A development client redirects to http://127.0.0.1 or http://[::1]. The path must match; the port is ignored.',
      detail: redirectProblems,
      fix: ['Use the loopback address rather than the name localhost, for example http://127.0.0.1:8080/callback.'],
    });
  } else {
    checks.push({
      id: 'redirect_uris',
      status: 'pass',
      title: TITLES.redirectUris,
      summary: redirects.length
        ? 'Loopback redirect URIs. The path must match on the way back; the port is ignored.'
        : 'None given, so the defaults apply.',
      detail: redirects.length ? redirects : LOOPBACK_DEFAULT_REDIRECTS,
    });
  }

  const scopes = url.searchParams.getAll('scope');
  const scope = scopes[0] ?? 'atproto';
  if (scopes.length > 1) {
    checks.push({
      id: 'scope',
      status: 'fail',
      title: TITLES.scope,
      summary: 'scope can be given once, as a single space-separated value.',
    });
  } else if (!scope.split(/\s+/).includes('atproto')) {
    checks.push({
      id: 'scope',
      status: 'fail',
      title: TITLES.scope,
      summary: 'scope must include atproto.',
      detail: [scope],
    });
  } else {
    checks.push({
      id: 'scope',
      status: 'pass',
      title: TITLES.scope,
      summary: scopes.length ? 'Includes atproto.' : 'Not given, so it defaults to atproto.',
      detail: scope.split(/\s+/).filter(Boolean),
    });
  }

  const extra = [...new Set([...url.searchParams.keys()])].filter((key) => key !== 'redirect_uri' && key !== 'scope');
  if (extra.length > 0) {
    checks.push({
      id: 'params',
      status: 'warn',
      title: 'Other parameters',
      summary: `Only redirect_uri and scope are read from the URL. Not used: ${extra.join(', ')}.`,
    });
  }

  checks.push({
    id: 'support',
    status: 'info',
    title: 'Server support',
    summary: 'Authorization servers are encouraged to accept this form, but it is optional. It always works as a public, native client.',
  });

  return {
    checks,
    document: {
      client_id: clientId,
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: redirects.length ? redirects : LOOPBACK_DEFAULT_REDIRECTS,
      scope,
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Verdict
 * -------------------------------------------------------------------------- */

export function clientVerdict(checks: OAuthCheck[], kind: 'hosted' | 'loopback'): OAuthVerdict {
  if (checks.some((c) => c.status === 'pending')) {
    return { tone: 'pending', title: 'Fetching the client metadata', text: 'Reading the document at the client_id.' };
  }
  const failures = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  if (failures.length > 0) {
    return {
      tone: 'fail',
      title:
        failures.length === 1
          ? 'One rule of the atproto profile is not met'
          : `${failures.length} rules of the atproto profile are not met`,
      text: failures[0].summary,
    };
  }
  if (warnings.length > 0) {
    return {
      tone: 'warn',
      title: `Valid, with ${warnings.length === 1 ? 'one thing' : `${warnings.length} things`} to look at`,
      text: warnings[0].summary,
    };
  }
  return {
    tone: 'pass',
    title: kind === 'loopback' ? 'A valid development client_id' : 'This client metadata meets the atproto profile',
    text:
      kind === 'loopback'
        ? 'Servers that support the localhost exception derive the metadata below from the URL.'
        : 'Every required field is present and in the form authorization servers enforce.',
  };
}
