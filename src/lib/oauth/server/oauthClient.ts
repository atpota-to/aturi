/**
 * Confidential OAuth client wrapper (singleton) built on
 * @atproto/oauth-client-node. Holds and refreshes the real atproto tokens
 * server-side so the browser only ever sees a long-lived opaque session token.
 *
 * Ported from anisota-cocoon/lib/oauth-client.js. Server-only.
 */

import { NodeOAuthClient, type NodeSavedSession } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import {
  AtprotoDohHandleResolver,
  asResolvedHandle,
  type HandleResolver,
} from '@atproto-labs/handle-resolver';
import { Agent } from '@atproto/api';
import { APPVIEW } from '@/utils/atproto/config';
import { getClientMetadata, oauthPrivateKeys } from './config';
import { sessionStore, stateStore, requestLock } from './storage';

// The session object returned by NodeOAuthClient (restore/callback) is shaped
// like an XRPC client and can be handed straight to @atproto/api's Agent.
type OAuthSession = ConstructorParameters<typeof Agent>[0] & {
  did: string;
  signOut?: () => Promise<void>;
};

class OAuthClientWrapper {
  private client: NodeOAuthClient | null = null;
  // Lazily constructed on first use so importing this module at build time
  // (where no env / keys are present) has no side effects.
  private initPromise: Promise<NodeOAuthClient> | null = null;

  private async prepareKeyset(): Promise<JoseKey[]> {
    const keyset: JoseKey[] = [];
    for (const jwk of oauthPrivateKeys) {
      try {
        keyset.push(await JoseKey.fromImportable(jwk as never, jwk.kid));
      } catch (err) {
        console.warn(`[oauth] failed to load key ${jwk.kid}:`, (err as Error).message);
      }
    }
    return keyset;
  }

  /**
   * DNS-over-HTTPS first (authoritative for did:web / migrated handles), then
   * HTTP fallback to the public AppView. Mirrors the resolver used by the
   * browser client in src/lib/oauth/client.ts.
   */
  private createHandleResolver(): HandleResolver {
    const doh = new AtprotoDohHandleResolver({ dohEndpoint: 'https://dns.google/resolve' });
    return {
      async resolve(handle, options) {
        try {
          const did = await doh.resolve(handle, options);
          if (did) return did;
        } catch {
          // fall through to the HTTP fallback
        }
        const res = await fetch(
          `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
          { signal: options?.signal },
        );
        if (!res.ok) throw new Error(`Failed to resolve identity: ${handle}`);
        const { did } = (await res.json()) as { did?: string };
        return did ? asResolvedHandle(did) : null;
      },
    };
  }

  private async initialize(): Promise<NodeOAuthClient> {
    const keyset = await this.prepareKeyset();
    this.client = new NodeOAuthClient({
      clientMetadata: getClientMetadata(),
      keyset,
      stateStore,
      sessionStore,
      requestLock,
      handleResolver: this.createHandleResolver(),
    });
    return this.client;
  }

  private async ensure(): Promise<NodeOAuthClient> {
    if (this.client) return this.client;
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }

  /** Build the authorize URL to redirect the user to their PDS. */
  async generateLoginUrl(
    handle: string,
    options: { scope: string; state: string },
  ): Promise<string> {
    const client = await this.ensure();
    const url = await client.authorize(handle, options);
    return url instanceof URL ? url.toString() : String(url);
  }

  /** Exchange the ?code=&state= callback for a session. */
  async handleCallback(
    params: URLSearchParams,
  ): Promise<{ userDID: string; session: OAuthSession; state: string | null }> {
    const client = await this.ensure();
    const { session, state } = await client.callback(params);
    return { userDID: session.did, session: session as unknown as OAuthSession, state };
  }

  /** Restore a session (refreshing tokens if needed) for a known DID. */
  async restoreSession(did: string): Promise<OAuthSession | null> {
    try {
      const client = await this.ensure();
      const session = await client.restore(did);
      return (session as unknown as OAuthSession) ?? null;
    } catch (err) {
      console.warn(`[oauth] restore failed for ${did}:`, (err as Error).message);
      return null;
    }
  }

  /** Revoke tokens with the PDS (best effort). */
  async revokeSession(did: string): Promise<boolean> {
    try {
      const client = await this.ensure();
      const session = (await client.restore(did)) as unknown as OAuthSession | null;
      if (session?.signOut) {
        try {
          await session.signOut();
        } catch {
          await client.revoke(did);
        }
      } else {
        await client.revoke(did);
      }
      return true;
    } catch (err) {
      console.warn(`[oauth] revoke failed for ${did}:`, (err as Error).message);
      return false;
    }
  }

  async getJWKS() {
    const client = await this.ensure();
    return client.jwks;
  }

  getClientMetadata() {
    return getClientMetadata();
  }
}

export const oauthClient = new OAuthClientWrapper();
export type { OAuthSession, NodeSavedSession };
