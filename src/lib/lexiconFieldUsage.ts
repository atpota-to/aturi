/**
 * How often each field of a record lexicon is set in practice, measured
 * over a sample of real records: the share of records that set it, how many
 * accounts those came from, and what kinds of value they held. Beside a
 * published schema it shows which declared fields nobody uses, which
 * required ones some records leave out, and which fields records carry that
 * the schema never declares. Without one it is the only description of the
 * lexicon there is.
 *
 * Nothing here trusts a record's shape. The browser and the MCP server both
 * read it, so it has no imports beyond the schema summary's types.
 */

import type { LexiconDocSummary, LexiconField } from './lexiconSchema';

/**
 * How many levels of fields are counted: the record's own, and two of the
 * plain objects inside it. That covers the inline objects schemas declare
 * without walking a record that nests without end.
 */
export const MAX_USAGE_DEPTH = 3;

export type FieldUsage = {
  /** Dotted from the record's top level: `embed`, `source.url`. */
  path: string;
  name: string;
  /** Records in the sample that set it. */
  records: number;
  /** Distinct accounts among those records. */
  accounts: number;
  /**
   * What the values were, most common first: a JSON kind (`string`,
   * `integer`, `number`, `boolean`, `null`, `array`, `object`), one of the
   * data model's own (`blob`, `cid-link`, `bytes`), or an object's `$type`.
   */
  kinds: string[];
  /** The fields of a plain object value, measured against the records that set this one. */
  children: FieldUsage[];
};

export type FieldUsageSample = {
  records: number;
  accounts: number;
  /** When the newest and oldest records in the sample were seen, in ms; null without times. */
  newest: number | null;
  oldest: number | null;
  /** Top-level fields, most used first. */
  fields: FieldUsage[];
};

export type SampledRecord = { did: string; record: unknown; time_us?: number };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

/** A value's kind, in the words the data model uses for it. */
export function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'object': {
      const obj = value as Json;
      if (typeof obj.$type === 'string' && obj.$type) return obj.$type === 'blob' ? 'blob' : obj.$type;
      if (typeof obj.$link === 'string') return 'cid-link';
      if (typeof obj.$bytes === 'string') return 'bytes';
      return 'object';
    }
    default:
      return typeof value;
  }
}

type Acc = {
  path: string;
  name: string;
  records: number;
  dids: Set<string>;
  kinds: Map<string, number>;
  children: Map<string, Acc>;
};

function accFor(into: Map<string, Acc>, name: string, parent: string): Acc {
  let acc = into.get(name);
  if (!acc) {
    acc = { path: parent ? `${parent}.${name}` : name, name, records: 0, dids: new Set(), kinds: new Map(), children: new Map() };
    into.set(name, acc);
  }
  return acc;
}

function count(obj: Json, did: string, into: Map<string, Acc>, parent: string, depth: number) {
  for (const [name, value] of Object.entries(obj)) {
    // The type marker, not a field: always the record's own NSID at the top.
    if (name === '$type') continue;
    const acc = accFor(into, name, parent);
    acc.records++;
    acc.dids.add(did);
    const kind = kindOf(value);
    acc.kinds.set(kind, (acc.kinds.get(kind) ?? 0) + 1);
    // Only plain objects nest fields of their own; a typed one is another
    // definition's fields, and an array's items aren't one value each.
    const nested = kind === 'object' ? asObject(value) : null;
    if (nested && depth < MAX_USAGE_DEPTH) count(nested, did, acc.children, acc.path, depth + 1);
  }
}

function byUse(a: { records: number; name: string }, b: { records: number; name: string }) {
  return b.records - a.records || a.name.localeCompare(b.name);
}

function finish(accs: Map<string, Acc>): FieldUsage[] {
  return [...accs.values()]
    .map((acc) => ({
      path: acc.path,
      name: acc.name,
      records: acc.records,
      accounts: acc.dids.size,
      kinds: [...acc.kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k),
      children: finish(acc.children),
    }))
    .sort(byUse);
}

