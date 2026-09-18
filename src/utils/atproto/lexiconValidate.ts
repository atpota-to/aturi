/**
 * PURE. Check a draft record against the Lexicon document that governs it,
 * before it is sent anywhere.
 *
 * The PDS runs its own validation and is the only authority on whether a write
 * succeeds. This is not a second opinion on that — it is the same question
 * asked early enough to be useful, so a missing required field or a 340-grapheme
 * post is something you fix while typing rather than something a 400 tells you
 * about after you press the button.
 *
 * Two rules keep it from being worse than nothing:
 *
 *   - It never blocks. Writing a record a published schema would refuse is a
 *     legitimate thing to do while designing a lexicon — it is why the composer
 *     exposes `validate: false` at all — so everything here is reported and
 *     nothing here prevents.
 *   - It only claims what the schema actually says. Where the spec is loose
 *     (a CID's encoding, a language tag's registry) the finding is a warning,
 *     not an error, because a validator that cries wolf about valid records
 *     gets ignored on the one that matters.
 *
 * Depth matches the form's: top-level properties, plus the shape of the two
 * things that are structured but fixed — a blob reference and a bytes or
 * cid-link wrapper. A nested object's interior is the JSON editor's business.
 */

import { isValidNsid } from './spaceUri';
import { looksLikeTid } from './tid';

export type ProblemSeverity = 'error' | 'warning';

export type RecordProblem = {
  /** The top-level property this is about, or null for the record itself. */
  field: string | null;
  message: string;
  severity: ProblemSeverity;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length === value.length ? out : null;
}

/** The `main` definition, when the document describes a record. */
function recordSchemaOf(doc: unknown): {
  main: Record<string, unknown>;
  schema: Record<string, unknown>;
} | null {
  const root = asRecord(doc);
  const main = asRecord(asRecord(root?.defs)?.main);
  if (!main || main.type !== 'record') return null;
  const schema = asRecord(main.record);
  if (!schema) return null;
  return { main, schema };
}

/**
 * Length in UTF-8 bytes, which is what `maxLength` counts.
 *
 * Not `.length`: that is UTF-16 code units, and the two disagree on every
 * character outside ASCII — so a bio of accented text would pass a check the
 * PDS then fails.
 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * PURE. Length in graphemes, which is what `maxGraphemes` counts and what a
 * person means by "characters". Exported because the form's character counter
 * has to agree with the limit it sits next to.
 *
 * `Intl.Segmenter` is the only correct way to do this — a family emoji is one
 * grapheme, several code points and rather more code units. The fallback
 * counts code points, which is wrong for exactly those sequences but much
 * closer than code units, and only runs where Segmenter is missing.
 */
export function graphemeLength(value: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    // Counted through the iterator rather than spread into an array: the
    // answer is a number, and a 10KB string would otherwise allocate 10,000
    // segment objects to produce it.
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value);
    const iterator = segments[Symbol.iterator]();
    let count = 0;
    while (!iterator.next().done) count += 1;
    return count;
  }
  return [...value].length;
}

/**
 * The string formats the schema language defines, and how confidently each can
 * be checked from here.
 *
 * `error` for the ones with a syntax the spec fixes: a DID that does not start
 * `did:` is wrong under every method that will ever exist. `warning` for the
 * ones whose validity depends on something this code cannot see — whether a
 * CID's multibase decodes, whether a language subtag is registered — where the
 * most honest thing to say is that it looks off.
 */
const FORMAT_CHECKS: Record<
  string,
  { test: (value: string) => boolean; expected: string; severity: ProblemSeverity }
