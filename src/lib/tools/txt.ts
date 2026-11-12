/**
 * Reading TXT records from a DNS-over-HTTPS answer, for the two tools that
 * follow one: the handle debugger (`_atproto.<handle>`) and the lexicon
 * publishing checker (`_lexicon.<authority>`).
 *
 * Both ask the resolver the rest of the site already uses (DOH_RESOLVER in
 * config.ts) and both show the raw records as evidence, so the answer is
 * read here once and kept as found.
 */

export type TxtProbe = {
  /** The name that was asked. */
  name: string;
  /** `found`: TXT records exist. `none`: the name has none. `error`: the lookup failed. */
  status: 'found' | 'none' | 'error';
  /** Every TXT value at the name, unquoted. */
  records: string[];
  error?: string;
};

/** TXT data arrives quoted, and a long record as several quoted strings; join them. */
export function unquoteTxt(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts) return data;
  return parts.map((part) => part.slice(1, -1).replace(/\\(.)/g, '$1')).join('');
}

/** Read a DNS-over-HTTPS JSON answer (dns.google's form) for a TXT question. */
export function readTxtAnswer(name: string, body: unknown): TxtProbe {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as {
    Status?: unknown;
    Answer?: { type?: unknown; data?: unknown }[];
  };
  // 0 is NOERROR and 3 is NXDOMAIN: both are answers. Anything else
  // (SERVFAIL, REFUSED) says the zone itself is misbehaving.
  if (answer.Status !== 0 && answer.Status !== 3) {
    return {
      name,
      status: 'error',
      records: [],
      error: `the name's DNS returned an error (code ${String(answer.Status ?? 'unknown')})`,
    };
  }
  const records = (Array.isArray(answer.Answer) ? answer.Answer : [])
    .filter((entry) => entry.type === 16 && typeof entry.data === 'string')
    .map((entry) => unquoteTxt(entry.data as string));
  return { name, status: records.length ? 'found' : 'none', records };
}
