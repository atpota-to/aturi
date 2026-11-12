/**
 * The handle debugger's logic: what a handle has to get right, and how to
 * read the evidence for each step.
 *
 * A handle is a domain name that claims a DID, and the claim only counts when
 * the DID claims it back:
 *
 *   handle → DID   by a `_atproto.<handle>` TXT record holding `did=<did>`,
 *                  or by `https://<handle>/.well-known/atproto-did` answering
 *                  with the DID as plain text. Either is enough.
 *   DID → handle   by the DID document listing `at://<handle>` under
 *                  `alsoKnownAs`.
 *
 * Everything here is pure: it takes what was observed and says what it
 * means. The observing is split by who can do it. The TXT lookup and the
 * well-known read happen on the server (src/app/api/tools/handle), since a
 * browser can do neither against an arbitrary host. The DID document, the
 * PDS and the AppView all answer a browser directly, so the page asks them
 * itself.
 */

export type HandleInput = { ok: true; handle: string } | { ok: false; reason: string };

/**
 * TLDs the handle spec rules out: none of them can be resolved on the public
 * internet, so a handle under one can never verify.
 */
const DISALLOWED_TLDS = new Set(['alt', 'arpa', 'example', 'internal', 'invalid', 'local', 'localhost', 'onion']);

/** Tidy what was typed (`@name`, `at://name`, a trailing dot, capitals) into a bare handle. */
export function normalizeHandleInput(raw: string): HandleInput {
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a handle.' };
  value = value.replace(/^at:\/\//i, '').replace(/^@/, '');
  if (/^did:/i.test(value)) {
    return { ok: false, reason: 'That is a DID. Enter the handle you expect it to have.' };
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return { ok: false, reason: 'That URL could not be read. Enter a handle such as alice.example.com.' };
    }
  }
  value = value.split('/')[0].replace(/\.$/, '').toLowerCase();
  const problem = handleSyntaxProblem(value);
  return problem ? { ok: false, reason: problem } : { ok: true, handle: value };
}

/** Why `handle` is not a syntactically valid handle, or null when it is. */
export function handleSyntaxProblem(handle: string): string | null {
  if (handle.length > 253) return 'A handle can be at most 253 characters.';
  const labels = handle.split('.');
  if (labels.length < 2) return 'A handle is a domain name, so it needs at least two parts, such as alice.example.com.';
  for (const label of labels) {
    if (!label) return 'A handle cannot have an empty part between dots.';
    if (label.length > 63) return 'Each part of a handle can be at most 63 characters.';
    if (!/^[a-z0-9-]+$/.test(label)) {
      return 'A handle can only use letters, digits and hyphens between its dots.';
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return 'No part of a handle can start or end with a hyphen.';
    }
  }
  const tld = labels[labels.length - 1];
  if (/^[0-9]/.test(tld)) return 'The last part of a handle cannot start with a digit.';
  if (DISALLOWED_TLDS.has(tld)) return `.${tld} is a reserved name that cannot be used for a handle.`;
  return null;
}

export function isDid(value: string): boolean {
  return /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)$/.test(value);
}

/* -------------------------------------------------------------------------- *
 * What the server route reports
 * -------------------------------------------------------------------------- */

export type DnsProbe = {
  /** The name that was asked, `_atproto.<handle>`. */
  name: string;
  /** `found`: TXT records exist. `none`: the name has none. `error`: the lookup failed. */
  status: 'found' | 'none' | 'error';
  /** Every TXT value at the name, unquoted. */
  records: string[];
  error?: string;
};

export type HttpProbe = {
  url: string;
  /** `answered`: the host returned a response, whatever its status. */
  status: 'answered' | 'error';
  httpStatus?: number;
  contentType?: string | null;
  /** The body, trimmed and capped. */
  body?: string;
  /** Where the request ended up, when it was redirected. */
  finalUrl?: string;
  error?: string;
};

export type HandleProbe = { handle: string; dns: DnsProbe; http: HttpProbe };

/* -------------------------------------------------------------------------- *
 * Reading the two resolution methods
 * -------------------------------------------------------------------------- */

export type MethodReading = {
  /** The DID this method names, when it names exactly one valid one. */
  did: string | null;
  /** Nothing is set up for this method at all, which is fine if the other works. */
  absent: boolean;
  /** Something is set up but wrong. Null when `did` is set or the method is absent. */
  problem: string | null;
};

