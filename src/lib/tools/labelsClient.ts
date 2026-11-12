/**
 * The label checker's requests. What they mean is in labels.ts.
 *
 * Three services, all of which answer a browser directly:
 *
 *   - `api.bsky.app` for the labels themselves, because it is the AppView
 *     host that reads `atproto-accept-labelers` (labels.ts explains why the
 *     cached public host cannot be used for this).
 *   - The relay's collection directory, for the list of every account that
 *     has published a labeler service record.
 *   - The public AppView (through the shared client), for who a labeler is
 *     and what its values mean.
 */

import { RELAY } from '@/utils/atproto/config';
import { getLabelerServices } from '@/utils/atproto/appview';
import { resolveHandle } from '@/utils/atproto/identity';
import { isValidDid } from '@/utils/atproto/spaceUri';
import {
  LABELER_COLLECTION,
  LABEL_APPVIEW,
  labelersHeader,
  readDefinitions,
  readLabels,
  type Label,
  type LabelDefinition,
  type LabelSubject,
} from './labels';

/** A handle or DID as typed, resolved to a DID. Null when it does not resolve. */
export async function resolveActor(actor: string): Promise<string | null> {
  if (actor.startsWith('did:')) return isValidDid(actor) ? actor : null;
  const did = await resolveHandle(actor);
  return did && isValidDid(did) ? did : null;
}

/** Who or what was checked, as the AppView describes it. */
export type SubjectView = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  /** A post's text, when the subject is a post. */
  text: string | null;
};

export type LabelAnswer = {
  labels: Label[];
  view: SubjectView;
};

type ProfileBody = {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  labels?: unknown;
};

type PostsBody = {
  posts?: { author?: ProfileBody; record?: { text?: unknown }; labels?: unknown }[];
};

/**
 * Raised when the AppView will not describe the subject at all: an account
 * it has no profile for, one that is suspended or deactivated, or a post
 * that is gone. `message` is the AppView's own wording.
 */
export class SubjectUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubjectUnavailable';
  }
}

async function appviewJson<T>(path: string, labelers: readonly string[], signal: AbortSignal): Promise<T> {
  const res = await fetch(`${LABEL_APPVIEW}/xrpc/${path}`, {
    signal,
    headers: { 'atproto-accept-labelers': labelersHeader(labelers) },
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new SubjectUnavailable(body?.message || 'The AppView has nothing for this.');
  }
  if (!res.ok) throw new Error(`The AppView answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

function viewFrom(profile: ProfileBody | undefined, did: string, text: string | null): SubjectView {
  return {
    did,
    handle: profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null,
    displayName: profile?.displayName?.trim() || null,
    avatar: profile?.avatar ?? null,
    text,
  };
}

/**
 * The subject's labels from one batch of labelers. One request does both
 * jobs: the view that carries the labels also says who or what this is.
 */
export async function fetchLabels(
  subject: LabelSubject,
  labelers: readonly string[],
  signal: AbortSignal,
): Promise<LabelAnswer> {
  if (subject.kind === 'account') {
    const profile = await appviewJson<ProfileBody>(
      `app.bsky.actor.getProfile?actor=${encodeURIComponent(subject.did)}`,
      labelers,
      signal,
    );
    return { labels: readLabels(profile.labels), view: viewFrom(profile, subject.did, null) };
  }
  const body = await appviewJson<PostsBody>(
    `app.bsky.feed.getPosts?uris=${encodeURIComponent(subject.uri)}`,
    labelers,
    signal,
  );
  const post = body.posts?.[0];
  if (!post) throw new SubjectUnavailable('The AppView has no such post. It may have been deleted.');
  const text = typeof post.record?.text === 'string' ? post.record.text : null;
  return { labels: readLabels(post.labels), view: viewFrom(post.author, subject.did, text) };
}

/** The relay's page size for the collection directory; it serves up to this many at once. */
const DIRECTORY_PAGE = 1000;
/** A backstop on paging, far above the few hundred labelers that exist. */
const DIRECTORY_MAX_PAGES = 20;

/**
 * Every account that has published a labeler service record, from the
 * relay's collection directory. This is the network's list of labelers: the
 * record is how one declares itself.
 */
export async function listLabelerDids(signal: AbortSignal): Promise<string[]> {
  const dids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < DIRECTORY_MAX_PAGES; page++) {
    const params = new URLSearchParams({ collection: LABELER_COLLECTION, limit: String(DIRECTORY_PAGE) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${RELAY}/xrpc/com.atproto.sync.listReposByCollection?${params}`, { signal });
    if (!res.ok) throw new Error(`The relay answered HTTP ${res.status}`);
    const body = (await res.json()) as { repos?: { did?: string }[]; cursor?: string };
    const repos = body.repos ?? [];
    for (const repo of repos) if (typeof repo.did === 'string') dids.push(repo.did);
    if (!body.cursor || repos.length === 0) break;
    cursor = body.cursor;
  }
  return dids;
}

/** Who a labeler is, and what its label values mean. */
export type LabelerInfo = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  definitions: LabelDefinition[];
};

/** `getServices` takes its DIDs in the query string, so they go a few at a time. */
const SERVICES_PER_REQUEST = 25;

/**
 * Service views for a set of DIDs. A DID with no view is absent from the
 * map: either it is not a labeler, or the AppView has not indexed it.
 */
export async function fetchLabelerInfo(
  dids: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, LabelerInfo>> {
  const out = new Map<string, LabelerInfo>();
  for (let i = 0; i < dids.length; i += SERVICES_PER_REQUEST) {
    const body = await getLabelerServices({ dids: dids.slice(i, i + SERVICES_PER_REQUEST), detailed: true, signal });
    for (const view of body?.views ?? []) {
      const creator = view.creator;
      if (!creator?.did) continue;
      out.set(creator.did, {
        did: creator.did,
        handle: creator.handle && creator.handle !== 'handle.invalid' ? creator.handle : null,
        displayName: creator.displayName?.trim() || null,
        avatar: creator.avatar ?? null,
        definitions: readDefinitions(view.policies?.labelValueDefinitions),
      });
    }
  }
  return out;
}
