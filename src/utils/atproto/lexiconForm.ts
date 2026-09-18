/**
 * PURE. Turn a fetched Lexicon document into the form spec the record editor
 * already knows how to render.
 *
 * `lexicons.ts` carries six hand-written templates for the lexicons people edit
 * most. This is the same shape, derived instead from whatever schema the NSID's
 * authority published — so the composer can offer a real form for a lexicon
 * nobody here has ever seen, and the ones it can't model degrade to the JSON
 * field rather than to nothing.
 *
 * The translation is deliberately shallow. Every scalar the schema language has
 * gets a native control; everything with structure (refs, unions, objects,
 * blobs, arrays of anything but strings) becomes a JSON sub-editor labelled
 * with what the schema said it wants. Going deeper would mean resolving `ref`
 * targets across documents and rendering recursive union pickers, which is a
 * different project — and the composer's JSON mode is already the complete
 * answer for those fields.
 *
 * Nothing here fetches. `lexiconDoc.ts` does that; this file is a function of
 * its result, which is what makes it testable.
 */

import type { Lexicon, LexiconField, LexiconFieldType } from './lexicons';

/** What `defs.main.type` must be for a document to describe a record. */
const RECORD_DEF_TYPE = 'record';

/**
 * A string longer than this gets a textarea instead of a single-line input.
 * Chosen to sit above a handle, a DID, a URI and a display name, and below a
 * post, a bio and a description.
 */
const TEXTAREA_MIN_MAX_LENGTH = 256;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length === value.length ? out : null;
}

/**
 * Follow a `ref` that points inside the document we already have.
 *
 * Only a local one — `#listPurpose`, or the long spelling with this lexicon's
 * own NSID in front of it. A ref into another lexicon would mean a second
 * fetch, and possibly a third, at the speed the user is typing; that is the
 * cross-document resolution this module deliberately doesn't do.
 *
 * Worth doing for local refs because the schema language encourages them for
 * exactly the values a form is good at: a named set of allowed strings,
 * declared once in `defs` and referenced from the record. Without this a
 * `purpose` field with four legal values renders as a JSON box.
 *
 * Returns null unless the target is a scalar. An object or array behind a ref
 * is still a structure, and structures keep their JSON.
 */
function resolveLocalRef(
  ref: unknown,
  nsid: string,
  defs: Record<string, unknown> | null,
  depth = 0,
): Record<string, unknown> | null {
  if (typeof ref !== 'string' || !defs) return null;
  // One hop of indirection is plenty: a ref chain longer than that is either
  // unusual or a cycle, and either way JSON is the honest answer.
  if (depth > 2) return null;

  const hash = ref.indexOf('#');
  if (hash < 0) return null;
  const doc = ref.slice(0, hash);
  if (doc !== '' && doc !== nsid) return null;

  const target = asRecord(defs[ref.slice(hash + 1)]);
  if (!target) return null;
  if (target.type === 'ref') return resolveLocalRef(target.ref, nsid, defs, depth + 1);
  if (SCALAR_TYPES.has(target.type as string)) return target;
  return null;
}

/** The lexicon types a native control exists for. */
const SCALAR_TYPES = new Set(['string', 'integer', 'boolean']);

/**
 * A human label for a property key. Lexicon properties are camelCase and have
 * no label of their own, so `displayName` becomes "Display name" — capitalized
 * once, with the word breaks the casing already implies.
 *
 * Runs of capitals are kept together (`profileURI` → "Profile URI") so an
 * acronym doesn't come apart into single letters.
 */
export function labelForProperty(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;

  // Sentence case, not title case: only the first word is capitalized, and a
  // word that is already all capitals is left as the acronym it is.
  const cased = words.map((word, i) => {
    if (word.toUpperCase() === word) return word;
    if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1);
    return word.charAt(0).toLowerCase() + word.slice(1);
  });
  return cased.join(' ');
}

/**
 * The record key type the schema asks for, as the composer's three modes.
 *
 * `literal:self` is the single-record case (a profile, a preferences blob) and
 * pins the key. `tid` asks for a timestamp key, which the host will mint. Every
 * other value in the spec — `any`, `nsid`, `record-key` — means the author
 * chooses, so the field is offered and left empty.
 */
function rkeyModeFor(key: unknown): Pick<Lexicon, 'rkeyMode' | 'rkeyDefault' | 'rkeyPlaceholder'> {
  if (typeof key === 'string' && key.startsWith('literal:')) {
    const literal = key.slice('literal:'.length);
    if (literal) {
      return { rkeyMode: 'fixed', rkeyDefault: literal, rkeyPlaceholder: literal };
    }
  }
  if (key === 'nsid') return { rkeyMode: 'fixed', rkeyPlaceholder: 'com.example.name' };
  if (key === 'any' || key === 'record-key') return { rkeyMode: 'fixed', rkeyPlaceholder: 'rkey' };
  return { rkeyMode: 'tid' };
}

