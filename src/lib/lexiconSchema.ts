/**
 * A published lexicon document (the value of a com.atproto.lexicon.schema
 * record), summarised for reading: what the main definition is, the fields
 * of each part of it with their types and constraints in words, the other
 * definitions in the document, and every other lexicon it refers to.
 *
 * Documents are written by anyone, so nothing here trusts their shape. A
 * definition this does not recognise is still listed, by name and type,
 * and the raw JSON is always a tab away in the viewer.
 */

/** Where a `ref` points: a definition in this document or in another one. */
export type LexiconRef = {
  /** As the document spells it, or as it reads best: `#replyRef`, `app.bsky.richtext.facet`. */
  label: string;
  nsid: string;
  /** `main` when the ref names a whole lexicon. */
  def: string;
  /** In the document being read, so it is a jump down the page, not away. */
  local: boolean;
};

export type LexiconType =
  | { kind: 'primitive'; name: string }
  | { kind: 'ref'; ref: LexiconRef }
  | { kind: 'union'; refs: LexiconRef[]; closed: boolean }
  | { kind: 'array'; items: LexiconType }
  | { kind: 'object'; fields: LexiconField[] };

export type LexiconField = {
  name: string;
  type: LexiconType;
  required: boolean;
  nullable: boolean;
  description: string | null;
  /** Limits and hints in words: `≤ 300 graphemes`, `datetime`, `default 50`. */
  constraints: string[];
  deprecated: boolean;
};

/** One part of a definition: a record's fields, a query's parameters, its output. */
export type LexiconSection = {
  title: string;
  /** A body's content type, for the input and output of a query or procedure. */
  encoding: string | null;
  description: string | null;
  fields: LexiconField[];
  /** A body that is not an object of fields: a ref or a union. */
  body: LexiconType | null;
};

export type LexiconDef = {
  name: string;
  type: string;
  description: string | null;
  /** A record's key type: `tid`, `literal:self`, `any`. */
  key: string | null;
  sections: LexiconSection[];
  /** Errors a query, procedure or subscription names. */
  errors: { name: string; description: string | null }[];
  /** What a definition that isn't fields is: a string's constraints, a token. */
  shape: LexiconType | null;
  constraints: string[];
};

export type LexiconDocSummary = {
  id: string;
  description: string | null;
  main: LexiconDef | null;
  /** Every other definition, in the document's order. */
  defs: LexiconDef[];
  /** Other lexicons this one refers to, each once, in order of first mention. */
  references: string[];
};

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads `#def`, `nsid` and `nsid#def` against the document they appear in. */
export function parseLexiconRef(raw: string, docId: string): LexiconRef {
  const hash = raw.indexOf('#');
  const nsid = hash === 0 ? docId : hash > 0 ? raw.slice(0, hash) : raw;
  const def = hash >= 0 ? raw.slice(hash + 1) || 'main' : 'main';
  const local = nsid === docId;
  const label = local ? (def === 'main' ? '#main' : `#${def}`) : def === 'main' ? nsid : `${nsid}#${def}`;
  return { label, nsid, def, local };
}

const MAX_LISTED_VALUES = 8;

function listValues(values: unknown[]): string {
  const shown = values.slice(0, MAX_LISTED_VALUES).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  const more = values.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** A minimum and maximum in one phrase: `1–100`, `≥ 1`, `≤ 100`. */
function range(min: number | null, max: number | null, unit = ''): string | null {
  const suffix = unit ? ` ${unit}` : '';
  if (min !== null && max !== null) return `${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}${suffix}`;
  if (min !== null) return `≥ ${min.toLocaleString('en-US')}${suffix}`;
  if (max !== null) return `≤ ${max.toLocaleString('en-US')}${suffix}`;
  return null;
}

function bytes(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))} MB`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))} kB`;
  return `${n} bytes`;
}

/** The limits a schema node sets, in words, in the order a reader wants them. */
function constraintsOf(node: Json): string[] {
  const out: string[] = [];
  const type = asString(node.type);
  const format = asString(node.format);
  if (format) out.push(format);

  if (type === 'string') {
    const length = range(asNumber(node.minLength), asNumber(node.maxLength), 'bytes');
    const graphemes = range(asNumber(node.minGraphemes), asNumber(node.maxGraphemes), 'graphemes');
    if (graphemes) out.push(graphemes);
    if (length) out.push(length);
  } else if (type === 'integer') {
    const r = range(asNumber(node.minimum), asNumber(node.maximum));
    if (r) out.push(r);
  } else if (type === 'array') {
    const r = range(asNumber(node.minLength), asNumber(node.maxLength), 'items');
    if (r) out.push(r);
  } else if (type === 'bytes') {
    const r = range(asNumber(node.minLength), asNumber(node.maxLength), 'bytes');
    if (r) out.push(r);
  } else if (type === 'blob') {
    const accept = asStrings(node.accept);
    if (accept.length) out.push(accept.join(', '));
    const max = asNumber(node.maxSize);
    if (max !== null) out.push(`≤ ${bytes(max)}`);
  }

  if (Array.isArray(node.enum) && node.enum.length) out.push(`one of ${listValues(node.enum)}`);
  const known = asStrings(node.knownValues);
  if (known.length) out.push(`known: ${listValues(known)}`);
  if (node.const !== undefined) out.push(`always ${JSON.stringify(node.const)}`);
  if (node.default !== undefined) out.push(`default ${JSON.stringify(node.default)}`);
  return out;
}

