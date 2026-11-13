/**
 * The lists and verifications tool's logic.
 *
 * Neither a list membership nor a verification is written in the account it
 * is about. A list is a record in its curator's repository, and each member
 * is a separate `app.bsky.graph.listitem` record beside it that names the
 * list and the member. A verification is an `app.bsky.graph.verification`
 * record in the verifier's repository that names who it vouches for. So the
 * question "what points at this account?" cannot be answered from the
 * account's own repository at all: it takes an index of every repository,
 * which is what Constellation is.
 *
 * Constellation returns coordinates (`{ did, collection, rkey }`), newest
 * first. Each list item is then read for the list it names, and each list
 * is looked up on the AppView for its name, purpose and size. A
 * verification is read for what it vouched for, and its issuer looked up for
 * whether Bluesky trusts it to verify: anyone can write a verification
 * record, and only those from trusted verifiers count for anything.
 *
 * Blocks are records of the same kind and are left out on purpose.
 *
 * Everything here is pure. The requests are in membershipsClient.ts.
 */

import { tidToDate } from '@/utils/atproto/tid';
import { NOT_LABELLED, parseSubjectInput } from './labels';

/** Constellation's name for "list items whose `subject` is this DID". */
export const LISTITEM_SOURCE = 'app.bsky.graph.listitem:subject';
/** And for "verifications whose `subject` is this DID". */
export const VERIFICATION_SOURCE = 'app.bsky.graph.verification:subject';

/** List memberships read per page. Each one costs two lookups to describe. */
export const LIST_PAGE_SIZE = 25;
/** Verifications read at most. Constellation's page limit, and far more than any account has that count. */
export const VERIFICATION_LIMIT = 100;

export type AccountInput = { ok: true; actor: string } | { ok: false; reason: string };

const ACCOUNTS_ONLY = 'Lists and verifications belong to accounts. Enter a handle or a DID.';

/** A handle, a DID, an at:// URI of an account, or a profile link. */
export function parseAccountInput(raw: string): AccountInput {
  if (!raw.trim()) return { ok: false, reason: 'Enter a handle or a DID.' };
  const input = parseSubjectInput(raw);
  if (!input.ok) return { ok: false, reason: input.reason === NOT_LABELLED ? ACCOUNTS_ONLY : input.reason };
  if (input.target.kind !== 'account') return { ok: false, reason: ACCOUNTS_ONLY };
  return { ok: true, actor: input.target.actor };
}

/* -------------------------------------------------------------------------- *
 * Lists
 * -------------------------------------------------------------------------- */

/**
 * What a list is for: `curate` to follow or build a feed from, `mod` to
 * mute or block its members, `reference` when it is the member list behind
 * a starter pack.
 */
export type ListPurpose = 'curate' | 'mod' | 'reference' | 'other';

export function listPurpose(purpose: string | undefined): ListPurpose {
  if (!purpose) return 'other';
  if (purpose.endsWith('#curatelist')) return 'curate';
  if (purpose.endsWith('#modlist')) return 'mod';
  if (purpose.endsWith('#referencelist')) return 'reference';
  return 'other';
}

export type ListInfo = {
  uri: string;
  name: string;
  purpose: ListPurpose;
  description: string | null;
  avatar: string | null;
  memberCount: number | null;
  creator: { did: string; handle: string | null; displayName: string | null };
};

export type Membership = {
  /** The list item record that puts the account on the list. */
  itemUri: string;
  /** The list it names. Null when the item record could not be read. */
  listUri: string | null;
  /** When the account was added, as an ISO timestamp. */
  addedAt: string | null;
  /** Null when the list is gone, hidden, or its curator's account is. */
  list: ListInfo | null;
};

/**
 * When a record was made: its own `createdAt` when that is a real date,
 * otherwise the timestamp inside its record key.
 */
export function recordedAt(createdAt: unknown, rkey: string): string | null {
  if (typeof createdAt === 'string') {
    const at = Date.parse(createdAt);
    if (Number.isFinite(at)) return new Date(at).toISOString();
  }
  return tidToDate(rkey)?.toISOString() ?? null;
}