/** Read the TXT values at `_atproto.<handle>`. */
export function readDnsRecords(records: string[]): MethodReading {
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
    return { did: null, absent: false, problem: 'More than one did= record is published. A handle can only name one DID.' };
  }
  const [did] = dids;
  if (!claims[0].startsWith(`did=${did}`)) {
    return { did: null, absent: false, problem: 'The record must read exactly did=<your DID>, with no spaces and in lower case.' };
  }
  if (!isDid(did)) {
    return { did: null, absent: false, problem: `"${did}" is not a valid did:plc or did:web identifier.` };
  }
  return { did, absent: false, problem: null };
}

/** Read the answer from `https://<handle>/.well-known/atproto-did`. */
export function readWellKnown(probe: HttpProbe): MethodReading {
  if (probe.status === 'error') {
    return { did: null, absent: true, problem: null };
  }
  const status = probe.httpStatus ?? 0;
  if (status === 404 || status === 410) return { did: null, absent: true, problem: null };
  if (status < 200 || status >= 300) {
    return { did: null, absent: false, problem: `The file answered with HTTP ${status} rather than 200.` };
  }
  const body = (probe.body ?? '').trim();
  if (!body) return { did: null, absent: false, problem: 'The file is empty. It must contain the DID and nothing else.' };
  if (/^<|<html|<!doctype/i.test(body)) {
    return {
      did: null,
      absent: false,
      problem: 'The address returns a web page rather than the DID. The host is answering every path with its site.',
    };
  }
  if (!isDid(body)) {
    return {
      did: null,
      absent: false,
      problem: 'The file must contain only the DID, as plain text on one line.',
    };
  }
  return { did: body, absent: false, problem: null };
}

/* -------------------------------------------------------------------------- *
 * The check list
 * -------------------------------------------------------------------------- */

export type HandleCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type HandleCheck = {
  id: 'dns' | 'http' | 'agree' | 'document' | 'claim' | 'pds' | 'appview';
  status: HandleCheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each. */
  detail?: string[];
  /** What to change, one paragraph each. */
  fix?: string[];
};

/** A DID document, as much of it as the debugger reads. */
export type DidDocLike = {
  id?: string;
  alsoKnownAs?: string[];
  service?: { id: string; type?: string; serviceEndpoint?: unknown }[];
};

/**
 * What has been observed so far. A field left undefined is still on its way,
 * which is how the list fills in step by step; `null` means the lookup was
 * made and failed.
 */
export type HandleEvidence = {
  handle: string;
  probe?: HandleProbe | null;
  probeError?: string;
  /** The DID document for the DID the handle names. */
  document?: DidDocLike | null;
  documentError?: string;
  /** What the account's PDS says about it. */
  pds?: {
    endpoint: string;
    reachable: boolean;
    /** `handle` from describeRepo. */
    handle?: string;
    handleIsCorrect?: boolean;
    /** From getRepoStatus: false when taken down, deactivated, and so on. */
    active?: boolean;
    status?: string;
    error?: string;
  } | null;
  /** The handle Bluesky's AppView currently shows for the DID. */
  appview?: { handle?: string; resolvesTo?: string | null; error?: string } | null;
};

export type HandleVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
  /** The DID the handle resolves to, when it resolves at all. */
  did: string | null;
};

