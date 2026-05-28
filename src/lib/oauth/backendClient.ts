'use client';

/**
 * Backend (confidential-client) OAuth client.
 *
 * The browser counterpart to the server library under `oauth/server/`. Instead
 * of holding tokens in IndexedDB like the BrowserOAuthClient, this client keeps
 * only a long-lived opaque session token (issued by /api/oauth/callback) in
 * localStorage and routes every authenticated atproto call through the
 * same-origin BFF proxy at /api/oauth/proxy.
 *
 * It exposes the same surface `<AtprotoSessionProvider>` needs — `initialize()`,
 * `signIn()`, `signOut()`, and a proxy `agent` that structurally matches the
 * subset of `@atproto/api`'s Agent the app actually calls — so switching
 * between the two clients is invisible to the ~15 context consumers.
 */

import type { Agent } from '@atproto/api';

const STORAGE = {
  session: 'aturi.backend.session',
  did: 'aturi.backend.did',
  handle: 'aturi.backend.handle',
} as const;

const LOGIN_PATH = '/api/oauth/login';
const PROXY_PATH = '/api/oauth/proxy';
const LOGOUT_PATH = '/api/oauth/logout';
const UPLOAD_BLOB_PATH = '/api/oauth/upload-blob';
const FRONTEND_CALLBACK_PATH = '/oauth/callback';

/** Minimal session-like object the provider treats as truthy + reads `sub`/`did`. */
export type BackendSession = { did: string; sub: string };

type ProxyOptions = { atprotoProxy?: string };

class BackendOAuthClient {
  private sessionToken: string | null = null;
  private userDid: string | null = null;
  session: BackendSession | null = null;

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode / quota — non-fatal
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // non-fatal
    }
  }

  private clearUrlParams(keys: string[]): void {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const k of keys) {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      }
      if (changed) {
        const query = url.searchParams.toString();
        window.history.replaceState({}, '', url.pathname + (query ? `?${query}` : '') + url.hash);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Pick up a session from the OAuth callback (?session=&did=) or restore a
   * previously stored one. Returns a session-like object or null.
   */
  async initialize(): Promise<BackendSession | null> {
    if (typeof window === 'undefined') return null;

    const params = new URLSearchParams(window.location.search);
    const sessionFromCb = params.get('session');
    const didFromCb = params.get('did');
    const errorFromCb = params.get('error');

    if (errorFromCb) {
      this.clearUrlParams(['error']);
      throw new Error(errorFromCb);
    }

    if (sessionFromCb && didFromCb) {
      this.sessionToken = sessionFromCb;
      this.userDid = didFromCb;
      this.write(STORAGE.session, sessionFromCb);
      this.write(STORAGE.did, didFromCb);
      this.clearUrlParams(['session', 'did']);
      this.session = { did: didFromCb, sub: didFromCb };
      return this.session;
    }

    const token = this.read(STORAGE.session);
    const did = this.read(STORAGE.did);
    if (token && did) {
      this.sessionToken = token;
      this.userDid = did;
      this.session = { did, sub: did };
      return this.session;
    }
    return null;
  }

  /** Redirect to the backend login endpoint, which redirects on to the PDS. */
  async signIn(input: string, scope?: string): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!input.startsWith('did:')) this.write(STORAGE.handle, input);

    const url = new URL(LOGIN_PATH, window.location.origin);
    url.searchParams.set('handle', input);
    if (scope) url.searchParams.set('scope', scope);
    url.searchParams.set('redirect_uri', window.location.origin + FRONTEND_CALLBACK_PATH);
    window.location.href = url.toString();
  }

  async signOut(): Promise<void> {
    try {
      if (this.sessionToken) {
        await fetch(LOGOUT_PATH, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.sessionToken}` },
        });
      }
    } catch {
      // ignore network errors — we still drop local state
    }
    this.clearLocal();
  }

  private clearLocal(): void {
    this.sessionToken = null;
    this.userDid = null;
    this.session = null;
    this.remove(STORAGE.session);
    this.remove(STORAGE.did);
  }

  private async proxyCall(
    method: 'GET' | 'POST',
    xrpcMethod: string,
    params: Record<string, unknown> = {},
    body: unknown = null,
    options: ProxyOptions = {},
  ): Promise<unknown> {
    const url = new URL(PROXY_PATH, window.location.origin);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.sessionToken ?? ''}`,
      'X-XRPC-Method': xrpcMethod,
      'Content-Type': 'application/json',
    };
    if (options.atprotoProxy) headers['X-Atproto-Proxy'] = options.atprotoProxy;

    const init: RequestInit = { method, headers };
    if (body && method !== 'GET') init.body = JSON.stringify(body);

    const res = await fetch(url.toString(), init);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      // Definitive session failure — drop local state so the app shows signed-out.
      if (data.code === 'OAUTH_SESSION_MISSING' || data.code === 'FRONTEND_SESSION_INVALID') {
        this.clearLocal();
      }
      throw new Error(data.error || data.code || 'Proxy request failed');
    }
    return data.data;
  }

  private async uploadBlob(bytes: Uint8Array, opts: { encoding: string }): Promise<{ data: unknown }> {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    const res = await fetch(UPLOAD_BLOB_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.sessionToken ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blob: base64, encoding: opts.encoding }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Blob upload failed');
    return { data: data.data };
  }

  /**
   * Build an object structurally matching the subset of `@atproto/api`'s Agent
   * the app uses, routing each call through the BFF proxy. `defaultProxy`
   * threads an X-Atproto-Proxy header into every call (used by withProxy).
   */
  createProxyAgent(defaultProxy?: string): Agent {
    const self = this;
    const opts: ProxyOptions = defaultProxy ? { atprotoProxy: defaultProxy } : {};

    const repo = {
      getRecord: (p: Record<string, unknown>) =>
        self.proxyCall('GET', 'com.atproto.repo.getRecord', p, null, opts).then((data) => ({ data })),
      listRecords: (p: Record<string, unknown>) =>
        self.proxyCall('GET', 'com.atproto.repo.listRecords', p, null, opts).then((data) => ({ data })),
      putRecord: (input: Record<string, unknown>) =>
        self.proxyCall('POST', 'com.atproto.repo.putRecord', {}, input, opts).then((data) => ({ data })),
      createRecord: (input: Record<string, unknown>) =>
        self.proxyCall('POST', 'com.atproto.repo.createRecord', {}, input, opts).then((data) => ({ data })),
      deleteRecord: (input: Record<string, unknown>) =>
        self.proxyCall('POST', 'com.atproto.repo.deleteRecord', {}, input, opts).then((data) => ({ data })),
    };

    const actor = {
      getProfile: (p: Record<string, unknown>) =>
        self.proxyCall('GET', 'app.bsky.actor.getProfile', p, null, opts).then((data) => ({ data })),
    };

    const agent = {
      com: { atproto: { repo } },
      app: { bsky: { actor } },
      uploadBlob: (bytes: Uint8Array, o: { encoding: string }) => self.uploadBlob(bytes, o),
      // withProxy(serviceType, did) → header `${did}#${serviceType}` (see appview.ts)
      withProxy: (serviceType: string, did: string) => self.createProxyAgent(`${did}#${serviceType}`),
    };

    return agent as unknown as Agent;
  }
}

let instance: BackendOAuthClient | null = null;

/** Lazy singleton, mirroring getOauthClient() for the browser client. */
export function getBackendClient(): BackendOAuthClient {
  if (!instance) instance = new BackendOAuthClient();
  return instance;
}

export type { BackendOAuthClient };
