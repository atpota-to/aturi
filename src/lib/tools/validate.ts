/**
 * Checks a record against its lexicon: every required field present, every
 * value of the type and within the limits the schema gives.
 *
 * The schema is whatever the lexicon's author published, read as data, so
 * nothing here trusts its shape. A definition this does not understand is
 * reported as not checked rather than passed or failed.
 *
 * It follows the lexicon and data model specs with one deliberate limit: a
 * `ref` or `union` that names another lexicon can only be checked when that
 * lexicon was found too. The caller fetches them (`referencedLexicons` says
 * which) and hands them in; a reference that could not be found is listed
 * as unchecked, since "we could not look" must not read as "it is fine".
 *
 * Pure, and free of network and DOM, so the same code runs in the tool, in
 * the explorer's record view and under `node --test`.
 */

import { parseLexiconRef } from '@/lib/lexiconSchema';
import { handleSyntaxProblem } from './handle';

export type ValidationSeverity =
  /** The record breaks the schema. */
  | 'error'
  /** Allowed, but probably not meant: an unknown value where the schema lists known ones. */
  | 'warning';

export type ValidationIssue = {
  /** Where in the record, as a path: `facets[0].index.byteStart`. Empty for the record itself. */
  path: string;
  severity: ValidationSeverity;
  message: string;
};

export type ValidationResult = {
  issues: ValidationIssue[];
  /** Lexicons the schema refers to that were not available, so parts went unchecked. */
  unresolved: string[];
  /** How many values were checked against a definition, as a rough measure of coverage. */
  checked: number;
};

/** A lexicon document, as loosely as it has to be held. */
export type LexiconDocLike = { id?: unknown; defs?: unknown };

type Json = Record<string, unknown>;

/** Stop walking past this depth: a schema that refers to itself must not loop on a hostile record. */
const MAX_DEPTH = 32;
/** Stop reporting past this many issues: a wrong `$type` can produce one per field. */
const MAX_ISSUES = 200;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'an integer' : 'a decimal number';
  return `a ${typeof value}`;
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/* -------------------------------------------------------------------------- *
 * String measures and formats
 * -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/** User-perceived characters, which is what `maxGraphemes` counts. */
export function graphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length;
}

const DID_REGEXP = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const NSID_REGEXP = /^[a-zA-Z]([a-zA-Z0-9-]{0,62})?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})?)+\.[a-zA-Z][a-zA-Z0-9]{0,62}$/;
const TID_REGEXP = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
const RECORD_KEY_REGEXP = /^[a-zA-Z0-9_~.:-]{1,512}$/;
const CID_REGEXP = /^(b[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|z[1-9A-HJ-NP-Za-km-z]{20,})$/;
const LANGUAGE_REGEXP = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$|^i-[a-zA-Z0-9-]+$/;
const URI_REGEXP = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/;
const DATETIME_REGEXP = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-6]\d(\.\d{1,20})?(Z|[+-][0-2]\d:[0-5]\d)$/;

function isDid(value: string): boolean {
  return value.length <= 2048 && DID_REGEXP.test(value);
}

function isHandle(value: string): boolean {
  return handleSyntaxProblem(value.toLowerCase()) === null;
}