export function handlesFromAlsoKnownAs(alsoKnownAs: string[] | undefined): string[] {
  return (alsoKnownAs ?? [])
    .filter((aka) => /^at:\/\//i.test(aka))
    .map((aka) => aka.slice('at://'.length).toLowerCase());
}

export function pdsEndpointFrom(doc: DidDocLike | null | undefined): string | null {
  const service =
    doc?.service?.find((s) => s.id === '#atproto_pds' || s.id.endsWith('#atproto_pds')) ??
    doc?.service?.find((s) => s.type === 'AtprotoPersonalDataServer');
  return typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : null;
}

/** The DID the two methods settle on. DNS wins when they disagree, as resolvers do. */
export function resolvedDid(probe: HandleProbe | null | undefined): string | null {
  if (!probe) return null;
  return readDnsRecords(probe.dns.records).did ?? readWellKnown(probe.http).did;
}

const PENDING = (id: HandleCheck['id'], title: string): HandleCheck => ({
  id,
  status: 'pending',
  title,
  summary: 'Checking…',
});

const SKIPPED = (id: HandleCheck['id'], title: string, why: string): HandleCheck => ({
  id,
  status: 'skip',
  title,
  summary: why,
});

function dnsFix(handle: string, did: string | null): string[] {
  return [
    `Add a TXT record at _atproto.${handle} with the value did=${did ?? '<your DID>'}.`,
    'Many DNS providers add the domain for you, so the name to enter is often just _atproto.',
  ];
}

/** Build the check list from whatever has been observed so far. */
export function buildHandleChecks(evidence: HandleEvidence): HandleCheck[] {
  const { handle, probe } = evidence;
  const checks: HandleCheck[] = [];
  const DNS_TITLE = 'DNS record';
  const HTTP_TITLE = 'Well-known file';

  if (probe === undefined) {
    return [
      PENDING('dns', DNS_TITLE),
      PENDING('http', HTTP_TITLE),
      PENDING('document', 'DID document'),
      PENDING('claim', 'DID claims the handle'),
      PENDING('pds', 'Account on its PDS'),
      PENDING('appview', 'Bluesky AppView'),
    ];
  }
  if (probe === null) {
    const why = evidence.probeError ?? 'The lookup could not be made.';
    return [
      { id: 'dns', status: 'fail', title: DNS_TITLE, summary: why },
      { id: 'http', status: 'fail', title: HTTP_TITLE, summary: why },
      SKIPPED('document', 'DID document', 'Not checked, because the handle did not resolve.'),
      SKIPPED('claim', 'DID claims the handle', 'Not checked, because the handle did not resolve.'),
    ];
  }

  const dns = readDnsRecords(probe.dns.records);
  const http = readWellKnown(probe.http);
  const did = dns.did ?? http.did;
  const eitherWorks = Boolean(did);

  // ── DNS ──
  const dnsDetail = [
    `TXT ${probe.dns.name}`,
    ...(probe.dns.records.length ? probe.dns.records.map((r) => `→ ${r}`) : ['→ no records']),
  ];
  if (probe.dns.status === 'error') {
    checks.push({
      id: 'dns',
      status: eitherWorks ? 'warn' : 'fail',
      title: DNS_TITLE,
      summary: `The lookup failed: ${probe.dns.error ?? 'no answer from the resolver'}.`,
      detail: [`TXT ${probe.dns.name}`],
    });
  } else if (dns.did) {
    checks.push({
      id: 'dns',
      status: 'pass',
      title: DNS_TITLE,
      summary: `The TXT record names ${dns.did}.`,
      detail: dnsDetail,
    });
  } else if (dns.problem && !dns.absent) {
    checks.push({
      id: 'dns',
      status: 'fail',
      title: DNS_TITLE,
      summary: dns.problem,
      detail: dnsDetail,
      fix: dnsFix(handle, http.did),
    });
  } else {
    checks.push({
      id: 'dns',
      status: http.did ? 'info' : 'fail',
      title: DNS_TITLE,
      summary: http.did
        ? 'No did= record here. That is fine: the well-known file answers instead.'
        : (dns.problem ?? 'No TXT record is published at this name.'),
      detail: dnsDetail,
      fix: http.did ? undefined : dnsFix(handle, null),
    });
  }

  // ── Well-known ──
  const httpDetail = [`GET ${probe.http.url}`];
  if (probe.http.finalUrl && probe.http.finalUrl !== probe.http.url) {
    httpDetail.push(`→ redirected to ${probe.http.finalUrl}`);
  }
  if (probe.http.status === 'answered') {
    httpDetail.push(
      `→ HTTP ${probe.http.httpStatus}${probe.http.contentType ? `, ${probe.http.contentType}` : ''}`,
    );
    const body = (probe.http.body ?? '').trim();
    if (body && http.did === null && (probe.http.httpStatus ?? 0) < 400) {
      httpDetail.push(`→ ${body.length > 160 ? `${body.slice(0, 160)}…` : body}`);
    }
  } else {
    httpDetail.push(`→ ${probe.http.error ?? 'no answer'}`);
  }
  const httpFix = [
    `Serve a plain text file at https://${handle}/.well-known/atproto-did containing only ${dns.did ?? 'your DID'}.`,
    'Or leave this out and use the DNS record: only one of the two is needed.',
  ];
  if (http.did) {
    checks.push({
      id: 'http',
      status: 'pass',
      title: HTTP_TITLE,
      summary: `The file contains ${http.did}.`,
      detail: httpDetail,
    });
  } else if (http.problem && !http.absent) {
    checks.push({
      id: 'http',
      // A broken file beside a working record is still worth fixing: some
      // resolvers try this method first.
      status: dns.did ? 'warn' : 'fail',
      title: HTTP_TITLE,
      summary: http.problem,
      detail: httpDetail,
      fix: httpFix,
    });
  } else {
    checks.push({
      id: 'http',
      status: dns.did ? 'info' : 'fail',
      title: HTTP_TITLE,
      summary: dns.did
        ? 'No file here. That is fine: the DNS record answers instead.'
        : probe.http.status === 'error'
          ? `The host could not be reached: ${probe.http.error ?? 'no answer'}.`
          : 'No file is served at this address.',
      detail: httpDetail,
      fix: dns.did ? undefined : httpFix,
    });
  }

  // ── The two agree ──
  if (dns.did && http.did && dns.did !== http.did) {
    checks.push({
      id: 'agree',
      status: 'warn',
      title: 'Both methods agree',
      summary: 'The DNS record and the well-known file name different DIDs. Resolvers prefer the DNS record, but some treat the handle as ambiguous.',
      detail: [`DNS → ${dns.did}`, `Well-known → ${http.did}`],
      fix: ['Remove whichever one is out of date, or make both name the same DID.'],
    });
  }

  if (!did) {
    checks.push(
      SKIPPED('document', 'DID document', 'Not checked, because the handle names no DID.'),
      SKIPPED('claim', 'DID claims the handle', 'Not checked, because the handle names no DID.'),
    );
    return checks;
  }

  // ── DID document ──
  const { document } = evidence;
  if (document === undefined) {
    checks.push(
      PENDING('document', 'DID document'),
      PENDING('claim', 'DID claims the handle'),
      PENDING('pds', 'Account on its PDS'),
      PENDING('appview', 'Bluesky AppView'),
    );
    return checks;
  }
  if (document === null) {
    checks.push(
      {
        id: 'document',
        status: 'fail',
        title: 'DID document',
        summary: `${did} could not be resolved${evidence.documentError ? `: ${evidence.documentError}` : '.'}`,
        fix: [
          did.startsWith('did:web:')
            ? 'A did:web document is served from /.well-known/did.json on its host. Check that it is reachable over https.'
            : 'Check the DID is spelled exactly as the PLC directory has it. A did:plc is 24 characters after the prefix.',
        ],
      },
      SKIPPED('claim', 'DID claims the handle', 'Not checked, because the DID document could not be read.'),
    );
    return checks;
  }

  const listed = handlesFromAlsoKnownAs(document.alsoKnownAs);
  const endpoint = pdsEndpointFrom(document);
  checks.push({
    id: 'document',
    status: endpoint ? 'pass' : 'warn',
    title: 'DID document',
    summary: endpoint
      ? `Resolved. The account's PDS is ${endpoint.replace(/^https?:\/\//, '')}.`
      : 'Resolved, but it names no PDS, so there is no repository behind this identity.',
    detail: [did, ...(listed.length ? listed.map((h) => `alsoKnownAs at://${h}`) : ['alsoKnownAs: none'])],
  });

  // ── The DID claims the handle back ──
  const position = listed.indexOf(handle);
  if (position === 0) {
    checks.push({
      id: 'claim',
      status: 'pass',
      title: 'DID claims the handle',
      summary: `The document lists at://${handle} as its handle, so the link holds in both directions.`,
    });
  } else if (position > 0) {
    checks.push({
      id: 'claim',
      status: 'warn',
      title: 'DID claims the handle',
      summary: `The document lists at://${handle}, but not first. Only the first at:// entry is the account's handle; it is currently ${listed[0]}.`,
      fix: ['Set this handle as the account’s handle in its app or PDS settings, which moves it to the front.'],
    });
  } else {
    checks.push({
      id: 'claim',
      status: 'fail',
      title: 'DID claims the handle',
      summary: listed.length
        ? `The domain points at this DID, but the DID's handle is ${listed[0]}. Until the DID claims this handle too, apps show it as invalid.`
        : 'The domain points at this DID, but the DID document lists no handle at all.',
      fix: [
        'Sign in to the account and change its handle to this domain (in Bluesky: Settings, Account, Handle, “I have my own domain”).',
        'That writes the handle into the DID document. The DNS record or file alone is only half of the link.',
      ],
    });
  }

  // ── PDS ──
  const { pds } = evidence;
  if (!endpoint) {
    checks.push(SKIPPED('pds', 'Account on its PDS', 'Not checked, because the DID document names no PDS.'));
  } else if (pds === undefined) {
    checks.push(PENDING('pds', 'Account on its PDS'));
  } else if (pds === null || !pds.reachable) {
    checks.push({
      id: 'pds',
      status: 'warn',
      title: 'Account on its PDS',
      summary: `The PDS did not answer${pds?.error ? `: ${pds.error}` : '.'} The handle can still be valid, but the account cannot be read right now.`,
      detail: [endpoint],
    });
  } else if (pds.active === false) {
    checks.push({
      id: 'pds',
      status: 'warn',
      title: 'Account on its PDS',
      summary: `The PDS reports this account as ${pds.status ?? 'inactive'}. Apps will not show it, whatever the handle says.`,
      detail: [endpoint],
    });
  } else if (pds.handleIsCorrect === false) {
    checks.push({
      id: 'pds',
      status: 'warn',
      title: 'Account on its PDS',
      summary: `The PDS serves the account, but could not confirm its handle${pds.handle ? ` (${pds.handle})` : ''} when it last checked.`,
      detail: [endpoint],
      fix: ['The PDS re-checks handles on its own schedule. Saving the handle again in the account’s settings makes it check now.'],
    });
  } else {
    checks.push({
      id: 'pds',
      status: 'pass',
      title: 'Account on its PDS',
      summary:
        pds.handle && pds.handle.toLowerCase() !== handle
          ? `The account is active. The PDS knows it as ${pds.handle}.`
          : 'The account is active and the PDS confirms its handle.',
      detail: [endpoint],
    });
  }

  // ── AppView ──
  const { appview } = evidence;
  if (appview === undefined) {
    checks.push(PENDING('appview', 'Bluesky AppView'));
  } else if (appview === null || appview.error) {
    checks.push({
      id: 'appview',
      status: 'info',
      title: 'Bluesky AppView',
      summary: `Bluesky's AppView has no profile for this DID${appview?.error ? ` (${appview.error})` : ''}. That is normal for an account that does not use Bluesky.`,
    });
  } else if (appview.handle === 'handle.invalid') {
    checks.push({
      id: 'appview',
      status: position === 0 ? 'warn' : 'fail',
      title: 'Bluesky AppView',
      summary:
        position === 0
          ? 'Bluesky currently shows this account as handle.invalid. Everything above checks out, so it has not re-checked yet.'
          : 'Bluesky shows this account as handle.invalid, because the handle and the DID do not point at each other.',
      fix:
        position === 0
          ? ['Save the handle again in the account’s settings. That sends an identity event, and the AppView re-checks when it sees one.']
          : undefined,
    });
  } else if (appview.handle && appview.handle.toLowerCase() === handle) {
    checks.push({
      id: 'appview',
      status: 'pass',
      title: 'Bluesky AppView',
      summary: 'Bluesky shows this account under this handle.',
    });
  } else {
    checks.push({
      id: 'appview',
      status: position === 0 ? 'warn' : 'info',
      title: 'Bluesky AppView',
      summary: `Bluesky shows this account as ${appview.handle ?? 'an unknown handle'}${position === 0 ? ', so it has not picked up the change yet.' : '.'}`,
    });
  }

  return checks;
}

/** The one-line answer above the list. */
export function handleVerdict(evidence: HandleEvidence, checks: HandleCheck[]): HandleVerdict {
  const { handle } = evidence;
  const did = resolvedDid(evidence.probe);
  const by = (id: HandleCheck['id']) => checks.find((c) => c.id === id);

  if (checks.some((c) => c.status === 'pending')) {
    return { tone: 'pending', title: `Checking ${handle}`, text: 'Looking up the DNS record and the well-known file.', did };
  }
  if (!did) {
    return {
      tone: 'fail',
      title: `${handle} does not resolve to a DID`,
      text: 'Neither the DNS record nor the well-known file names one. Set up either, then check again.',
      did,
    };
  }
  const document = by('document');
  if (document?.status === 'fail') {
    return { tone: 'fail', title: `${handle} names a DID that cannot be resolved`, text: document.summary, did };
  }
  const claim = by('claim');
  if (claim?.status === 'fail') {
    return {
      tone: 'fail',
      title: `${handle} is not a valid handle yet`,
      text: 'The domain points at the DID, but the DID does not claim this handle. Both directions have to agree.',
      did,
    };
  }
  const warnings = checks.filter((c) => c.status === 'warn');
  if (warnings.length > 0) {
    return {
      tone: 'warn',
      title: `${handle} verifies, with ${warnings.length === 1 ? 'one thing' : `${warnings.length} things`} to look at`,
      text: warnings[0].summary,
      did,
    };
  }
  return {
    tone: 'pass',
    title: `${handle} is a valid handle`,
    text: 'The domain names the DID and the DID claims the domain.',
    did,
  };
}