/**
 * The description a structured field carries instead of a control: what the
 * schema says belongs there, phrased so it is useful above a JSON box.
 */
function structuralHint(prop: Record<string, unknown>): string {
  const type = prop.type;
  if (type === 'ref' && typeof prop.ref === 'string') return `Object matching ${prop.ref}`;
  if (type === 'union') {
    const refs = asStringArray(prop.refs);
    if (refs && refs.length) return `One of: ${refs.join(', ')}`;
    return 'Object with a $type from this lexicon';
  }
  if (type === 'blob') {
    const accept = asStringArray(prop.accept);
    const kinds = accept && accept.length ? ` (${accept.join(', ')})` : '';
    return `Blob reference${kinds}`;
  }
  if (type === 'bytes') return 'Bytes, as { "$bytes": "<base64>" }';
  if (type === 'cid-link') return 'CID link, as { "$link": "<cid>" }';
  if (type === 'array') {
    const items = asRecord(prop.items);
    const itemType = typeof items?.type === 'string' ? items.type : 'item';
    if (itemType === 'ref' && typeof items?.ref === 'string') return `Array of ${items.ref}`;
    return `Array of ${itemType}`;
  }
  if (type === 'object') return 'Nested object';
  if (type === 'unknown') return 'Any JSON value';
  return 'JSON value';
}

/**
 * The control one property gets.
 *
 * Only the scalars get a native control; the branch order matters for strings,
 * where `format` and `knownValues` both outrank length.
 */
function fieldTypeFor(
  prop: Record<string, unknown>,
  nsid: string,
  defs: Record<string, unknown> | null,
): {
  type: LexiconFieldType;
  options?: string[];
  openOptions?: boolean;
  /** The def a local ref led to, so the caller reads its bounds and text. */
  resolved?: Record<string, unknown>;
} {
  if (prop.type === 'ref') {
    const target = resolveLocalRef(prop.ref, nsid, defs);
    if (target) return { ...fieldTypeFor(target, nsid, defs), resolved: target };
  }
  switch (prop.type) {
    case 'boolean':
      return { type: 'boolean' };
    case 'integer':
      return { type: 'number' };
    case 'string': {
      if (prop.format === 'datetime') return { type: 'datetime' };
      // `enum` is closed and `knownValues` is explicitly open-ended, so the
      // latter keeps a way to type a value the schema didn't anticipate.
      const closed = asStringArray(prop.enum);
      if (closed && closed.length) return { type: 'select', options: closed };
      const known = asStringArray(prop.knownValues);
      if (known && known.length) return { type: 'select', options: known, openOptions: true };
      // Every other format in the spec — did, handle, at-uri, uri, nsid, cid,
      // language, tid, record-key — names a single-line identifier. A DID in a
      // four-row textarea is nobody's idea of the right box.
      if (typeof prop.format === 'string' && prop.format) return { type: 'text' };
      // Left with an unconstrained string, which is prose: the schemas that
      // bound a string are the ones holding something shorter.
      const max = maxLengthFor(prop);
      if (max === null) return { type: 'textarea' };
      return { type: max >= TEXTAREA_MIN_MAX_LENGTH ? 'textarea' : 'text' };
    }
    case 'array': {
      // An array of plain strings is the one array shape with a real control:
      // the comma-separated tags input. Anything else keeps its JSON.
      const declared = asRecord(prop.items);
      const items =
        declared?.type === 'ref'
          ? (resolveLocalRef(declared.ref, nsid, defs) ?? declared)
          : declared;
      if (items?.type === 'string' && !items.format && !items.enum && !items.knownValues) {
        return { type: 'tags' };
      }
      return { type: 'json' };
    }
    default:
      return { type: 'json' };
  }
}

/**
 * The character ceiling to show and enforce.
 *
 * `maxGraphemes` is the one users experience — it is what a post's "300
 * characters" means — so it wins where both are present, even though
 * `maxLength` (bytes) is the one the PDS checks. Counting graphemes properly
 * is the editor's problem, not this function's; what's returned here is the
 * number to put in front of the user.
 */
function maxLengthFor(prop: Record<string, unknown>): number | null {
  if (typeof prop.maxGraphemes === 'number') return prop.maxGraphemes;
  if (typeof prop.maxLength === 'number') return prop.maxLength;
  return null;
}

