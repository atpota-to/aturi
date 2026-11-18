/**
 * The lexicon publishing checker's logic: the chain an NSID has to complete
 * to be published, and how to read the evidence for each link.
 *
 * A lexicon is published in two halves (the Lexicon spec, "Lexicon
 * Publication and Resolution"):
 *
 *   NSID → DID      Drop the NSID's last part (its name) and reverse the rest
 *                   to get the authority domain. A TXT record at
 *                   `_lexicon.<authority>` holds `did=<did>`.
 *   DID → schema    That DID's repository holds a record in the collection
 *                   `com.atproto.lexicon.schema`, keyed by the full NSID.
 *
 * The first half is not hierarchical. `app.bsky.feed.post` is looked up at
 * `_lexicon.feed.bsky.app` and nowhere else: a record at `_lexicon.bsky.app`
 * does not cover it. That is the mistake this tool most often has to explain,
 * so it looks one level up for a record and says so when it finds one.
 *
 * Everything here is pure: it takes what was observed and says what it
 * means. The page (LexiconChecker.tsx) does the observing, all of it from
 * the browser: the TXT lookup over DNS-over-HTTPS, the DID document, and the
 * record straight from the authority's PDS.
 */

import { isValidNsid } from '@/utils/atproto/spaceUri';
import { publisherForNsid } from '@/utils/ufos/nsid';
import { summarizeLexicon } from '@/lib/lexiconSchema';
import { isDid, pdsEndpointFrom, type DidDocLike } from './handle';

export const LEXICON_SCHEMA_COLLECTION = 'com.atproto.lexicon.schema';

export type NsidInput = { ok: true; nsid: string } | { ok: false; reason: string };

/** Why `value` is not a valid NSID, or null when it is. */
export function nsidProblem(value: string): string | null {
  if (isValidNsid(value)) return null;
  if (value.length > 317) return 'An NSID can be at most 317 characters.';
  if (!/^[A-Za-z0-9.-]+$/.test(value)) return 'An NSID uses only letters, digits, hyphens and dots.';
  const segments = value.split('.');
  if (segments.length < 3) {
    return 'An NSID has at least three parts: a reversed domain, then a name, such as com.example.thing.';
  }
  if (segments.some((segment) => !segment)) return 'An NSID cannot have an empty part between dots.';
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(segments[segments.length - 1])) {
    return 'The last part of an NSID is its name: letters and digits only, starting with a letter.';
  }
  return 'That is not a valid NSID.';
}

/**
 * Tidy what was pasted into a bare NSID: a `lex:` prefix, a `#fragment`, an
 * at:// URI of a schema record, or a link to a lexicon page here.
 */