/** Count every field the records set. A value that isn't an object isn't a record, and is skipped. */
export function measureFieldUsage(records: readonly SampledRecord[]): FieldUsageSample {
  const root = new Map<string, Acc>();
  const dids = new Set<string>();
  let measured = 0;
  let newest: number | null = null;
  let oldest: number | null = null;
  for (const r of records) {
    const obj = asObject(r.record);
    if (!obj) continue;
    measured++;
    dids.add(r.did);
    if (typeof r.time_us === 'number' && Number.isFinite(r.time_us)) {
      const ms = r.time_us / 1000;
      newest = newest === null ? ms : Math.max(newest, ms);
      oldest = oldest === null ? ms : Math.min(oldest, ms);
    }
    count(obj, r.did, root, '', 1);
  }
  return { records: measured, accounts: dids.size, newest, oldest, fields: finish(root) };
}

/** Every field in the sample by its path, nested ones included. */
export function usageByPath(fields: readonly FieldUsage[], into = new Map<string, FieldUsage>()): Map<string, FieldUsage> {
  for (const f of fields) {
    into.set(f.path, f);
    usageByPath(f.children, into);
  }
  return into;
}

export type DeclaredField = { path: string; required: boolean; deprecated: boolean };

/**
 * A record lexicon's declared fields by path, in the schema's order, the
 * fields of inline objects included. Null when the main definition isn't a
 * record, since nothing else has records to measure.
 */
export function declaredRecordFields(summary: LexiconDocSummary | null): Map<string, DeclaredField> | null {
  const main = summary?.main;
  if (!main || main.type !== 'record') return null;
  const out = new Map<string, DeclaredField>();
  const walk = (fields: LexiconField[], parent: string, depth: number) => {
    for (const f of fields) {
      const path = parent ? `${parent}.${f.name}` : f.name;
      out.set(path, { path, required: f.required, deprecated: f.deprecated });
      if (f.type.kind === 'object' && depth < MAX_USAGE_DEPTH) walk(f.type.fields, path, depth + 1);
    }
  };
  walk(main.sections[0]?.fields ?? [], '', 1);
  return out;
}

function parentOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? null : path.slice(0, dot);
}

/** The records that could have set a field: the whole sample at the top, the parent's records below it. */
export function baseFor(path: string, sample: FieldUsageSample, byPath: Map<string, FieldUsage>): number {
  const parent = parentOf(path);
  return parent === null ? sample.records : (byPath.get(parent)?.records ?? 0);
}

export type FieldReportRow = {
  path: string;
  /** In the published schema; null when there is no record schema to compare with. */
  declared: boolean | null;
  required: boolean;
  records: number;
  /** The records that could have set it (baseFor). */
  of: number;
  accounts: number;
  kinds: string[];
};

/**
 * One row per field, declared or seen: the schema's fields in its order,
 * each followed by what records set inside it, then the fields records set
 * that it doesn't declare, most used first. Without a schema, every field
 * seen, most used first.
 */
export function fieldReport(sample: FieldUsageSample, declared: Map<string, DeclaredField> | null): FieldReportRow[] {
  const byPath = usageByPath(sample.fields);
  const rows: FieldReportRow[] = [];
  const done = new Set<string>();
  const row = (path: string): FieldReportRow => {
    const used = byPath.get(path);
    const decl = declared?.get(path);
    return {
      path,
      declared: declared ? Boolean(decl) : null,
      required: decl?.required ?? false,
      records: used?.records ?? 0,
      of: baseFor(path, sample, byPath),
      accounts: used?.accounts ?? 0,
      kinds: used?.kinds ?? [],
    };
  };
  const declaredPaths = declared ? [...declared.keys()] : [];
  const visit = (path: string) => {
    if (done.has(path)) return;
    done.add(path);
    rows.push(row(path));
    // Inside a field, its declared fields in the schema's order, then the rest by use.
    for (const p of declaredPaths) if (parentOf(p) === path) visit(p);
    for (const child of byPath.get(path)?.children ?? []) visit(child.path);
  };
  for (const p of declaredPaths) if (parentOf(p) === null) visit(p);
  for (const f of sample.fields) visit(f.path);
  return rows;
}

/**
 * A share as a whole percentage that never rounds a field some records set
 * down to 0%, or one some records leave out up to 100%.
 */
export function percentText(records: number, of: number): string {
  if (of <= 0) return '–';
  if (records <= 0) return '0%';
  if (records >= of) return '100%';
  const pct = Math.round((records / of) * 100);
  if (pct === 0) return '<1%';
  if (pct === 100) return '>99%';
  return `${pct}%`;
}
