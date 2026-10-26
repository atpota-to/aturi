/**
 * DPoP proofs for permissioned-space credentials (RFC 9449), on WebCrypto.
 *
 * A space credential reads *every* member's repo in a space and is presented to
 * every repo host in it. As a plain bearer token it would be a shared secret:
 * a host handed one to serve its own repo could replay it against every other
 * host in the space. So the credential is bound at issuance to a keypair this
 * module generates, and each request carries a fresh proof signed by that key
 * naming the host and method it is addressed to.
 *
 * Everything here is pure WebCrypto — no network, no state, no dependency. It
 * mirrors `@atproto/space`'s `dpop.ts` (which is built on `jose`) closely
 * enough that the alpha PDS's `verifyDpopProof` accepts what we emit, but that
 * package is not a dependency of this repo and must not become one.
 *
 * Nothing in this file may log, return, or otherwise surface a credential or
 * private key. `SpaceDpopKey.privateKey` is a non-extractable `CryptoKey`: even
 * script running on this origin cannot read the key material out of it, only
 * ask the platform to sign with it while the page lives.
 */

/** The one signing algorithm the space protocol accepts for DPoP proofs. */
const SIGNING_ALG = 'ES256';

/** RFC 9449's media type for a DPoP proof, carried in the JWS `typ` header. */
const DPOP_PROOF_TYP = 'dpop+jwt';

const ECDSA_KEY_PARAMS: EcKeyGenParams = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};

const ECDSA_SIGN_PARAMS: EcdsaParams = {
  name: 'ECDSA',
  hash: 'SHA-256',
};

/**
 * A "bare" public JWK: exactly the four members RFC 7638 designates as
 * required for an EC key, and nothing else. The set is closed on purpose —
 * `EmbeddedJWK` verification on the far side rejects a header JWK that carries
 * private material, and by then we would already have published it.
 */
export type SpaceEcJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export type SpaceDpopKey = {
  /** Non-extractable ECDSA P-256 private key. Never leaves the browser. */
  readonly privateKey: CryptoKey;
  /** Bare public JWK — exactly kty, crv, x, y. Embedded in every proof header. */
  readonly publicJwk: SpaceEcJwk;
  /** RFC 7638 thumbprint, base64url unpadded (43 chars). Matches cnf.jkt. */
  readonly jkt: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Inverse of the above. Returns `null` rather than throwing on malformed
 * input, because its only caller is reading an attacker-reachable string.
 */
function base64UrlDecode(input: string): Uint8Array | null {
  if (/[^A-Za-z0-9_-]/.test(input)) return null;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return base64UrlEncode(digest);
}

function jsonToBase64Url(value: Record<string, unknown>): string {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
}

/**
 * RFC 7638 JWK thumbprint.
 *
 * The canonicalization is the whole point and is not negotiable: a fresh
 * object literal holding only the required members, in *lexicographic* key
 * order (crv, kty, x, y), serialized with no whitespace. That is deliberately
 * a different order from the one the proof header uses, so the header JWK is
 * never fed to this function directly — its members are re-listed below.
 */
export async function jwkThumbprint(jwk: SpaceEcJwk): Promise<string> {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return sha256Base64Url(canonical);
}

/**
 * Mint a keypair for one space credential. The proposal asks for a new keypair
 * per credential, and the private half is generated non-extractable so it
 * cannot be exfiltrated, serialized, or persisted even by code running on this
 * origin. WebCrypto still exports the public half regardless.
 */
export async function generateSpaceDpopKey(): Promise<SpaceDpopKey> {
  const pair = await crypto.subtle.generateKey(ECDSA_KEY_PARAMS, false, [
    'sign',
    'verify',
  ]);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);

  // Field-by-field copy, never a spread: WebCrypto's export carries `ext` and
  // `key_ops`, and a spread over some other key object would happily carry `d`
  // straight into a published proof header.
  const { kty, crv, x, y } = exported;
  if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') {
    throw new Error('WebCrypto returned an unexpected shape for a P-256 public JWK');
  }
  const publicJwk: SpaceEcJwk = { kty, crv, x, y };

  return {
    privateKey: pair.privateKey,
    publicJwk,
    jkt: await jwkThumbprint(publicJwk),
  };
}

/**
 * Strip query and fragment (RFC 9449 §4.2), leaving origin + path.
 *
 * Mandatory, not cosmetic. Every space read carries its parameters in the
 * query string, and a proof whose `htu` retained them is rejected outright
 * with `DPoP proof "htu" does not match the request`. Trailing slashes are
 * significant and preserved: neither side normalizes them away.
 */
export function normalizeHtu(url: string): string {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

export async function createDpopProof(
  key: SpaceDpopKey,
  opts: {
    /** Uppercase HTTP method — compared case-sensitively. */
    htm: string;
    /** Full request URL. Query and fragment are stripped internally. */
    htu: string;
    /** The credential being presented. Omit when OBTAINING a credential. */
    credential?: string;
    /**
     * Server-supplied DPoP nonce. The space protocol has no nonce concept —
     * the alpha's verifier never issues one and never asks for one — so this
     * is only ever populated by a caller echoing a `DPoP-Nonce` header a host
     * actually sent. Never send an unsolicited nonce.
     */
    nonce?: string;
  },
): Promise<string> {
  const header = {
    alg: SIGNING_ALG,
    typ: DPOP_PROOF_TYP,
    // Re-listed rather than referenced so the header can only ever contain
    // these four members, whatever the caller's key object happens to hold.
    jwk: {
      kty: key.publicJwk.kty,
      crv: key.publicJwk.crv,
      x: key.publicJwk.x,
      y: key.publicJwk.y,
    },
  };

  // `jti` guards replay. The far side's cache is global to the host and keyed
  // on the bare string, so a proof is good for exactly one request.
  const jti = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const payload: Record<string, unknown> = {
    jti,
    htm: opts.htm,
    htu: normalizeHtu(opts.htu),
  };
  if (opts.nonce !== undefined) payload.nonce = opts.nonce;

  // `ath` presence is enforced in both directions: sending one while obtaining
  // a credential is a 401, and omitting one while presenting a credential is
  // also a 401. It hashes the compact JWT exactly as it appears in the
  // Authorization header after `DPoP `.
  if (opts.credential !== undefined) {
    payload.ath = await sha256Base64Url(opts.credential);
  }

  // Seconds, not milliseconds. The verifier allows 5s of skew against a 60s
  // max age, so a millisecond value reads as roughly fifty thousand years in
  // the future and fails every time.
  payload.iat = Math.floor(Date.now() / 1000);

  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;

  // WebCrypto's ECDSA output is raw IEEE P1363 `r || s` — 64 bytes for P-256 —
  // which is exactly the JWS ES256 signature format. No DER unwrapping. (Node's
  // `crypto.sign` emits DER and would need it; this is not that API.)
  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_PARAMS,
    key.privateKey,
    textEncoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Decode a compact JWT's payload WITHOUT verifying the signature. Only for
 * reading `exp` off a credential we were just handed over TLS by the host
 * that minted it. Never use this to make a trust decision.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const bytes = base64UrlDecode(parts[1]);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}