function isAtUri(value: string): boolean {
  if (value.length > 8192) return false;
  const match = value.match(/^at:\/\/([^/?#\s]+)(?:\/([^/?#\s]+)(?:\/([^/?#\s]+))?)?(?:#\S*)?$/);
  if (!match) return false;
  const [, authority, collection, rkey] = match;
  if (!isDid(authority) && !isHandle(authority)) return false;
  if (collection !== undefined && !NSID_REGEXP.test(collection)) return false;
  return rkey === undefined || RECORD_KEY_REGEXP.test(rkey);
}

function isDatetime(value: string): boolean {
  if (!DATETIME_REGEXP.test(value)) return false;
  // "-00:00" is the one offset the spec rules out by name.
  if (value.endsWith('-00:00')) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Why `value` is not a valid string of `format`, or null when it is (or the format is unknown). */
export function formatProblem(format: string, value: string): string | null {
  switch (format) {
    case 'at-identifier':
      return isDid(value) || isHandle(value) ? null : 'must be a DID or a handle';
    case 'at-uri':
      return isAtUri(value) ? null : 'must be an at:// URI';
    case 'cid':
      return CID_REGEXP.test(value) ? null : 'must be a CID';
    case 'datetime':
      return isDatetime(value)
        ? null
        : 'must be a datetime with seconds and a time zone, such as 2026-01-31T12:00:00.000Z';
    case 'did':
      return isDid(value) ? null : 'must be a DID';
    case 'handle':
      return isHandle(value) ? null : 'must be a handle';
    case 'nsid':
      return value.length <= 317 && NSID_REGEXP.test(value) ? null : 'must be an NSID';
    case 'tid':
      return TID_REGEXP.test(value) ? null : 'must be a TID';
    case 'record-key':
      return RECORD_KEY_REGEXP.test(value) && value !== '.' && value !== '..' ? null : 'must be a valid record key';
    case 'uri':
      return value.length <= 8192 && URI_REGEXP.test(value) ? null : 'must be a URI';
    case 'language':
      return LANGUAGE_REGEXP.test(value) ? null : 'must be a language tag, such as en or pt-BR';
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- *
 * Finding definitions
 * -------------------------------------------------------------------------- */

function defsOf(doc: LexiconDocLike | undefined): Json | null {
  return doc && isObject(doc.defs) ? doc.defs : null;
}

/** Every other lexicon a document refers to, each once. */
export function referencedLexicons(doc: LexiconDocLike, id: string): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isObject(node)) return;
    const refs = node.type === 'ref' && typeof node.ref === 'string' ? [node.ref] : node.type === 'union' ? asStrings(node.refs) : [];
    for (const raw of refs) {
      const ref = parseLexiconRef(raw, id);
      if (!ref.local && ref.nsid !== id) found.add(ref.nsid);
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(doc.defs, 0);
  return [...found];
}

/* -------------------------------------------------------------------------- *
 * The walk
 * -------------------------------------------------------------------------- */

type Context = {
  /** Lexicons by NSID. `null` marks one that was looked for and not found. */
  docs: Map<string, LexiconDocLike | null>;
  issues: ValidationIssue[];
  unresolved: Set<string>;
  checked: number;
};

function report(ctx: Context, path: string, message: string, severity: ValidationSeverity = 'error') {
  if (ctx.issues.length >= MAX_ISSUES) return;
  ctx.issues.push({ path, severity, message });
}

/** The definition a ref names, or null with the reason recorded. */
function resolveRef(ctx: Context, raw: string, docId: string): { def: Json; docId: string } | null {
  const ref = parseLexiconRef(raw, docId);
  const doc = ctx.docs.get(ref.nsid);
  if (doc === undefined || doc === null) {
    ctx.unresolved.add(ref.nsid);
    return null;
  }
  const def = defsOf(doc)?.[ref.def];
  if (!isObject(def)) {
    ctx.unresolved.add(`${ref.nsid}#${ref.def}`);
    return null;
  }
  return { def, docId: ref.nsid };
}

/** `$type` as a union ref would spell it: `com.example.thing` or `com.example.thing#part`. */
function normalizeType(type: string): string {
  return type.endsWith('#main') ? type.slice(0, -'#main'.length) : type;
}

function checkString(ctx: Context, def: Json, value: unknown, path: string) {
  if (typeof value !== 'string') {
    report(ctx, path, `must be a string, but is ${describe(value)}`);
    return;
  }
  if (typeof def.const === 'string' && value !== def.const) {
    report(ctx, path, `must be exactly "${def.const}"`);
  }
  const allowed = asStrings(def.enum);
  if (allowed.length && !allowed.includes(value)) {
    report(ctx, path, `must be one of ${allowed.map((v) => `"${v}"`).join(', ')}`);
  }
  const known = asStrings(def.knownValues);
  if (known.length && !known.includes(value)) {
    report(ctx, path, `"${value}" is not one of the values the schema lists, though others are allowed`, 'warning');
  }
  if (typeof def.format === 'string') {
    const problem = formatProblem(def.format, value);
    if (problem) report(ctx, path, `${problem} (format ${def.format})`);
  }
  if (typeof def.maxLength === 'number' || typeof def.minLength === 'number') {
    const bytes = utf8Length(value);
    if (typeof def.maxLength === 'number' && bytes > def.maxLength) {
      report(ctx, path, `is ${bytes} bytes long, over the limit of ${def.maxLength}`);
    }
    if (typeof def.minLength === 'number' && bytes < def.minLength) {
      report(ctx, path, `is ${bytes} bytes long, under the minimum of ${def.minLength}`);
    }
  }
  if (typeof def.maxGraphemes === 'number' || typeof def.minGraphemes === 'number') {
    const graphemes = graphemeLength(value);
    if (typeof def.maxGraphemes === 'number' && graphemes > def.maxGraphemes) {
      report(ctx, path, `is ${graphemes} characters long, over the limit of ${def.maxGraphemes}`);
    }
    if (typeof def.minGraphemes === 'number' && graphemes < def.minGraphemes) {
      report(ctx, path, `is ${graphemes} characters long, under the minimum of ${def.minGraphemes}`);
    }
  }
}

function checkInteger(ctx: Context, def: Json, value: unknown, path: string) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    report(ctx, path, `must be an integer, but is ${describe(value)}`);
    return;
  }
  if (typeof def.const === 'number' && value !== def.const) report(ctx, path, `must be exactly ${def.const}`);
  const allowed = Array.isArray(def.enum) ? def.enum.filter((v): v is number => typeof v === 'number') : [];
  if (allowed.length && !allowed.includes(value)) report(ctx, path, `must be one of ${allowed.join(', ')}`);
  if (typeof def.minimum === 'number' && value < def.minimum) report(ctx, path, `is ${value}, under the minimum of ${def.minimum}`);
  if (typeof def.maximum === 'number' && value > def.maximum) report(ctx, path, `is ${value}, over the maximum of ${def.maximum}`);
}

function checkBlob(ctx: Context, def: Json, value: unknown, path: string) {
  if (!isObject(value)) {
    report(ctx, path, `must be a blob, but is ${describe(value)}`);
    return;
  }
  // The form before blobs carried a $type: just a CID and a MIME type.
  const legacy = typeof value.cid === 'string' && typeof value.mimeType === 'string' && value.$type === undefined;
  if (legacy) {
    report(ctx, path, 'uses the older blob form (cid and mimeType with no $type); it is still accepted', 'warning');
  } else {
    if (value.$type !== 'blob') report(ctx, path, 'must be a blob: an object with $type "blob"');
    if (!isObject(value.ref) || typeof value.ref.$link !== 'string') report(ctx, join(path, 'ref'), 'must be a CID link, { "$link": "…" }');
    if (typeof value.mimeType !== 'string') report(ctx, join(path, 'mimeType'), 'must be a string');
    if (typeof value.size !== 'number' || !Number.isInteger(value.size)) report(ctx, join(path, 'size'), 'must be an integer');
  }
  const mime = typeof value.mimeType === 'string' ? value.mimeType : null;
  const accept = asStrings(def.accept);
  if (mime && accept.length) {
    const ok = accept.some((pattern) =>
      pattern === '*/*' || pattern === mime || (pattern.endsWith('/*') && mime.startsWith(pattern.slice(0, -1))),
    );
    if (!ok) report(ctx, join(path, 'mimeType'), `is ${mime}, but the schema accepts ${accept.join(', ')}`);
  }
  if (typeof def.maxSize === 'number' && typeof value.size === 'number' && value.size > def.maxSize) {
    report(ctx, join(path, 'size'), `is ${value.size} bytes, over the limit of ${def.maxSize}`);
  }
}

function checkObject(ctx: Context, def: Json, value: unknown, path: string, docId: string, depth: number) {
  if (!isObject(value)) {
    report(ctx, path, `must be an object, but is ${describe(value)}`);
    return;
  }
  const properties = isObject(def.properties) ? def.properties : {};
  const nullable = new Set(asStrings(def.nullable));
  for (const name of asStrings(def.required)) {
    if (value[name] === undefined) report(ctx, join(path, name), 'is required, but missing');
  }
  for (const [name, schema] of Object.entries(properties)) {
    const field = value[name];
    if (field === undefined) continue;
    if (field === null) {
      if (!nullable.has(name)) report(ctx, join(path, name), 'is null, but the schema does not allow null here');
      continue;
    }
    checkValue(ctx, schema, field, join(path, name), docId, depth + 1);
  }
}

/** Check one value against one definition. */
function checkValue(ctx: Context, def: unknown, value: unknown, path: string, docId: string, depth: number) {
  if (depth > MAX_DEPTH || ctx.issues.length >= MAX_ISSUES || !isObject(def)) return;
  ctx.checked++;

  switch (def.type) {
    case 'null':
      if (value !== null) report(ctx, path, `must be null, but is ${describe(value)}`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') report(ctx, path, `must be true or false, but is ${describe(value)}`);
      else if (typeof def.const === 'boolean' && value !== def.const) report(ctx, path, `must be ${def.const}`);
      return;
    case 'integer':
      checkInteger(ctx, def, value, path);
      return;
    case 'string':
      checkString(ctx, def, value, path);
      return;
    case 'bytes': {
      if (!isObject(value) || typeof value.$bytes !== 'string') {
        report(ctx, path, 'must be bytes, { "$bytes": "<base64>" }');
        return;
      }
      const length = Math.floor((value.$bytes.replace(/=+$/, '').length * 3) / 4);
      if (typeof def.maxLength === 'number' && length > def.maxLength) report(ctx, path, `is ${length} bytes, over the limit of ${def.maxLength}`);
      if (typeof def.minLength === 'number' && length < def.minLength) report(ctx, path, `is ${length} bytes, under the minimum of ${def.minLength}`);
      return;
    }
    case 'cid-link':
      if (!isObject(value) || typeof value.$link !== 'string') report(ctx, path, 'must be a CID link, { "$link": "…" }');
      else if (!CID_REGEXP.test(value.$link)) report(ctx, join(path, '$link'), 'must be a CID');
      return;
    case 'blob':
      checkBlob(ctx, def, value, path);
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        report(ctx, path, `must be an array, but is ${describe(value)}`);
        return;
      }
      if (typeof def.maxLength === 'number' && value.length > def.maxLength) report(ctx, path, `has ${value.length} items, over the limit of ${def.maxLength}`);
      if (typeof def.minLength === 'number' && value.length < def.minLength) report(ctx, path, `has ${value.length} items, under the minimum of ${def.minLength}`);
      value.forEach((item, index) => checkValue(ctx, def.items, item, join(path, index), docId, depth + 1));
      return;
    }
    case 'object':
    case 'params':
      checkObject(ctx, def, value, path, docId, depth);
      return;
    case 'record':
      checkObject(ctx, isObject(def.record) ? def.record : {}, value, path, docId, depth);
      return;
    case 'token':
      // A token is a name to point at, never a value to hold.
      return;
    case 'unknown':
      if (!isObject(value)) report(ctx, path, `must be an object, but is ${describe(value)}`);
      return;
    case 'ref': {
      if (typeof def.ref !== 'string') return;
      const target = resolveRef(ctx, def.ref, docId);
      if (target) checkValue(ctx, target.def, value, path, target.docId, depth + 1);
      return;
    }
    case 'union': {
      if (!isObject(value)) {
        report(ctx, path, `must be an object with a $type, but is ${describe(value)}`);
        return;
      }
      if (typeof value.$type !== 'string') {
        report(ctx, join(path, '$type'), 'is required here, to say which of the allowed types this is');
        return;
      }
      const type = normalizeType(value.$type);
      const match = asStrings(def.refs).find((raw) => {
        const ref = parseLexiconRef(raw, docId);
        return (ref.def === 'main' ? ref.nsid : `${ref.nsid}#${ref.def}`) === type;
      });
      if (match) {
        const target = resolveRef(ctx, match, docId);
        if (target) checkValue(ctx, target.def, value, path, target.docId, depth + 1);
      } else if (def.closed === true) {
        report(ctx, join(path, '$type'), `is "${value.$type}", which is not one of the types this field allows`);
      }
      // An open union accepts types the schema has never heard of.
      return;
    }
    default:
      return;
  }
}

/** Numbers that are not integers have no place in the atproto data model. */
function findFloats(ctx: Context, value: unknown, path: string, depth: number) {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'number' && !Number.isInteger(value)) {
    report(ctx, path, `is ${value}; records can hold integers but not decimal numbers`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findFloats(ctx, item, join(path, index), depth + 1));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) findFloats(ctx, item, join(path, key), depth + 1);
  }
}