> = {
  // RFC 3339 with a mandatory `T` and a mandatory offset. Seconds are required
  // and fractional seconds optional, matching atproto's own datetime grammar —
  // which is narrower than what `new Date()` will happily parse.
  datetime: {
    test: (v) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
      !Number.isNaN(Date.parse(v)),
    expected: 'an RFC 3339 timestamp with a timezone, like 2026-09-18T20:41:55.450Z',
    severity: 'error',
  },
  did: {
    test: (v) => /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/.test(v),
    expected: 'a DID, like did:plc:… or did:web:…',
    severity: 'error',
  },
  handle: {
    test: (v) => /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v),
    expected: 'a handle, like alice.example.com',
    severity: 'error',
  },
  'at-identifier': {
    test: (v) =>
      /^did:[a-z]+:/.test(v) ||
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v),
    expected: 'a handle or a DID',
    severity: 'error',
  },
  'at-uri': {
    test: (v) => /^at:\/\/(did:[a-z]+:[^/]+|[^/]+)(\/[^/]+)*$/.test(v),
    expected: 'an AT URI, like at://did:plc:…/app.bsky.feed.post/3k…',
    severity: 'error',
  },
  nsid: {
    test: (v) => isValidNsid(v),
    expected: 'an NSID, like com.example.thing',
    severity: 'error',
  },
  tid: {
    test: (v) => looksLikeTid(v),
    expected: 'a 13-character TID',
    severity: 'error',
  },
  'record-key': {
    test: (v) => isValidRecordKey(v),
    expected: 'a record key: 1–512 characters from A–Z a–z 0–9 and .-_:~',
    severity: 'error',
  },
  uri: {
    test: (v) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v),
    expected: 'a URI with a scheme, like https://…',
    severity: 'error',
  },
  // Loose on purpose. The registry of subtags is not something to ship in a
  // bundle, so this only catches shapes that are plainly not a language tag.
  language: {
    test: (v) => /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(v),
    expected: 'a BCP-47 language tag, like en or pt-BR',
    severity: 'warning',
  },
  // A CID's validity is in its multibase and multihash, which would mean
  // decoding it. The shape check catches a URL or a filename pasted in.
  cid: {
    test: (v) => /^[a-zA-Z0-9]+$/.test(v) && v.length >= 8,
    expected: 'a CID',
    severity: 'warning',
  },
};

/** PURE. Whether a string is syntactically usable as a record key. */
export function isValidRecordKey(value: string): boolean {
  if (value.length < 1 || value.length > 512) return false;
  if (value === '.' || value === '..') return false;
  return /^[a-zA-Z0-9.\-_:~]+$/.test(value);
}

/** The JSON shape of `prop.type`, for the mismatch message. */
function describeExpectedType(type: unknown): string {
  switch (type) {
    case 'string':
      return 'a string';
    case 'integer':
      return 'a whole number';
    case 'boolean':
      return 'true or false';
    case 'array':
      return 'an array';
    case 'blob':
      return 'a blob reference';
    case 'bytes':
      return 'a bytes value';
    case 'cid-link':
      return 'a CID link';
    case 'object':
    case 'ref':
    case 'union':
      return 'an object';
    default:
      return 'a value';
  }
}

/** What a value actually is, in the same vocabulary. */
function describeActualType(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return 'a string';
    case 'number':
      return Number.isInteger(value) ? 'a whole number' : 'a decimal number';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'an object';
    default:
      return typeof value;
  }
}

function typeMatches(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
    case 'ref':
    case 'union':
    case 'blob':
    case 'bytes':
    case 'cid-link':
      return asRecord(value) !== null;
    // `unknown` is the schema declining to say, so nothing here can disagree.
    default:
      return true;
  }
}

/** Checks a string against the length and format constraints on its schema. */
function checkString(
  field: string,
  value: string,
  prop: Record<string, unknown>,
  out: RecordProblem[],
): void {
  const enumValues = asStringArray(prop.enum);
  if (enumValues && enumValues.length && !enumValues.includes(value)) {
    out.push({
      field,
      severity: 'error',
      message: `“${value}” isn’t one of the allowed values: ${enumValues.join(', ')}.`,
    });
  }

  const known = asStringArray(prop.knownValues);
  if (known && known.length && !known.includes(value)) {
    // `knownValues` is explicitly open-ended, so an unlisted value is a thing
    // worth noticing and not a thing that is wrong.
    out.push({
      field,
      severity: 'warning',
      message: `“${value}” isn’t one of this lexicon’s known values. That is allowed, but check it is intended.`,
    });
  }

  if (typeof prop.const === 'string' && prop.const !== value) {
    out.push({
      field,
      severity: 'error',
      message: `This field has to be “${prop.const}”.`,
    });
  }

  if (typeof prop.maxLength === 'number') {
    const bytes = byteLength(value);
    if (bytes > prop.maxLength) {
      out.push({
        field,
        severity: 'error',
        message: `${bytes} bytes, over the ${prop.maxLength}-byte limit.`,
      });
    }
  }
  if (typeof prop.minLength === 'number' && byteLength(value) < prop.minLength) {
    out.push({
      field,
      severity: 'error',
      message: `Needs at least ${prop.minLength} bytes.`,
    });
  }
  if (typeof prop.maxGraphemes === 'number') {
    const graphemes = graphemeLength(value);
    if (graphemes > prop.maxGraphemes) {
      out.push({
        field,
        severity: 'error',
        message: `${graphemes} characters, over the ${prop.maxGraphemes}-character limit.`,
      });
    }
  }
  if (typeof prop.minGraphemes === 'number' && graphemeLength(value) < prop.minGraphemes) {
    out.push({
      field,
      severity: 'error',
      message: `Needs at least ${prop.minGraphemes} characters.`,
    });
  }

  // An empty string is checked for length above; running a format test on it
  // would add a second complaint about the same emptiness.
  if (value === '') return;
  const format = typeof prop.format === 'string' ? FORMAT_CHECKS[prop.format] : undefined;
  if (format && !format.test(value)) {
    out.push({
      field,
      severity: format.severity,
      message: `Doesn’t look like ${format.expected}.`,
    });
  }
}

