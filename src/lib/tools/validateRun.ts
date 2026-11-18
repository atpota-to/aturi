/**
 * Validates a record against the schemas its authors actually published,
 * fetching them as it goes. The checking itself is in validate.ts; this is
 * the part that talks to the network, shared by the validator tool and the
 * explorer's record view.
 *
 * Schemas are fetched lazily. A lexicon can refer to dozens of others, but a
 * given record only exercises a few of them: a post with no embed never
 * reaches the embed lexicons. So the record is validated with what is in
 * hand, the lexicons that turned out to be needed are looked up, and it is
 * validated again, until nothing new is needed. `lookupLexiconSchema` keeps
 * found schemas for an hour, so a second record of the same type costs
 * nothing.
 */

import { lookupLexiconSchema, type SchemaLookup } from '@/utils/atproto/lexiconSchemaLookup';
import { validateRecord, type LexiconDocLike, type ValidationResult } from './validate';

/** Rounds of "validate, then fetch what was missing". Refs rarely nest deeper than three. */
const MAX_ROUNDS = 6;
/** A ceiling on lookups for one record, whatever its schema asks for. */
const MAX_LEXICONS = 40;

export type RecordCheck = {
  nsid: string;
  /** How the record's own lexicon was found, or why it was not. */
  schema: SchemaLookup;
  result: ValidationResult;
  /** Every lexicon consulted, in the order it was needed. */
  lookups: SchemaLookup[];
};

export type RecordVerdict =
  /** Checked, nothing wrong. */
  | 'valid'
  /** Checked, with only warnings. */
  | 'warnings'
  | 'invalid'
  /** No schema is published for this type, so there is nothing to check against. */
  | 'no-schema';

export function recordVerdict(check: RecordCheck): RecordVerdict {
  if (check.schema.status !== 'found') return 'no-schema';
  if (check.result.issues.some((issue) => issue.severity === 'error')) return 'invalid';
  return check.result.issues.length ? 'warnings' : 'valid';
}

export async function checkRecord(
  record: unknown,
  nsid: string,
  options: { rkey?: string; signal?: AbortSignal } = {},
): Promise<RecordCheck> {
  const docs = new Map<string, LexiconDocLike | null>();
  const lookups: SchemaLookup[] = [];

  const fetchAll = async (nsids: string[]) => {
    const answers = await Promise.all(nsids.map((id) => lookupLexiconSchema(id)));
    answers.forEach((answer, index) => {
      lookups.push(answer);
      docs.set(nsids[index], answer.status === 'found' ? (answer.doc as LexiconDocLike) : null);
    });
  };

  await fetchAll([nsid]);
  let result = validateRecord(record, nsid, docs, { rkey: options.rkey });
  for (let round = 0; round < MAX_ROUNDS && !options.signal?.aborted; round++) {
    // An unresolved entry is an NSID, or `nsid#def` for a definition missing
    // from a document already in hand; only the first kind can be fetched.
    const wanted = [...new Set(result.unresolved.map((entry) => entry.split('#')[0]))]
      .filter((id) => !docs.has(id))
      .slice(0, MAX_LEXICONS - docs.size);
    if (!wanted.length) break;
    await fetchAll(wanted);
    result = validateRecord(record, nsid, docs, { rkey: options.rkey });
  }

  return { nsid, schema: lookups[0], result, lookups };
}