/**
 * Add a page of memberships to what is already loaded, keeping one row per
 * list. An account is occasionally added to the same list twice, and
 * Constellation counts both records; the page should not show the list twice.
 */
export function mergeMemberships(existing: readonly Membership[], incoming: readonly Membership[]): Membership[] {
  const seen = new Set<string>();
  const out: Membership[] = [];
  for (const item of [...existing, ...incoming]) {
    const key = item.listUri ?? item.itemUri;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export type MembershipGroups = {
  curate: Membership[];
  mod: Membership[];
  /** Starter packs, by way of their member lists. */
  reference: Membership[];
  /** Lists that could not be described: deleted, or their curator is gone. */
  unavailable: Membership[];
};

export function groupMemberships(items: readonly Membership[]): MembershipGroups {
  const groups: MembershipGroups = { curate: [], mod: [], reference: [], unavailable: [] };
  for (const item of items) {
    if (!item.list) groups.unavailable.push(item);
    else if (item.list.purpose === 'mod') groups.mod.push(item);
    else if (item.list.purpose === 'reference') groups.reference.push(item);
    else groups.curate.push(item);
  }
  return groups;
}

/* -------------------------------------------------------------------------- *
 * Verifications
 * -------------------------------------------------------------------------- */

/**
 * How much a verification record counts for on Bluesky.
 *
 *   `valid`      from a trusted verifier, and the AppView accepts it.
 *   `stale`      from a trusted verifier, but the name or handle it vouched
 *                for has changed since, so the AppView no longer accepts it.
 *   `unlisted`   from a trusted verifier, yet absent from the AppView's own
 *                list for the account, so it is not being counted. A trusted
 *                verifier's verification of itself is the usual case.
 *   `untrusted`  the issuer is not a trusted verifier. The record exists and
 *                says what it says; Bluesky shows nothing for it.
 */
export type VerificationStanding = 'valid' | 'stale' | 'unlisted' | 'untrusted';

export type Verification = {
  /** The verification record. */
  uri: string;
  issuer: { did: string; handle: string | null; displayName: string | null; avatar: string | null };
  /** Whether Bluesky lets the issuer verify others. */
  issuerTrusted: boolean;
  /** The name and handle the issuer vouched for, as written at the time. */
  displayName: string | null;
  handle: string | null;
  createdAt: string | null;
  standing: VerificationStanding;
};

/**
 * Place a verification, given what the AppView says about the subject's
 * verifications (`uri` and `isValid` for each one it considers) and about
 * the issuer.
 */
export function verificationStanding(
  uri: string,
  issuerTrusted: boolean,
  appview: readonly { uri: string; isValid: boolean }[],
): VerificationStanding {
  const listed = appview.find((v) => v.uri === uri);
  if (listed) return listed.isValid ? 'valid' : 'stale';
  return issuerTrusted ? 'unlisted' : 'untrusted';
}

const STANDING_RANK: Record<VerificationStanding, number> = { valid: 0, stale: 1, unlisted: 2, untrusted: 3 };

/** The ones that count first, then newest first. */
export function sortVerifications(items: readonly Verification[]): Verification[] {
  return [...items].sort(
    (a, b) =>
      STANDING_RANK[a.standing] - STANDING_RANK[b.standing] ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
}

/* -------------------------------------------------------------------------- *
 * The summary
 * -------------------------------------------------------------------------- */

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * "is on 12 lists and has 2 verifications", for the verdict's title. A count
 * that could not be made (`null`) is left out rather than guessed at; its
 * own section says what went wrong.
 */
export function membershipSummary(lists: number | null, verifications: number | null): string {
  const parts: string[] = [];
  if (lists !== null) parts.push(lists === 0 ? 'is on no lists' : `is on ${plural(lists, 'list', 'lists')}`);
  if (verifications !== null) {
    parts.push(
      verifications === 0 ? 'has no verifications' : `has ${plural(verifications, 'verification', 'verifications')}`,
    );
  }
  return parts.length ? parts.join(' and ') : 'could not be looked up';
}
