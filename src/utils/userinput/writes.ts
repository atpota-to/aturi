/**
 * Write layer for the feedback board.
 *
 * Every write lands in the *signed-in user's own repo* — aturi.to never holds
 * anyone's content. Posting feedback writes an `app.userinput.discussion` to
 * your repo that points at the space; voting writes a vote to your repo that
 * points at the discussion. Deleting your record retracts the action network-
 * wide, because the count was only ever a sum over records like it.
 *
 * The one structural rule worth stating: **votes are keyed by their subject.**
 * `app.userinput.upvote` and `app.userinput.downvote` are declared `key: any`
 * and specified to be written at the same record key as the thing they vote
 * on, which is what makes "one vote per person per subject" true without a
 * server enforcing it. `setVote` relies on that — it can address your existing
 * vote on any subject without looking it up first.
 */

import type { Agent } from '@atproto/api';
import { rkeyFromAtUri } from '@/utils/atproto/urls';
import {
  UI_NSID,
  type DiscussionImage,
  type DiscussionRecord,
  type EditRecord,
  type HideRecord,
  type LockRecord,
  type PinRecord,
  type ReplyRecord,
  type SpaceRecord,
  type SpaceTag,
  type StatusRecord,
  type StrongRef,
  type UiState,
  type VoteRecord,
} from './lexicons';

function now(): string {
  return new Date().toISOString();
}

type WriteAgent = Pick<Agent, 'com'> & { assertDid: string };

function repoOf(agent: WriteAgent): string {
  return agent.assertDid;
}

/* ------------------------------------------------------------------ space */

/**
 * Create the board's space. Only meaningful for the account configured as the
 * board owner — a space in anyone else's repo is a different board.
 */
export async function createSpace(
  agent: WriteAgent,
  input: { name: string; description?: string; tags?: SpaceTag[] },
): Promise<StrongRef> {
  const record: SpaceRecord = {
    $type: UI_NSID.space,
    name: input.name.trim(),
    createdAt: now(),
  };
  const description = input.description?.trim();
  if (description) record.description = description;
  if (input.tags?.length) record.tags = input.tags;

  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.space,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/* ------------------------------------------------------------- discussion */

export async function createDiscussion(
  agent: WriteAgent,
  input: {
    space: StrongRef;
    title: string;
    body?: string;
    tags?: string[];
    images?: DiscussionImage[];
  },
): Promise<StrongRef> {
  const record: DiscussionRecord = {
    $type: UI_NSID.discussion,
    space: input.space,
    title: input.title.trim(),
    createdAt: now(),
  };
  const body = input.body?.trim();
  if (body) record.body = body;
  if (input.tags?.length) record.tags = input.tags;
  if (input.images?.length) record.images = input.images;

  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.discussion,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createReply(
  agent: WriteAgent,
  input: { subject: StrongRef; parent?: StrongRef; body: string },
): Promise<StrongRef> {
  const record: ReplyRecord = {
    $type: UI_NSID.reply,
    subject: input.subject,
    body: input.body.trim(),
    createdAt: now(),
  };
  if (input.parent) record.parent = input.parent;

  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.reply,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/**
 * Revise your own discussion or reply. Nothing is mutated: the edit is a new
 * sidecar record pointing at the original, and readers take the newest one
 * from the original author as the live content.
 */
export async function createEdit(
  agent: WriteAgent,
  input: { subject: StrongRef; title?: string; body?: string; tags?: string[] },
): Promise<StrongRef> {
  const record: EditRecord = {
    $type: UI_NSID.edit,
    subject: input.subject,
    createdAt: now(),
  };
  if (input.title !== undefined) record.title = input.title.trim();
  if (input.body !== undefined) record.body = input.body.trim();
  if (input.tags !== undefined) record.tags = input.tags;

  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.edit,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/** Delete one of your own records, addressed by its AT URI. */
export async function deleteOwnRecord(agent: WriteAgent, uri: string): Promise<void> {
  const rkey = rkeyFromAtUri(uri);
  const collection = uri.split('/')[3];
  if (!rkey || !collection) throw new Error(`Not a record URI: ${uri}`);
  await agent.com.atproto.repo.deleteRecord({
    repo: repoOf(agent),
    collection,
    rkey,
  });
}

/* ------------------------------------------------------------------ votes */

export type VoteDirection = 'up' | 'down' | null;

/**
 * Put the viewer's vote on `subject` into `next`, doing the minimum number of
 * writes to get there.
 *
 * Both vote collections are keyed by the subject's rkey, so switching sides is
 * a delete plus a create at a known address, and clearing a vote is a single
 * delete — no read pass to find the record first. Deletes are tolerant of a
 * missing record because the viewer's cached state can lag the repo (another
 * tab, or a vote retracted elsewhere).
 */
export async function setVote(
  agent: WriteAgent,
  input: { subject: StrongRef; current: VoteDirection; next: VoteDirection },
): Promise<void> {
  const { subject, current, next } = input;
  if (current === next) return;

  const rkey = rkeyFromAtUri(subject.uri);
  if (!rkey) throw new Error(`Not a record URI: ${subject.uri}`);
  const repo = repoOf(agent);
  const collectionFor = (d: Exclude<VoteDirection, null>) =>
    d === 'up' ? UI_NSID.upvote : UI_NSID.downvote;

  if (current) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo,
        collection: collectionFor(current),
        rkey,
      });
    } catch {
      // Already gone — the desired end state is unchanged either way.
    }
  }

  if (next) {
    const record: VoteRecord = {
      $type: collectionFor(next),
      subject,
      createdAt: now(),
    };
    await agent.com.atproto.repo.putRecord({
      repo,
      collection: collectionFor(next),
      rkey,
      record,
    });
  }
}