/** The starting value for a field, from the schema's own `default` or `const`. */
function defaultFor(prop: Record<string, unknown>): LexiconField['default'] | undefined {
  const raw = prop.const !== undefined ? prop.const : prop.default;
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const strings = asStringArray(raw);
  return strings ?? undefined;
}

/**
 * PURE. Build one field from one property of a record's object schema.
 *
 * Exported for the tests; the composer only ever calls
 * {@link formFromLexiconDocument}.
 */
export function fieldFromProperty(
  key: string,
  raw: unknown,
  required: boolean,
  nsid = '',
  defs: Record<string, unknown> | null = null,
): LexiconField | null {
  const prop = asRecord(raw);
  if (!prop) return null;

  const { type, options, openOptions, resolved } = fieldTypeFor(prop, nsid, defs);
  const field: LexiconField = {
    key,
    label: labelForProperty(key),
    type,
  };
  if (required) field.required = true;
  if (options) {
    field.options = options;
    if (openOptions) field.openOptions = true;
  }

  // Bounds come from whichever declaration actually describes the value: the
  // property, or the def its ref led to.
  const max = maxLengthFor(prop) ?? (resolved ? maxLengthFor(resolved) : null);
  if (max !== null && (type === 'text' || type === 'textarea')) field.maxLength = max;

  // A ref's own description is usually the better one — the property says why
  // it is there, the def says what it accepts — so both are kept, property
  // first, and a repeat is dropped rather than printed twice.
  const ownDescription = typeof prop.description === 'string' ? prop.description.trim() : '';
  const refDescription =
    resolved && typeof resolved.description === 'string' ? resolved.description.trim() : '';
  const description = [ownDescription, refDescription === ownDescription ? '' : refDescription]
    .filter(Boolean)
    .join(' ');
  const hint = type === 'json' ? structuralHint(prop) : '';
  // The author's own description leads when there is one; the derived hint
  // follows it, because for a JSON field the shape is the thing you can't see.
  const parts = [description, hint].filter(Boolean);
  if (parts.length) field.hint = parts.join(' · ');

  const declaredDefault = defaultFor(prop);
  if (declaredDefault !== undefined) {
    field.default = declaredDefault;
  } else if (type === 'datetime' && required) {
    // A required datetime with no default is, in practice, always "now" —
    // `createdAt` and its spellings. Seeding it saves the first click on
    // every form and is trivially cleared.
    field.default = 'now';
  }

  return field;
}

export type LexiconFormResult =
  | { ok: true; lexicon: Lexicon }
  /**
   * The document resolved but describes something the composer can't build a
   * form for. `reason` is shown next to the JSON editor, because "no form" with
   * no explanation reads as a failure to load.
   */
  | { ok: false; reason: string };

/**
 * PURE. Build a form spec from a Lexicon document, or say why not.
 *
 * `nsid` is used for the `$type` the form writes and for the label, rather than
 * the document's own `id` — they should agree, and where they don't it is the
 * NSID the record is being written under that governs.
 */
export function formFromLexiconDocument(nsid: string, doc: unknown): LexiconFormResult {
  const root = asRecord(doc);
  if (!root) return { ok: false, reason: 'That schema record holds no document.' };

  const main = asRecord(asRecord(root.defs)?.main);
  if (!main) {
    return { ok: false, reason: `${nsid} publishes a lexicon with no main definition.` };
  }
  if (main.type !== RECORD_DEF_TYPE) {
    const what = typeof main.type === 'string' ? main.type : 'something else';
    return {
      ok: false,
      reason: `${nsid} is a ${what} lexicon, not a record type. You can still write any JSON under it.`,
    };
  }

  const schema = asRecord(main.record);
  const properties = asRecord(schema?.properties);
  if (!properties) {
    return { ok: false, reason: `${nsid} declares a record with no properties.` };
  }

  const required = new Set(asStringArray(schema?.required) ?? []);
  const defs = asRecord(root.defs);
  const fields: LexiconField[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    // `$type` is the collection, not something the author fills in.
    if (key === '$type') continue;
    const field = fieldFromProperty(key, raw, required.has(key), nsid, defs);
    if (field) fields.push(field);
  }

  if (fields.length === 0) {
    return { ok: false, reason: `${nsid} declares a record with no editable properties.` };
  }

  // Required fields first. A long schema otherwise buries the two fields that
  // decide whether the write succeeds among twenty optional ones, and the
  // document's own property order carries no intent the user shares.
  fields.sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));

  const description = typeof main.description === 'string' ? main.description.trim() : '';

  return {
    ok: true,
    lexicon: {
      label: nsid,
      ...(description ? { summary: description } : {}),
      ...rkeyModeFor(main.key),
      typeFieldValue: nsid,
      fields,
    },
  };
}
