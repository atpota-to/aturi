/**
 * Read a JSON response with a hard byte ceiling.
 *
 * `res.json()` buffers whatever the far end sends. That is fine against a
 * fixed, trusted host, but the PDS clients talk to whatever address a DID
 * document names or an API caller supplies, and a hostile one can answer a
 * perfectly legal request with gigabytes. The result ceiling in the MCP layer
 * does not help: by the time it measures the payload, the memory is already
 * committed.
 *
 * Streaming and counting stops that at a bound, and a body over the cap is an
 * error rather than a truncated parse, since half a JSON document is not
 * something a caller can use.
 */

/** Generous next to any real XRPC response; a page of 100 records is under 1MB. */
export const MAX_UPSTREAM_JSON_BYTES = 2 * 1024 * 1024;

export async function readCappedJson<T>(
  res: Response,
  maxBytes: number = MAX_UPSTREAM_JSON_BYTES,
): Promise<T> {
  // Trust the declared length when there is one, so an oversized body is
  // refused before a single chunk is read.
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Upstream response too large: ${declared} bytes exceeds the ${maxBytes} cap`);
  }

  if (!res.body) {
    // No readable stream in this runtime; fall back, still bounded by the
    // declared-length check above where the header was present.
    return (await res.json()) as T;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error(`Upstream response too large: exceeds the ${maxBytes} byte cap`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }
  return JSON.parse(text) as T;
}