class Reader {
  readonly references: string[] = [];
  private readonly seen = new Set<string>();

  constructor(readonly docId: string) {}

  ref(raw: string): LexiconRef {
    const ref = parseLexiconRef(raw, this.docId);
    if (!ref.local && !this.seen.has(ref.nsid)) {
      this.seen.add(ref.nsid);
      this.references.push(ref.nsid);
    }
    return ref;
  }

  type(node: Json | null): LexiconType {
    const type = asString(node?.type);
    if (!node || !type) return { kind: 'primitive', name: 'unknown' };
    if (type === 'ref') {
      const target = asString(node.ref);
      return target ? { kind: 'ref', ref: this.ref(target) } : { kind: 'primitive', name: 'ref' };
    }
    if (type === 'union') {
      return { kind: 'union', refs: asStrings(node.refs).map((r) => this.ref(r)), closed: node.closed === true };
    }
    if (type === 'array') return { kind: 'array', items: this.type(asObject(node.items)) };
    if (type === 'object' || type === 'params') return { kind: 'object', fields: this.fields(node) };
    return { kind: 'primitive', name: type };
  }

  fields(node: Json | null): LexiconField[] {
    const properties = asObject(node?.properties);
    if (!node || !properties) return [];
    const required = new Set(asStrings(node.required));
    const nullable = new Set(asStrings(node.nullable));
    return Object.entries(properties).map(([name, raw]) => {
      const prop = asObject(raw) ?? {};
      const description = asString(prop.description);
      // An array's limits on its items ("≤ 64 graphemes" each) read with
      // the array's own ("≤ 8 items").
      const items = asString(prop.type) === 'array' ? asObject(prop.items) : null;
      return {
        name,
        type: this.type(prop),
        required: required.has(name),
        nullable: nullable.has(name),
        description,
        constraints: [...constraintsOf(prop), ...(items ? constraintsOf(items).map((c) => `each ${c}`) : [])],
        deprecated: /^\s*deprecated\b/i.test(description ?? ''),
      };
    });
  }

  /** A query's or procedure's input or output, or a subscription's message. */
  body(title: string, node: Json | null): LexiconSection | null {
    if (!node) return null;
    const schema = asObject(node.schema);
    const schemaType = asString(schema?.type);
    const isObject = schemaType === 'object';
    return {
      title,
      encoding: asString(node.encoding),
      description: asString(node.description),
      fields: isObject ? this.fields(schema) : [],
      body: schema && !isObject ? this.type(schema) : null,
    };
  }

  def(name: string, raw: unknown): LexiconDef {
    const node = asObject(raw) ?? {};
    const type = asString(node.type) ?? 'unknown';
    const sections: LexiconSection[] = [];
    let shape: LexiconType | null = null;
    let constraints: string[] = [];

    if (type === 'record') {
      const record = asObject(node.record);
      sections.push({
        title: 'Fields',
        encoding: null,
        description: asString(record?.description),
        fields: this.fields(record),
        body: null,
      });
    } else if (type === 'query' || type === 'procedure' || type === 'subscription') {
      const params = asObject(node.parameters);
      const paramFields = this.fields(params);
      if (paramFields.length) {
        sections.push({ title: 'Parameters', encoding: null, description: null, fields: paramFields, body: null });
      }
      const parts: [string, unknown][] =
        type === 'subscription' ? [['Message', node.message]] : [['Input', node.input], ['Output', node.output]];
      for (const [title, part] of parts) {
        const section = this.body(title, asObject(part));
        if (section) sections.push(section);
      }
    } else if (type === 'object') {
      sections.push({ title: 'Fields', encoding: null, description: null, fields: this.fields(node), body: null });
    } else if (type !== 'token') {
      shape = this.type(node);
      constraints = constraintsOf(node);
      if (type === 'array') {
        const items = asObject(node.items);
        if (items) constraints.push(...constraintsOf(items).map((c) => `each ${c}`));
      }
    }

    const errors = Array.isArray(node.errors)
      ? node.errors.flatMap((e) => {
          const error = asObject(e);
          const errorName = asString(error?.name);
          return errorName ? [{ name: errorName, description: asString(error?.description) }] : [];
        })
      : [];

    return {
      name,
      type,
      description: asString(node.description),
      key: type === 'record' ? asString(node.key) : null,
      sections,
      errors,
      shape,
      constraints,
    };
  }
}

/**
 * Summarise a lexicon document. Null when the value is not one: no `defs`
 * object to read. `fallbackId` names it when the document leaves out its
 * own `id`, which the record key always carries.
 */
export function summarizeLexicon(doc: unknown, fallbackId: string): LexiconDocSummary | null {
  const root = asObject(doc);
  const defs = asObject(root?.defs);
  if (!root || !defs) return null;
  const id = asString(root.id) ?? fallbackId;
  const reader = new Reader(id);
  const main = defs.main !== undefined ? reader.def('main', defs.main) : null;
  const others = Object.entries(defs)
    .filter(([name]) => name !== 'main')
    .map(([name, raw]) => reader.def(name, raw));
  return {
    id,
    description: asString(root.description) ?? main?.description ?? null,
    main,
    defs: others,
    references: reader.references,
  };
}

/** A type as one line of text, for titles and tooltips. */
export function typeText(type: LexiconType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'ref':
      return type.ref.label;
    case 'union':
      return type.refs.length ? type.refs.map((r) => r.label).join(' | ') : 'union';
    case 'array':
      return `${typeText(type.items)}[]`;
    case 'object':
      return 'object';
  }
}
