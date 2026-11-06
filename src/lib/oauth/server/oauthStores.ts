/**
 * The two stores `@atproto/oauth-client-node` writes through.
 *
 * SERVER ONLY.
 *
 * Both hold secrets — the session store holds access and refresh tokens, the
 * state store holds the ephemeral DPoP *private* key for an in-flight
 * authorization — so both are sealed with AES-256-GCM before they reach the
 * database.
 */

import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from '@atproto/oauth-client-node';
import { requireBffConfig, type OAuthClientKind } from './env';
import { open, seal } from './crypto';
import { getStore, TABLE } from './store';

/**
 * The app-level state we thread through an authorization, carried in the
 * library's `appState` string.
 *
 * `flow` is the CSRF binding and is the reason this type exists. The library
 * keys its state store on a random `state` nonce alone and mints a session for
 * whoever presents a matching code — which is safe in a browser client, whose
 * state store is the visitor's own IndexedDB, and unsafe the moment that store
 * becomes a table every visitor shares. `flow` is hashed into a cookie (web) or
 * checked against the PKCE verifier (extension) before the code is exchanged.
 */
export type AppState = {
  flow: string;
  client: OAuthClientKind;
  return: string;
  ids: string[];
  /** base64url SHA-256 of the extension's verifier; absent for web flows. */
  challenge?: string;
};

export function parseAppState(raw: string | null): AppState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AppState>;
    if (typeof v.flow !== 'string' || !v.flow) return null;
    if (v.client !== 'web' && v.client !== 'extension') return null;
    if (typeof v.return !== 'string') return null;
    return {
      flow: v.flow,
      client: v.client,
      return: v.return,
      ids: Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === 'string') : [],
      challenge: typeof v.challenge === 'string' ? v.challenge : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * State store. Rows expire in ten minutes — an authorization a user does not
 * complete in that window is abandoned, and the row holds a private key.
 */
export class SealedStateStore implements NodeSavedStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const row = await getStore().selectOne(TABLE.oauthState, { key }, 'state_data,expires_at');
    if (!row) return undefined;
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await this.del(key);
      return undefined;
    }
    return open<NodeSavedState>(row.state_data, requireBffConfig().sessionEncKey);
  }

  async set(key: string, value: NodeSavedState): Promise<void> {
    await getStore().upsert(
      TABLE.oauthState,
      {
        key,
        state_data: seal(value, requireBffConfig().sessionEncKey),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      'key',
    );
  }

  async del(key: string): Promise<void> {
    await getStore().remove(TABLE.oauthState, { key });
  }

  /**
   * Read the app state without decrypting the DPoP key or consuming the row.
   *
   * The callback handler needs the app state *before* it calls
   * `client.callback()`, for two reasons: it is where the CSRF binding is
   * checked (rejecting after the code exchange would already have refreshed
   * the grant), and it is how the error path recovers the return target. The
   * reference implementation instead `JSON.parse`s the wire `state` parameter,
   * which is the library's opaque store key and always throws — silently
   * sending every failed staging sign-in to production.
   */
  async peekAppState(key: string): Promise<AppState | null> {
    const state = await this.get(key);
    return parseAppState(state?.appState ?? null);
  }
}

/**
 * Session store, one row per (did, client).
 *
 * `del()` is an intentional near-no-op, and this is the single most important
 * behaviour in the file. The library constructs its session getter with
 * `deleteOnError: isExpectedSessionError`, so it deletes stored tokens on *any*
 * transient refresh failure — a lost rotation race, a cold-start hiccup — which
 * permanently signs a user out even though another instance may have refreshed
 * successfully a moment earlier.
 *
 * But the reference implementation swings too far the other way and never
 * deletes at all, so a genuinely revoked grant stays in the table forever and
 * every later request pays three restore attempts plus backoff before
 * answering 401. So: delete when the PDS has told us the grant is gone, keep
 * the row otherwise.
 *
 * The resulting invariant — an absent row means a deliberate deletion, never a
 * transient failure — is what makes the cheap `?lite=1` liveness probe sound.
 */
export class SealedSessionStore implements NodeSavedSessionStore {
  constructor(private readonly client: OAuthClientKind) {}

  async get(sub: string): Promise<NodeSavedSession | undefined> {
    const row = await getStore().selectOne(
      TABLE.oauthSessions,
      { sub, client: this.client },
      'session_data',
    );
    if (!row) return undefined;
    return open<NodeSavedSession>(row.session_data, requireBffConfig().sessionEncKey);
  }

  async set(sub: string, value: NodeSavedSession): Promise<void> {
    const tokenSet = (value as { tokenSet?: { scope?: string; aud?: string } }).tokenSet;
    await getStore().upsert(
      TABLE.oauthSessions,
      {
        sub,
        client: this.client,
        session_data: seal(value, requireBffConfig().sessionEncKey),
        // Denormalised so /api/oauth/session can answer scope and PDS from one
        // row read, with no restore, no refresh and no PDS round trip.
        granted_scope: tokenSet?.scope ?? null,
        pds: tokenSet?.aud ?? null,
        updated_at: new Date().toISOString(),
      },
      'sub,client',
    );
  }

  async del(sub: string): Promise<void> {
    // See the note above: library-initiated deletes are ignored. Real deletion
    // goes through forceDelete().
    void sub;
  }

  async forceDelete(sub: string): Promise<void> {
    await getStore().remove(TABLE.oauthSessions, { sub, client: this.client });
  }
}
