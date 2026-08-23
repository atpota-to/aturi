/**
 * Envelope encryption for OAuth material at rest, plus the hashing helpers the
 * session and exchange tables depend on.
 *
 * SERVER ONLY.
 *
 * Two things in the database are catastrophic to leak: `oauth_sessions.
 * session_data` holds the user's access and refresh tokens, and
 * `oauth_state.state_data` holds the ephemeral DPoP *private* key for an
 * in-flight authorization. Both are stored as AES-256-GCM envelopes under
 * ATURI_SESSION_ENC_KEY, which lives in the aturi Vercel project and nowhere
 * near the database credential. Database access alone then yields nothing
 * usable — which matters because the Supabase project is shared with other
 * apps and one service-role key reads all of them.
 *
 * Unlike the reference implementation this is adapted from, there is no
 * plaintext fallback. That fallback existed so a live table of unencrypted
 * rows could migrate gradually; these tables start empty, so a missing key is
 * a misconfiguration and fails closed.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENC_TAG = 'aesgcm-v1';

export type Envelope = { enc: typeof ENC_TAG; iv: string; ct: string; tag: string };

function resolveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'ATURI_SESSION_ENC_KEY must decode to 32 bytes — generate one with `openssl rand -hex 32`',
    );
  }
  return key;
}

export function isEnvelope(v: unknown): v is Envelope {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as Envelope).enc === ENC_TAG &&
    typeof (v as Envelope).iv === 'string' &&
    typeof (v as Envelope).ct === 'string' &&
    typeof (v as Envelope).tag === 'string'
  );
}

export function seal(value: unknown, rawKey: string): Envelope {
  const key = resolveKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]);
  return {
    enc: ENC_TAG,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function open<T>(stored: unknown, rawKey: string): T {
  if (!isEnvelope(stored)) {
    throw new Error('Stored OAuth material is not an AES-GCM envelope');
  }
  const key = resolveKey(rawKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** Lowercase hex SHA-256. Session and exchange tables key on this, never on the token. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Base64url SHA-256, for the extension hand-off's PKCE-style challenge. */
export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url');
}

/** A 32-byte random token, hex-encoded. */
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time string comparison. Used wherever a caller-supplied secret is
 * checked against a stored one, so a timing signal can't be used to guess it
 * byte by byte.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
