/**
 * `src/utils/atproto/spaceDpop.ts` is never imported by extension runtime code.
 * It is tested here because this is the repo's only Node-environment Vitest
 * suite that can reach `src/utils/**` (via the `@aturi` alias), and Node 22
 * supplies the same global `crypto.subtle` the browser does — so the whole
 * module runs end to end without a server.
 */

import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  createDpopProof,
  decodeJwtPayload,
  generateSpaceDpopKey,
  jwkThumbprint,
  normalizeHtu,
  type SpaceEcJwk,
} from '@aturi/atproto/spaceDpop';

/**
 * A real P-256 public point with a thumbprint computed independently by
 * Node's `crypto.createHash('sha256')` over the RFC 7638 canonical form
 * `{"crv":"P-256","kty":"EC","x":"…","y":"…"}`.
 */
const FIXTURE_JWK: SpaceEcJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'PcoomiLqq2gFzzJIBJrg4cGhAwo5CW87EUQEvywTQus',
  y: 'pdaLj1S1m1PBQH2Glr3n2eD3eF9NrlkSV5UcOlTgM5c',
};
const FIXTURE_JKT = 'HsBrhrgEIz69QoNfFhhb1onVpVVu0ZCEtYW6YR3bdbM';

const CREDENTIAL = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJzcGFjZSJ9.c2ln';