function checkInteger(
  field: string,
  value: number,
  prop: Record<string, unknown>,
  out: RecordProblem[],
): void {
  if (typeof prop.minimum === 'number' && value < prop.minimum) {
    out.push({ field, severity: 'error', message: `Has to be at least ${prop.minimum}.` });
  }
  if (typeof prop.maximum === 'number' && value > prop.maximum) {
    out.push({ field, severity: 'error', message: `Has to be at most ${prop.maximum}.` });
  }
  if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
    out.push({
      field,
      severity: 'error',
      message: `${value} isn’t one of the allowed values: ${prop.enum.join(', ')}.`,
    });
  }
}

function checkArray(
  field: string,
  value: unknown[],
  prop: Record<string, unknown>,
  out: RecordProblem[],
): void {
  if (typeof prop.maxLength === 'number' && value.length > prop.maxLength) {
    out.push({
      field,
      severity: 'error',
      message: `${value.length} items, over the limit of ${prop.maxLength}.`,
    });
  }
  if (typeof prop.minLength === 'number' && value.length < prop.minLength) {
    out.push({
      field,
      severity: 'error',
      message: `Needs at least ${prop.minLength} item${prop.minLength === 1 ? '' : 's'}.`,
    });
  }

  const items = asRecord(prop.items);
  if (!items) return;
  for (let i = 0; i < value.length; i++) {
    if (!typeMatches(items.type, value[i])) {
      out.push({
        field,
        severity: 'error',
        message: `Item ${i + 1} is ${describeActualType(value[i])}; the schema wants ${describeExpectedType(items.type)}.`,
      });
      continue;
    }
    if (items.type === 'string' && typeof value[i] === 'string') {
      // Reported against the array, since a form has one control for the whole
      // of it — but numbered, so which item is wrong is still findable.
      const itemProblems: RecordProblem[] = [];
      checkString(field, value[i] as string, items, itemProblems);
      for (const problem of itemProblems) {
        out.push({ ...problem, message: `Item ${i + 1}: ${problem.message}` });
      }
    }
  }
}

/**
 * A blob reference, which has a fixed shape the PDS will insist on, and which
 * a person hand-writing JSON gets wrong in predictable ways.
 */
function checkBlob(
  field: string,
  value: Record<string, unknown>,
  prop: Record<string, unknown>,
  out: RecordProblem[],
): void {
  const link = asRecord(value.ref)?.$link;
  if (value.$type !== 'blob' || typeof link !== 'string' || typeof value.mimeType !== 'string') {
    out.push({
      field,
      severity: 'error',
      message:
        'A blob needs $type "blob", a ref with a $link, a mimeType and a size. Upload one from the record pane to get it right.',
    });
    return;
  }

  const accept = asStringArray(prop.accept);
  if (accept && accept.length) {
    const mime = value.mimeType;
    const allowed = accept.some(
      (pattern) =>
        pattern === '*/*' ||
        pattern === mime ||
        (pattern.endsWith('/*') && mime.startsWith(pattern.slice(0, -1))),
    );
    if (!allowed) {
      out.push({
        field,
        severity: 'error',
        message: `This field accepts ${accept.join(', ')}, and that blob is ${mime}.`,
      });
    }
  }

  if (typeof prop.maxSize === 'number' && typeof value.size === 'number' && value.size > prop.maxSize) {
    out.push({
      field,
      severity: 'error',
      message: `${value.size} bytes, over this field's ${prop.maxSize}-byte limit.`,
    });
  }
}

