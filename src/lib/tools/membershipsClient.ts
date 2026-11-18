/**
 * The lists and verifications tool's requests. What they mean is in
 * memberships.ts.
 *
 * Three services, each for the one thing it holds:
 *
 *   - Constellation, for which records anywhere point at the account.
 *   - Slingshot, for what each of those records says.
 *   - The public AppView, for what a list is called and how big it is, who
 *     an issuer is, and which verifications Bluesky itself accepts.
 */

import { APPVIEW } from '@/utils/atproto/config';
import { getList, getProfilesResult, type AppViewProfile } from '@/utils/atproto/appview';
import { backlinksFromPage, getBacklinks, type BacklinksPage } from '@/utils/atproto/constellation';
import { getRecordsByUris, mapWithConcurrency, resolveMiniDoc } from '@/utils/atproto/slingshot';
import { resolveActor } from './labelsClient';
import {
  LISTITEM_SOURCE,
  LIST_PAGE_SIZE,
  VERIFICATION_LIMIT,
  VERIFICATION_SOURCE,
  listPurpose,
  recordedAt,
  sortVerifications,
  verificationStanding,
  type ListInfo,
  type Membership,
  type Verification,
} from './memberships';

/** `verification` on an AppView profile: what Bluesky makes of an account's verifications. */
type VerificationState = {
  verifications?: { issuer?: string; uri?: string; isValid?: boolean; createdAt?: string }[];
  /** `valid`, `invalid` or `none`. */
  verifiedStatus?: string;
  /** `valid` when the account may verify others. */
  trustedVerifierStatus?: string;
};

type ProfileWithVerification = AppViewProfile & { verification?: VerificationState };

export type Account = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  /** False when Bluesky's AppView has no profile for the account. */
  onBluesky: boolean;
  /** Bluesky shows the account as verified. */
  verified: boolean;
  /** Bluesky lets the account verify others. */
  trustedVerifier: boolean;
  /** The verifications the AppView considers, and whether each still holds. */
  considered: { uri: string; isValid: boolean }[];
};

const cleanHandle = (handle: string | null | undefined) =>
  handle && handle !== 'handle.invalid' ? handle : null;

/**
 * Who the account is. The AppView's profile carries its verification state;
 * an account with no Bluesky profile can still be on lists, so it falls back
 * to the bare identity rather than failing.
 */
export async function loadAccount(actor: string, signal: AbortSignal): Promise<Account> {
  const did = await resolveActor(actor);
  if (!did) throw new Error(`${actor} does not resolve to an account. Check the spelling, or use its DID.`);

  let profile: ProfileWithVerification | null = null;
  try {
    const res = await fetch(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { signal });
    if (res.ok) profile = (await res.json()) as ProfileWithVerification;
  } catch (err) {
    if (signal.aborted) throw err;
  }
  if (!profile) {
    const doc = await resolveMiniDoc(did, signal);
    return {
      did,
      handle: cleanHandle(doc?.handle),
      displayName: null,
      avatar: null,
      onBluesky: false,
      verified: false,
      trustedVerifier: false,
      considered: [],
    };
  }
  const state = profile.verification;
  return {
    did,
    handle: cleanHandle(profile.handle),
    displayName: profile.displayName?.trim() || null,
    avatar: profile.avatar ?? null,
    onBluesky: true,
    verified: state?.verifiedStatus === 'valid',
    trustedVerifier: state?.trustedVerifierStatus === 'valid',
    considered: (state?.verifications ?? []).flatMap((v) =>
      typeof v.uri === 'string' ? [{ uri: v.uri, isValid: v.isValid === true }] : [],
    ),
  };
}

/** Constellation's answer carries the count of every matching record, not just this page's. */
type CountedPage = BacklinksPage & { total?: number };

const recordUri = (r: { did: string; collection: string; rkey: string }) =>
  `at://${r.did}/${r.collection}/${r.rkey}`;

export type ListPage = {
  items: Membership[];
  /** Where the next page starts. Null at the end. */
  cursor: string | null;
  /** Every list item that names the account, across all pages. */
  total: number | null;
};

/** Lists described at once. Each is its own AppView request. */
const LIST_CONCURRENCY = 5;