function decodePart(part: string): Record<string, unknown> {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Built by allocation rather than `Uint8Array.from` so the result is typed
// over a plain ArrayBuffer, which is what `crypto.subtle.verify` accepts.
function decodeBytes(part: string) {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Recomputed here from first principles so the test does not trust the module. */
async function sha256B64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(digest);
}

describe('jwkThumbprint', () => {
  it('matches an independently computed RFC 7638 thumbprint', async () => {
    await expect(jwkThumbprint(FIXTURE_JWK)).resolves.toBe(FIXTURE_JKT);
  });

  it('is 43 characters of unpadded base64url', async () => {
    const jkt = await jwkThumbprint(FIXTURE_JWK);
    expect(jkt).toHaveLength(43);
    expect(jkt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('ignores member order in the input object', async () => {
    const reordered = { y: FIXTURE_JWK.y, x: FIXTURE_JWK.x, crv: FIXTURE_JWK.crv, kty: FIXTURE_JWK.kty };
    await expect(jwkThumbprint(reordered as SpaceEcJwk)).resolves.toBe(FIXTURE_JKT);
  });
});

describe('generateSpaceDpopKey', () => {
  it('produces a non-extractable private key and a bare public JWK', async () => {
    const key = await generateSpaceDpopKey();

    expect(key.privateKey.extractable).toBe(false);
    expect(key.privateKey.usages).toContain('sign');
    await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow();

    expect(Object.keys(key.publicJwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(key.publicJwk.kty).toBe('EC');
    expect(key.publicJwk.crv).toBe('P-256');
    expect(key.jkt).toBe(await jwkThumbprint(key.publicJwk));
  });
});

describe('normalizeHtu', () => {
  it('strips query and fragment', () => {
    expect(normalizeHtu('https://h.example/xrpc/foo?a=1#x')).toBe('https://h.example/xrpc/foo');
  });

  it('drops a default port', () => {
    expect(normalizeHtu('https://h.example:443/xrpc/foo')).toBe('https://h.example/xrpc/foo');
  });

  it('keeps a non-default port', () => {
    expect(normalizeHtu('https://h.example:8443/xrpc/foo')).toBe('https://h.example:8443/xrpc/foo');
  });

  it('treats a trailing slash as significant', () => {
    expect(normalizeHtu('https://h.example/xrpc/foo/')).toBe('https://h.example/xrpc/foo/');
    expect(normalizeHtu('https://h.example/xrpc/foo/')).not.toBe(normalizeHtu('https://h.example/xrpc/foo'));
  });
});

describe('createDpopProof header', () => {
  it('carries exactly alg, typ and a bare jwk', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'POST', htu: 'https://h.example/xrpc/foo' });

    const header = decodePart(proof.split('.')[0]);
    expect(Object.keys(header).sort()).toEqual(['alg', 'jwk', 'typ']);
    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('dpop+jwt');
    expect(header).not.toHaveProperty('kid');

    const jwk = header.jwk as Record<string, unknown>;
    expect(Object.keys(jwk)).toEqual(['kty', 'crv', 'x', 'y']);
    expect(jwk).not.toHaveProperty('d');
    expect(jwk).not.toHaveProperty('ext');
    expect(jwk).not.toHaveProperty('key_ops');
  });
});

describe('createDpopProof payload', () => {
  it('stamps iat in seconds', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });

    const iat = decodePart(proof.split('.')[1]).iat as number;
    expect(typeof iat).toBe('number');
    expect(iat).toBeLessThan(1e11);
    expect(Math.abs(iat - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);
  });

  it('normalizes htu', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, {
      htm: 'GET',
      htu: 'https://h.example/xrpc/foo?a=1&space=at%3A%2F%2Fdid%3Aplc%3Ax#frag',
    });
    expect(decodePart(proof.split('.')[1]).htu).toBe('https://h.example/xrpc/foo');
  });

  it('passes htm through verbatim', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'POST', htu: 'https://h.example/xrpc/foo' });
    expect(decodePart(proof.split('.')[1]).htm).toBe('POST');
  });

  it('omits ath when obtaining a credential', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'POST', htu: 'https://h.example/xrpc/foo' });
    expect(decodePart(proof.split('.')[1])).not.toHaveProperty('ath');
  });

  it('hashes the credential into ath when presenting one', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, {
      htm: 'GET',
      htu: 'https://h.example/xrpc/foo',
      credential: CREDENTIAL,
    });

    const ath = decodePart(proof.split('.')[1]).ath;
    expect(ath).toBe(await sha256B64Url(CREDENTIAL));
    expect(ath).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('omits nonce unless one is supplied', async () => {
    const key = await generateSpaceDpopKey();
    const without = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });
    expect(decodePart(without.split('.')[1])).not.toHaveProperty('nonce');

    const withNonce = await createDpopProof(key, {
      htm: 'GET',
      htu: 'https://h.example/xrpc/foo',
      nonce: 'server-supplied',
    });
    expect(decodePart(withNonce.split('.')[1]).nonce).toBe('server-supplied');
  });

  it('never repeats a jti', async () => {
    const key = await generateSpaceDpopKey();
    const a = decodePart((await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/x' })).split('.')[1]);
    const b = decodePart((await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/x' })).split('.')[1]);
    expect(typeof a.jti).toBe('string');
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('createDpopProof signature', () => {
  it('is raw 64-byte P1363, which is what JWS ES256 wants', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });
    expect(decodeBytes(proof.split('.')[2])).toHaveLength(64);
  });

  it('verifies against the embedded public JWK', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });
    const [headerB64, payloadB64, sigB64] = proof.split('.');

    const embedded = (decodePart(headerB64).jwk as unknown) as SpaceEcJwk;
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { ...embedded, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      decodeBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    expect(ok).toBe(true);
  });

  it('does not verify against a different key', async () => {
    const key = await generateSpaceDpopKey();
    const other = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });
    const [headerB64, payloadB64, sigB64] = proof.split('.');

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { ...other.publicJwk, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      decodeBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    expect(ok).toBe(false);
  });
});

describe('base64UrlEncode', () => {
  it('is unpadded and url-safe', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
  });

  it('accepts an ArrayBuffer as well as a view', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(base64UrlEncode(bytes.buffer)).toBe(base64UrlEncode(bytes));
  });
});

describe('decodeJwtPayload', () => {
  it('reads a payload without verifying anything', async () => {
    const key = await generateSpaceDpopKey();
    const proof = await createDpopProof(key, { htm: 'GET', htu: 'https://h.example/xrpc/foo' });
    expect(decodeJwtPayload(proof)?.htu).toBe('https://h.example/xrpc/foo');
  });

  it('round-trips non-ASCII payload text', () => {
    const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: 'späce ☂' })));
    expect(decodeJwtPayload(`aGVhZGVy.${payload}.c2ln`)?.sub).toBe('späce ☂');
  });

  it('returns null for anything that is not a JWT with a JSON object payload', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(decodeJwtPayload(`a.${base64UrlEncode(new TextEncoder().encode('not json'))}.c`)).toBeNull();
    expect(decodeJwtPayload(`a.${base64UrlEncode(new TextEncoder().encode('[1,2]'))}.c`)).toBeNull();
    expect(decodeJwtPayload(`a.${base64UrlEncode(new TextEncoder().encode('null'))}.c`)).toBeNull();
  });
});