/**
 * PURE. Everything the schema says is wrong with this draft, most severe kinds
 * first is the caller's business — these come back in property order, with
 * record-level findings first.
 *
 * An empty array means nothing here disagreed with the schema. It does not
 * mean the PDS will accept the record: a lexicon this code could not resolve,
 * a constraint inside a nested object, and the host's own rules are all
 * outside what this sees.
 */
export function checkRecord(nsid: string, doc: unknown, record: unknown): RecordProblem[] {
  const out: RecordProblem[] = [];

  const body = asRecord(record);
  if (!body) {
    return [{ field: null, severity: 'error', message: 'A record has to be a JSON object.' }];
  }

  if (typeof body.$type === 'string' && nsid && body.$type !== nsid) {
    out.push({
      field: null,
      severity: 'error',
      message: `$type is “${body.$type}” but this is being written to ${nsid}. They have to agree.`,
    });
  }

  const found = recordSchemaOf(doc);
  if (!found) return out;

  const { schema } = found;
  const properties = asRecord(schema.properties);
  if (!properties) return out;

  for (const key of asStringArray(schema.required) ?? []) {
    const value = body[key];
    if (value === undefined || value === null || value === '') {
      out.push({ field: key, severity: 'error', message: 'Required, and not set.' });
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === '$type') continue;
    const prop = asRecord(properties[key]);
    if (!prop) {
      out.push({
        field: key,
        severity: 'warning',
        message: 'Not a property this lexicon declares.',
      });
      continue;
    }
    // Absent optional fields are the normal case and say nothing; absent
    // required ones were already reported above.
    if (value === undefined || value === null) continue;

    if (!typeMatches(prop.type, value)) {
      out.push({
        field: key,
        severity: 'error',
        message: `This is ${describeActualType(value)}; the schema wants ${describeExpectedType(prop.type)}.`,
      });
      continue;
    }

    if (prop.type === 'string' && typeof value === 'string') checkString(key, value, prop, out);
    else if (prop.type === 'integer' && typeof value === 'number') checkInteger(key, value, prop, out);
    else if (prop.type === 'array' && Array.isArray(value)) checkArray(key, value, prop, out);
    else if (prop.type === 'blob') {
      const blob = asRecord(value);
      if (blob) checkBlob(key, blob, prop, out);
    }
  }

  return out;
}

/**
 * PURE. Whether the record key suits the lexicon's declared key type.
 *
 * An empty key means "let the host assign one", which is only an answer for a
 * `tid` lexicon — every other key type is the author's to supply, so an empty
 * one is reported rather than silently sent.
 */
export function checkRecordKey(doc: unknown, rkey: string): RecordProblem | null {
  const key = recordSchemaOf(doc)?.main.key;
  const trimmed = rkey.trim();

  if (typeof key === 'string' && key.startsWith('literal:')) {
    const literal = key.slice('literal:'.length);
    if (trimmed !== literal) {
      return {
        field: null,
        severity: 'error',
        message: `${String(key)} means this record's key has to be “${literal}”.`,
      };
    }
    return null;
  }

  if (trimmed === '') {
    if (key === 'tid' || key === undefined) return null;
    return {
      field: null,
      severity: 'warning',
      message: `This lexicon's key type is “${String(key)}”, so it expects a key you choose. Leaving it empty asks your PDS for a timestamp key instead.`,
    };
  }

  if (!isValidRecordKey(trimmed)) {
    return {
      field: null,
      severity: 'error',
      message: 'A record key is 1–512 characters from A–Z a–z 0–9 and .-_:~, and cannot be . or ..',
    };
  }

  if (key === 'nsid' && !isValidNsid(trimmed)) {
    return {
      field: null,
      severity: 'error',
      message: 'This lexicon keys its records by NSID, like com.example.thing.',
    };
  }

  if (key === 'tid' && !looksLikeTid(trimmed)) {
    // Not an error: a PDS accepts a non-TID key here, and a record written
    // with one is readable and valid. It just sorts somewhere unintended.
    return {
      field: null,
      severity: 'warning',
      message: 'This lexicon expects a TID key. A different key works, but records won’t sort by time.',
    };
  }

  return null;
}