/* ------------------------------------------------------------- moderation */

/**
 * Assign an official status. Readers honor this only when the author is the
 * space owner or a member the owner appointed, and take the newest one — so
 * changing a status is another create, not an update.
 */
export async function setStatus(
  agent: WriteAgent,
  input: { subject: StrongRef; state: UiState; note?: string; duplicateOf?: StrongRef },
): Promise<StrongRef> {
  const record: StatusRecord = {
    $type: UI_NSID.status,
    subject: input.subject,
    state: input.state,
    createdAt: now(),
  };
  const note = input.note?.trim();
  if (note) record.note = note;
  if (input.state === 'duplicate' && input.duplicateOf) {
    record.duplicateOf = input.duplicateOf;
  }

  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.status,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createPin(
  agent: WriteAgent,
  input: { space: StrongRef; subject: StrongRef },
): Promise<StrongRef> {
  const record: PinRecord = {
    $type: UI_NSID.pin,
    space: input.space,
    subject: input.subject,
    createdAt: now(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.pin,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createHide(
  agent: WriteAgent,
  input: { space: StrongRef; subject: StrongRef },
): Promise<StrongRef> {
  const record: HideRecord = {
    $type: UI_NSID.hide,
    space: input.space,
    subject: input.subject,
    createdAt: now(),
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.hide,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/**
 * Close a thread to new replies as of now. `lockedAt` is a cutoff rather than
 * a flag: replies already posted stay visible, later ones don't.
 */
export async function createLock(
  agent: WriteAgent,
  input: { subject: StrongRef },
): Promise<StrongRef> {
  const stamp = now();
  const record: LockRecord = {
    $type: UI_NSID.lock,
    subject: input.subject,
    lockedAt: stamp,
    createdAt: stamp,
  };
  const res = await agent.com.atproto.repo.createRecord({
    repo: repoOf(agent),
    collection: UI_NSID.lock,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/* ------------------------------------------------------------------ blobs */

/** Upload an image and return the blob ref a discussion can embed. */
export async function uploadImage(
  agent: WriteAgent,
  file: Blob,
): Promise<DiscussionImage['image']> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await agent.com.atproto.repo.uploadBlob(bytes, {
    encoding: file.type || 'application/octet-stream',
  });
  return res.data.blob as unknown as DiscussionImage['image'];
}