function listInfo(uri: string, view: Awaited<ReturnType<typeof getList>>): ListInfo | null {
  const list = view?.list;
  if (!list?.creator?.did) return null;
  return {
    uri,
    name: list.name?.trim() || 'Untitled list',
    purpose: listPurpose(list.purpose),
    description: list.description?.trim() || null,
    avatar: list.avatar ?? null,
    memberCount: typeof list.listItemCount === 'number' ? list.listItemCount : null,
    creator: {
      did: list.creator.did,
      handle: cleanHandle(list.creator.handle),
      displayName: list.creator.displayName?.trim() || null,
    },
  };
}

/**
 * One page of the lists an account is on, newest first.
 *
 * Three steps, because no single service holds the whole answer:
 * Constellation says which list item records name the account, Slingshot
 * reads each one for the list it belongs to, and the AppView describes that
 * list. A list the AppView will not describe (deleted, or its curator
 * suspended) comes back with `list: null` rather than being dropped, so the
 * count on the page still adds up.
 */
export async function loadListPage(did: string, cursor: string | null, signal?: AbortSignal): Promise<ListPage> {
  const page = (await getBacklinks(did, LISTITEM_SOURCE, {
    limit: LIST_PAGE_SIZE,
    cursor: cursor ?? undefined,
  })) as CountedPage | null;
  if (!page) throw new Error('Constellation did not answer. Try again in a moment.');

  const records = backlinksFromPage(page);
  const items = await getRecordsByUris<{ list?: unknown; createdAt?: unknown }>(records.map(recordUri), { signal });
  const listUris = records.map((record) => {
    const list = items.get(recordUri(record))?.value.list;
    return typeof list === 'string' && list.startsWith('at://') ? list : null;
  });

  const unique = [...new Set(listUris.filter((uri): uri is string => uri !== null))];
  const views = await mapWithConcurrency(unique, LIST_CONCURRENCY, (list) => getList({ list, limit: 1, signal }));
  const described = new Map(unique.map((uri, index) => [uri, listInfo(uri, views[index])]));

  return {
    items: records.map((record, index) => {
      const itemUri = recordUri(record);
      const listUri = listUris[index];
      return {
        itemUri,
        listUri,
        addedAt: recordedAt(items.get(itemUri)?.value.createdAt, record.rkey),
        list: listUri ? (described.get(listUri) ?? null) : null,
      };
    }),
    cursor: page.cursor || null,
    total: typeof page.total === 'number' ? page.total : null,
  };
}

export type VerificationList = {
  items: Verification[];
  /**
   * How many verification records name the account. The rows themselves
   * when they all fit on one page, since Constellation's own total counts a
   * few records it no longer returns; its total only when there are more.
   */
  total: number;
};

/**
 * The verification records that name an account, with each issuer's
 * standing. `considered` is the AppView's own list for the account, which
 * decides whether a trusted issuer's record still holds.
 */
export async function loadVerifications(
  did: string,
  considered: readonly { uri: string; isValid: boolean }[],
  signal: AbortSignal,
): Promise<VerificationList> {
  const page = (await getBacklinks(did, VERIFICATION_SOURCE, { limit: VERIFICATION_LIMIT })) as CountedPage | null;
  if (!page) throw new Error('Constellation did not answer. Try again in a moment.');
  const records = backlinksFromPage(page);
  if (records.length === 0) return { items: [], total: 0 };

  const [values, issuers] = await Promise.all([
    getRecordsByUris<{ handle?: unknown; displayName?: unknown; createdAt?: unknown }>(records.map(recordUri), { signal }),
    getProfilesResult(records.map((r) => r.did), { signal }),
  ]);

  const items = records.map((record): Verification => {
    const uri = recordUri(record);
    const value = values.get(uri)?.value;
    const profile = issuers.profiles.get(record.did) as ProfileWithVerification | undefined;
    const issuerTrusted = profile?.verification?.trustedVerifierStatus === 'valid';
    return {
      uri,
      issuer: {
        did: record.did,
        handle: cleanHandle(profile?.handle),
        displayName: profile?.displayName?.trim() || null,
        avatar: profile?.avatar ?? null,
      },
      issuerTrusted,
      displayName: typeof value?.displayName === 'string' ? value.displayName : null,
      handle: typeof value?.handle === 'string' ? value.handle : null,
      createdAt: recordedAt(value?.createdAt, record.rkey),
      standing: verificationStanding(uri, issuerTrusted, considered),
    };
  });
  const total = page.cursor && typeof page.total === 'number' ? Math.max(page.total, items.length) : items.length;
  return { items: sortVerifications(items), total };
}