/** Whether a record key fits the key type its lexicon declares. */
export function recordKeyProblem(keyType: unknown, rkey: string): string | null {
  if (typeof keyType !== 'string') return null;
  if (keyType === 'tid') return TID_REGEXP.test(rkey) ? null : `The schema asks for a TID record key; "${rkey}" is not one.`;
  if (keyType === 'nsid') return NSID_REGEXP.test(rkey) ? null : `The schema asks for an NSID record key; "${rkey}" is not one.`;
  if (keyType.startsWith('literal:')) {
    const literal = keyType.slice('literal:'.length);
    return rkey === literal ? null : `The schema fixes the record key to "${literal}"; this record's is "${rkey}".`;
  }
  return null;
}

/**
 * Validate `record` as an instance of the lexicon `nsid`.
 *
 * `docs` holds that lexicon and as many of the ones it refers to as could be
 * found; map an NSID to `null` to say it was looked for and is not published.
 */
export function validateRecord(
  record: unknown,
  nsid: string,
  docs: Map<string, LexiconDocLike | null>,
  options: { rkey?: string } = {},
): ValidationResult {
  const ctx: Context = { docs, issues: [], unresolved: new Set(), checked: 0 };
  const main = defsOf(docs.get(nsid) ?? undefined)?.main;

  if (!isObject(record)) {
    report(ctx, '', `A record must be an object, but this is ${describe(record)}.`);
    return { issues: ctx.issues, unresolved: [], checked: 0 };
  }
  if (record.$type === undefined) {
    report(ctx, '$type', 'is required on a record, and names its lexicon');
  } else if (record.$type !== nsid) {
    report(ctx, '$type', `is "${String(record.$type)}", but the record is being checked as ${nsid}`);
  }

  if (!isObject(main)) {
    ctx.unresolved.add(nsid);
  } else if (main.type !== 'record') {
    report(ctx, '', `${nsid} defines a ${String(main.type)}, not a record type.`);
  } else {
    checkValue(ctx, main, record, '', nsid, 0);
    if (options.rkey) {
      const problem = recordKeyProblem(main.key, options.rkey);
      if (problem) report(ctx, '', problem);
    }
  }
  findFloats(ctx, record, '', 0);

  return { issues: ctx.issues, unresolved: [...ctx.unresolved], checked: ctx.checked };
}
