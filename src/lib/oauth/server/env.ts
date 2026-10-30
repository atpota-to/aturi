/**
 * Configuration for the backend (BFF) OAuth client.
 *
 * SERVER ONLY. Never import this from a client component — it reads secrets.
 *
 * Everything here is read lazily, inside request handlers. Nothing throws at
 * module scope, and that is load-bearing twice over:
 *
 *   - CI runs `npm run build` with no secrets at all (see the annotation in
 *     .github/workflows/ci.yml). A config singleton that validated at import
 *     time — the shape the reference backend uses — turns the whole pipeline
 *     and every preview build red.
 *   - A fork that clones and deploys without provisioning a database must
 *     still work. `isBffConfigured()` returning false is how the app falls
 *     back to the public browser OAuth client it has always used.
 */

export type OAuthClientKind = 'web' | 'extension';

export const OAUTH_CLIENT_KINDS: readonly OAuthClientKind[] = ['web', 'extension'];

export function isOAuthClientKind(v: unknown): v is OAuthClientKind {
  return v === 'web' || v === 'extension';
}

export type BffConfig = {
  activeJwk: string;
  retiredJwk: string | null;
  dbUrl: string;
  dbServiceKey: string;
  dbSchema: string;
  sessionEncKey: string;
  extensionReturnOrigins: readonly string[];
  appSessionTtlDays: number;
};

function envStr(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

/**
 * The BFF is configured only when every piece is present. Partial
 * configuration is treated as unconfigured rather than half-enabled: a
 * signing key with no database, or a database with no encryption key, would
 * fail at the first request in a way that reads as an outage rather than as a
 * missing setting.
 */
export function readBffConfig(): BffConfig | null {
  const activeJwk = envStr('ATURI_OAUTH_JWK_ACTIVE');
  const dbUrl = envStr('ATURI_DB_URL');
  const dbServiceKey = envStr('ATURI_DB_SERVICE_KEY');
  const sessionEncKey = envStr('ATURI_SESSION_ENC_KEY');
  if (!activeJwk || !dbUrl || !dbServiceKey || !sessionEncKey) return null;

  const ttl = Number(envStr('ATURI_APP_SESSION_TTL_DAYS') ?? '30');

  return {
    activeJwk,
    retiredJwk: envStr('ATURI_OAUTH_JWK_RETIRED'),
    dbUrl: dbUrl.replace(/\/+$/, ''),
    dbServiceKey,
    dbSchema: envStr('ATURI_DB_SCHEMA') ?? 'aturi',
    sessionEncKey,
    extensionReturnOrigins: (envStr('ATURI_EXTENSION_RETURN_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    appSessionTtlDays: Number.isFinite(ttl) && ttl > 0 && ttl <= 365 ? ttl : 30,
  };
}

export function isBffConfigured(): boolean {
  return readBffConfig() !== null;
}

/**
 * Read the config or throw. Handlers catch this and answer 503 — an
 * unconfigured deployment is a deployment where sign-in lives somewhere else,
 * not a broken one.
 */
export function requireBffConfig(): BffConfig {
  const cfg = readBffConfig();
  if (!cfg) throw new BffNotConfiguredError();
  return cfg;
}

export class BffNotConfiguredError extends Error {
  constructor() {
    super('Backend OAuth is not configured on this deployment');
    this.name = 'BffNotConfiguredError';
  }
}

/**
 * Hosts allowed to serve confidential client metadata, and therefore to act as
 * a `client_id`. Driven from NEXT_PUBLIC_DOMAIN so a fork's own domain works
 * without a code change; aturi.to's own staging host is added when the
 * configured domain is aturi.to.
 *
 * Preview deployments are deliberately absent. `client_id` must equal the URL
 * the metadata is served from, so every preview hash would be a distinct OAuth
 * client with its own consent records — and allowlisting the pattern would
 * hand a live session to any preview build, including a fork's.
 */
export function allowedClientHosts(): string[] {
  const domain = (process.env.NEXT_PUBLIC_DOMAIN || 'aturi.to')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const hosts = [domain, `www.${domain}`];
  if (domain === 'aturi.to') hosts.push('testing.aturi.to');
  return hosts;
}