export function normalizeNsidInput(raw: string): NsidInput {
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter an NSID.' };

  const schemaRecord = value.match(/^at:\/\/[^/]+\/com\.atproto\.lexicon\.schema\/([^/?#]+)/i);
  const lexiconPage = value.match(/\/lexicons\/([^/?#]+)/);
  if (schemaRecord) value = schemaRecord[1];
  else if (lexiconPage) value = lexiconPage[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    // Not percent-encoded after all; keep it as typed.
  }
  value = value.replace(/^lex:/i, '').replace(/#.*$/, '');

  if (/\.\*$/.test(value)) {
    return { ok: false, reason: 'That is a whole namespace. Enter one full NSID from it, such as app.bsky.feed.post.' };
  }
  const problem = nsidProblem(value);
  return problem ? { ok: false, reason: problem } : { ok: true, nsid: value };
}

/** The two halves of an NSID: where its authority lives in DNS, and its name. */
export function nsidAuthority(nsid: string): { domain: string; name: string } {
  const segments = nsid.split('.');
  return {
    domain: segments.slice(0, -1).reverse().join('.').toLowerCase(),
    name: segments[segments.length - 1],
  };
}

/**
 * The domains above an authority that are worth a look when it has no record
 * of its own: each shorter suffix down to two labels, nearest first.
 * `feed.bsky.app` → `bsky.app`. Resolution never consults these; they are
 * only read to explain a record published one level too high.
 */
export function parentAuthorities(domain: string, limit = 3): string[] {
  const labels = domain.split('.');
  const parents: string[] = [];
  for (let start = 1; labels.length - start >= 2 && parents.length < limit; start++) {
    parents.push(labels.slice(start).join('.'));
  }
  return parents;
}

/* -------------------------------------------------------------------------- *
 * The DNS half
 * -------------------------------------------------------------------------- */

import type { TxtProbe } from './txt';

export { readTxtAnswer, unquoteTxt, type TxtProbe } from './txt';

export type LexiconTxtReading = {
  /** The DID the records name, when they name exactly one valid one. */
  did: string | null;
  /** Nothing at the name reads as a `did=` claim. */
  absent: boolean;
  /** Something is published but wrong. Null when `did` is set. */
  problem: string | null;
};

/** Read the TXT values at `_lexicon.<authority>`. */
export function readLexiconRecords(records: string[]): LexiconTxtReading {
  const claims = records.map((r) => r.trim()).filter((r) => /^did\s*=/i.test(r));
  if (claims.length === 0) {
    return {
      did: null,
      absent: true,
      problem: records.length > 0 ? 'There are TXT records at this name, but none of them starts with did=.' : null,
    };
  }
  const dids = [...new Set(claims.map((c) => c.replace(/^did\s*=\s*/i, '').trim()))];
  if (dids.length > 1) {
    return { did: null, absent: false, problem: 'More than one did= record is published. An authority can only name one repository.' };
  }
  const [did] = dids;
  if (!claims[0].startsWith(`did=${did}`)) {
    return { did: null, absent: false, problem: 'The record must read exactly did=<DID>, with no spaces and in lower case.' };
  }
  if (!isDid(did)) {
    return { did: null, absent: false, problem: `"${did}" is not a valid did:plc or did:web identifier.` };
  }
  return { did, absent: false, problem: null };
}

/* -------------------------------------------------------------------------- *
 * The schema document
 * -------------------------------------------------------------------------- */

export type SchemaDocumentReading = {
  /** What makes the document invalid as a published lexicon. */
  problems: string[];
  /** What is allowed but worth knowing. */
  notes: string[];
  /** What it defines, in a sentence. Null when it could not be read at all. */
  summary: string | null;
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** Check the value of a schema record against what the spec asks of one. */
export function readSchemaDocument(nsid: string, value: unknown): SchemaDocumentReading {
  const problems: string[] = [];
  const notes: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problems: ['The record is not a JSON object.'], notes, summary: null };
  }
  const doc = value as Record<string, unknown>;

  if (doc.$type !== LEXICON_SCHEMA_COLLECTION) {
    notes.push(
      doc.$type === undefined
        ? `The record has no $type. It should be ${LEXICON_SCHEMA_COLLECTION}.`
        : `The record's $type is ${String(doc.$type)}, not ${LEXICON_SCHEMA_COLLECTION}.`,
    );
  }
  if (doc.lexicon !== 1) {
    problems.push(
      doc.lexicon === undefined
        ? 'The lexicon field is missing. It must be the number 1.'
        : `The lexicon field is ${JSON.stringify(doc.lexicon)}. It must be the number 1.`,
    );
  }
  if (typeof doc.id !== 'string') {
    problems.push('The id field is missing. It must be the NSID, the same as the record key.');
  } else if (doc.id !== nsid) {
    problems.push(`The document's id is ${doc.id}, but the record key is ${nsid}. They must match.`);
  }

  const defs = doc.defs;
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) {
    problems.push('The defs field is missing. It holds the definitions, as an object keyed by name.');
    return { problems, notes, summary: null };
  }
  const names = Object.keys(defs);
  if (names.length === 0) problems.push('The defs object is empty, so the lexicon defines nothing.');
  const hashed = names.filter((name) => name.includes('#'));
  if (hashed.length > 0) {
    problems.push(`Definition names must not include a #: ${hashed.join(', ')}.`);
  }

  const summary = summarizeLexicon(value, nsid);
  if (!summary) return { problems, notes, summary: null };

  const { main } = summary;
  const others = summary.defs.length;
  let sentence: string;
  if (main) {
    const fields = main.sections.reduce((total, section) => total + section.fields.length, 0);
    sentence = `Defines a ${main.type}${main.key ? ` keyed by ${main.key}` : ''}`;
    if (fields > 0) sentence += ` with ${plural(fields, 'field')}`;
    if (others > 0) sentence += `, and ${plural(others, 'other definition')}`;
    sentence += '.';
  } else {
    sentence = `Has no main definition. It holds ${plural(others, 'named definition')} for other lexicons to refer to.`;
  }
  return { problems, notes, summary: sentence };
}

/* -------------------------------------------------------------------------- *
 * The check list
 * -------------------------------------------------------------------------- */

export type LexiconCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type LexiconCheck = {
  id: 'nsid' | 'dns' | 'authority' | 'record' | 'schema' | 'convention';
  status: LexiconCheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each. */
  detail?: string[];
  /** What to change, one paragraph each. */
  fix?: string[];
};

export type RecordProbe =
  | { status: 'found'; pds: string; uri: string; cid?: string; value: unknown }
  /** The PDS answered, and has no such record. */
  | { status: 'missing'; pds: string }
  /** The PDS could not be asked. */
  | { status: 'error'; pds: string; error: string };

/**
 * The lookup aturi.to's lexicons explorer falls back on when no DNS record
 * exists: the first two parts of the NSID, reversed, as a handle
 * (`app.bsky.feed.post` → `bsky.app`). Not part of the spec, and reported
 * here only so a reader knows why the explorer can show a schema that a
 * conforming resolver cannot find.
 */
export type ConventionProbe = {
  handle: string;
  /** Null when the handle does not resolve. */
  did: string | null;
  record: RecordProbe | null;
};

/**
 * What has been observed so far. A field left undefined is still on its way,
 * which is how the list fills in step by step; `null` means the lookup was
 * made and failed.
 */
export type LexiconEvidence = {
  nsid: string;
  dns?: TxtProbe;
  /** `_lexicon` records found above the authority, nearest first. Hints only. */
  parents?: { name: string; did: string }[];
  /** The DID document of the DID the DNS record names. */
  document?: DidDocLike | null;
  documentError?: string;
  record?: RecordProbe;
  convention?: ConventionProbe;
};

export type LexiconVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
};

const TITLES: Record<LexiconCheck['id'], string> = {
  nsid: 'NSID',
  dns: 'DNS record',
  authority: 'Authority’s repository',
  record: 'Schema record',
  schema: 'Schema document',
  convention: 'Handle convention',
};

const pending = (id: LexiconCheck['id']): LexiconCheck => ({
  id,
  status: 'pending',
  title: TITLES[id],
  summary: 'Checking…',
});

const skipped = (id: LexiconCheck['id'], why: string): LexiconCheck => ({
  id,
  status: 'skip',
  title: TITLES[id],
  summary: why,
});

/** The record a published schema lives at. */
export function schemaRecordUri(did: string, nsid: string): string {
  return `at://${did}/${LEXICON_SCHEMA_COLLECTION}/${nsid}`;
}

function recordFix(nsid: string): string[] {
  return [
    `Create a record in the collection ${LEXICON_SCHEMA_COLLECTION} with the record key ${nsid}, holding the lexicon document.`,
    'From a folder of lexicon files, goat lex publish does this for every schema in it.',
  ];
}

function schemaCheck(nsid: string, record: RecordProbe & { status: 'found' }): LexiconCheck {
  const reading = readSchemaDocument(nsid, record.value);
  if (reading.problems.length > 0) {
    return {
      id: 'schema',
      status: 'fail',
      title: TITLES.schema,
      summary:
        reading.problems.length === 1
          ? reading.problems[0]
          : `The record is there, but ${reading.problems.length} things are wrong with the document.`,
      detail: reading.problems.length > 1 ? reading.problems : undefined,
      fix: ['Publish the record again with lexicon set to 1, id equal to the NSID, and the definitions under defs.'],
    };
  }
  if (reading.notes.length > 0) {
    return {
      id: 'schema',
      status: 'warn',
      title: TITLES.schema,
      summary: `${reading.summary ?? 'A lexicon document.'} ${reading.notes[0]}`,
      detail: reading.notes.length > 1 ? reading.notes : undefined,
    };
  }
  return {
    id: 'schema',
    status: 'pass',
    title: TITLES.schema,
    summary: `A well-formed lexicon document. ${reading.summary ?? ''}`.trim(),
  };
}

/** Build the check list from whatever has been observed so far. */
export function buildLexiconChecks(evidence: LexiconEvidence): LexiconCheck[] {
  const { nsid, dns } = evidence;
  const { domain, name } = nsidAuthority(nsid);
  const dnsName = `_lexicon.${domain}`;
  const checks: LexiconCheck[] = [
    {
      id: 'nsid',
      status: 'pass',
      title: TITLES.nsid,
      summary: `A valid NSID. Its name is ${name}, and the rest, reversed, is its authority: ${domain}.`,
    },
  ];

  if (dns === undefined) {
    checks.push(pending('dns'), pending('authority'), pending('record'), pending('schema'));
    return checks;
  }

  // ── DNS ──
  const reading = readLexiconRecords(dns.records);
  const dnsDetail = [`TXT ${dns.name}`, ...(dns.records.length ? dns.records.map((r) => `→ ${r}`) : ['→ no records'])];
  const parent = evidence.parents?.[0];
  // A DID is only offered for the record when there is a reason to think it
  // is the right one: the domain above already names it, or its repository
  // already holds this schema.
  const { convention } = evidence;
  const knownDid = parent?.did ?? (convention?.record?.status === 'found' ? convention.did : null);
  const dnsFix = [
    `Add a TXT record at ${dnsName} with the value did=${knownDid ?? '<the DID of the repository that holds the schema>'}.`,
    'Every authority needs its own record. One for the domain above it does not cover it.',
  ];

  if (dns.status === 'error') {
    checks.push({
      id: 'dns',
      status: 'fail',
      title: TITLES.dns,
      summary: `The lookup failed: ${dns.error ?? 'no answer from the resolver'}.`,
      detail: [`TXT ${dns.name}`],
    });
  } else if (reading.did) {
    checks.push({
      id: 'dns',
      status: 'pass',
      title: TITLES.dns,
      summary: `The TXT record names ${reading.did}.`,
      detail: dnsDetail,
    });
  } else if (reading.problem && !reading.absent) {
    checks.push({ id: 'dns', status: 'fail', title: TITLES.dns, summary: reading.problem, detail: dnsDetail, fix: dnsFix });
  } else {
    checks.push({
      id: 'dns',
      status: 'fail',
      title: TITLES.dns,
      summary: parent
        ? `No did= record at this name. There is one at ${parent.name}, but lexicon resolution does not look up the hierarchy.`
        : (reading.problem ?? 'No TXT record is published at this name.'),
      detail: parent ? [...dnsDetail, `TXT ${parent.name}`, `→ did=${parent.did}`] : dnsDetail,
      fix: dnsFix,
    });
  }

  if (!reading.did) {
    const why = 'Not checked, because the DNS record names no DID.';
    checks.push(skipped('authority', why), skipped('record', why), skipped('schema', why));
    checks.push(conventionCheck(nsid, evidence.convention));
    return checks;
  }
  const did = reading.did;

  // ── The DID and its PDS ──
  const { document } = evidence;
  if (document === undefined) {
    checks.push(pending('authority'), pending('record'), pending('schema'));
    return checks;
  }
  const endpoint = pdsEndpointFrom(document);
  if (document === null || !endpoint) {
    const why = 'Not checked, because the repository could not be found.';
    checks.push(
      {
        id: 'authority',
        status: 'fail',
        title: TITLES.authority,
        summary:
          document === null
            ? `${did} could not be resolved${evidence.documentError ? `: ${evidence.documentError}` : '.'}`
            : `${did} resolves, but its DID document names no PDS, so there is no repository to hold a schema.`,
        fix: [
          document === null
            ? 'Check the DID in the TXT record is spelled exactly as its DID document has it.'
            : 'Point the TXT record at the DID of an account with a repository.',
        ],
      },
      skipped('record', why),
      skipped('schema', why),
    );
    return checks;
  }
  checks.push({
    id: 'authority',
    status: 'pass',
    title: TITLES.authority,
    summary: `The DID resolves. Its repository is on ${endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '')}.`,
    detail: [did],
  });

  // ── The record ──
  const { record } = evidence;
  if (record === undefined) {
    checks.push(pending('record'), pending('schema'));
    return checks;
  }
  const uri = schemaRecordUri(did, nsid);
  if (record.status === 'found') {
    checks.push(
      { id: 'record', status: 'pass', title: TITLES.record, summary: 'The repository holds a schema record for this NSID.', detail: [uri] },
      schemaCheck(nsid, record),
    );
  } else if (record.status === 'missing') {
    checks.push(
      {
        id: 'record',
        status: 'fail',
        title: TITLES.record,
        summary: 'The repository has no schema record for this NSID.',
        detail: [uri, '→ RecordNotFound'],
        fix: recordFix(nsid),
      },
      skipped('schema', 'Not checked, because there is no record to read.'),
    );
  } else {
    checks.push(
      {
        id: 'record',
        status: 'fail',
        title: TITLES.record,
        summary: `The PDS could not be asked for the record: ${record.error}.`,
        detail: [uri],
      },
      skipped('schema', 'Not checked, because the record could not be read.'),
    );
  }
  return checks;
}

function conventionCheck(nsid: string, convention: ConventionProbe | undefined): LexiconCheck {
  if (convention === undefined) return pending('convention');
  const { handle, did, record } = convention;
  if (!did) {
    return {
      id: 'convention',
      status: 'info',
      title: TITLES.convention,
      summary: `Without a DNS record, the lexicons explorer here tries ${handle} as a handle. It does not resolve, so no schema can be found that way either.`,
    };
  }
  if (record?.status === 'found') {
    const reading = readSchemaDocument(nsid, record.value);
    return {
      id: 'convention',
      status: 'info',
      title: TITLES.convention,
      summary: `${handle} resolves as a handle, and its repository holds a schema record for this NSID${
        reading.problems.length ? ', though the document has problems' : ''
      }. The lexicons explorer here finds it that way. A resolver that follows the spec does not.`,
      detail: [record.uri, ...reading.problems],
    };
  }
  return {
    id: 'convention',
    status: 'info',
    title: TITLES.convention,
    summary: `${handle} resolves as a handle, but its repository has no schema record for this NSID either.`,
    detail: [schemaRecordUri(did, nsid)],
  };
}

/** The handle the lexicons explorer would try for an NSID with no DNS record. */
export function conventionHandle(nsid: string): string {
  return publisherForNsid(nsid).toLowerCase();
}

/** The schema record the evidence turned up, by the spec's route or the convention's. */
export function foundSchema(
  evidence: LexiconEvidence,
): { via: 'dns' | 'convention'; did: string; record: RecordProbe & { status: 'found' } } | null {
  const did = evidence.dns ? readLexiconRecords(evidence.dns.records).did : null;
  if (did && evidence.record?.status === 'found') return { via: 'dns', did, record: evidence.record };
  const { convention } = evidence;
  if (!did && convention?.did && convention.record?.status === 'found') {
    return { via: 'convention', did: convention.did, record: convention.record };
  }
  return null;
}

/** The one-line answer above the list. */
export function lexiconVerdict(evidence: LexiconEvidence, checks: LexiconCheck[]): LexiconVerdict {
  const { nsid } = evidence;
  const { domain } = nsidAuthority(nsid);
  const by = (id: LexiconCheck['id']) => checks.find((c) => c.id === id);

  if (checks.some((c) => c.status === 'pending')) {
    return { tone: 'pending', title: `Checking ${nsid}`, text: `Looking up the TXT record at _lexicon.${domain}.` };
  }
  if (by('dns')?.status !== 'pass') {
    if (foundSchema(evidence)?.via === 'convention') {
      return {
        tone: 'warn',
        title: `${nsid} has a schema, but is not published`,
        text: `The record exists in ${evidence.convention?.handle}'s repository, but no TXT record at _lexicon.${domain} points there, so a resolver cannot find it.`,
      };
    }
    return {
      tone: 'fail',
      title: `${nsid} is not published`,
      text: `No TXT record at _lexicon.${domain} names the repository that holds its schema.`,
    };
  }
  for (const id of ['authority', 'record', 'schema'] as const) {
    const check = by(id);
    if (check?.status === 'fail') {
      return {
        tone: 'fail',
        title:
          id === 'schema'
            ? `${nsid} is published, but its document is not valid`
            : id === 'record'
              ? `${nsid} has an authority, but no schema`
              : `${nsid} names a repository that cannot be found`,
        text: check.summary,
      };
    }
  }
  const warning = checks.find((c) => c.status === 'warn');
  if (warning) {
    return { tone: 'warn', title: `${nsid} is published, with one thing to look at`, text: warning.summary };
  }
  return {
    tone: 'pass',
    title: `${nsid} is published`,
    text: 'The DNS record names a repository, and the schema record is in it.',
  };
}
