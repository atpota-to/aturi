/**
 * Everything that talks to the PDS and the AppView.
 *
 * Sessions are created per process with an app password rather than OAuth:
 * this is a single account whose credentials the operator holds, which is the
 * case app passwords exist for, and it keeps the deployment to two secrets.
 */

import { AtpAgent, AppBskyFeedPost, AppBskyFeedDefs } from '@atproto/api';
import type { Config } from './config.ts';
import type { PreparedPost } from './format.ts';

export type StrongRef = { uri: string; cid: string };

export type Mention = {
  uri: string;
  cid: string;
  authorDid: string;
  /**
   * Absent on the Jetstream path: a commit carries the author's DID but not
   * their handle, and resolving one for every event on the firehose would be
   * a request per stranger's post. Filled in by `resolveHandle` once a
   * mention has actually cleared the guards.
   */
  authorHandle?: string;
  text: string;
  indexedAt: string;
  /** The post the reply chain hangs off. Equals the mention for a top post. */
  root: StrongRef;
};

export async function login(config: Config): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: config.service });
  await agent.login({
    identifier: config.identifier,
    password: config.appPassword,
  });
  if (!agent.did) throw new Error('Login succeeded but no DID on the session');
  return agent;
}

const handles = new Map<string, string>();

/**
 * DID to handle, cached for the life of the process. Handles change, but not
 * within the seconds between reading a mention and answering it, and a stale
 * one costs a wrong name in a log line rather than a misdirected reply — the
 * reply is addressed by strongRef, not by handle.
 */
export async function resolveHandle(
  agent: AtpAgent,
  did: string,
): Promise<string> {
  const cached = handles.get(did);
  if (cached) return cached;
  try {
    const profile = await agent.app.bsky.actor.getProfile({ actor: did });
    handles.set(did, profile.data.handle);
    return profile.data.handle;
  } catch {
    return did;
  }
}

/**
 * Mentions and replies worth answering, newest last.
 *
 * `reasons` is filtered server-side, so likes and follows never enter the
 * page budget. The account's own posts are dropped explicitly: a reply the
 * agent writes into a thread it is part of comes back as a `reply`
 * notification, and without this the bot answers itself forever.
 */
export async function fetchMentions(
  agent: AtpAgent,
  config: Config,
): Promise<Mention[]> {
  const response = await agent.app.bsky.notification.listNotifications({
    reasons: ['mention', 'reply'],
    limit: 50,
  });

  const cutoff = Date.now() - config.lookbackMinutes * 60_000;
  const mentions: Mention[] = [];

  for (const notification of response.data.notifications) {
    if (notification.author.did === agent.did) continue;
    if (new Date(notification.indexedAt).getTime() < cutoff) continue;

    // `record` is typed as unknown on the wire, and the lexicon validator is
    // the only thing that turns it into a post rather than a cast that lies.
    const validated = AppBskyFeedPost.validateRecord(notification.record);
    if (!validated.success) continue;
    const record = validated.value;

    const self: StrongRef = { uri: notification.uri, cid: notification.cid };
    mentions.push({
      ...self,
      authorDid: notification.author.did,
      authorHandle: notification.author.handle,
      text: record.text,
      indexedAt: notification.indexedAt,
      root: record.reply?.root
        ? { uri: record.reply.root.uri, cid: record.reply.root.cid }
        : self,
    });
  }

  return mentions.reverse();
}

/**
 * A page cap on the dedupe walk, so a pathological repo cannot turn one pass
 * into an unbounded crawl. Ten pages is a thousand posts; a deployment that
 * needs more than that within its lookback window should shorten the window
 * rather than raise this.
 */
const MAX_DEDUPE_PAGES = 10;

/**
 * The posts this account has already replied to, covering at least as far
 * back as the lookback window.
 *
 * Deliberately derived from the repo rather than from a database: the agent's
 * own replies *are* the record of what it has answered, so a redeploy, a lost
 * volume, or a second instance cannot cause a double answer.
 *
 * It has to page. listRecords returns newest first, and a single page of 100
 * is only about seven saturated passes — under load a mention could age out
 * of one page while still being inside the lookback window, and get answered
 * twice. Reading until the records predate the window closes that gap; in
 * the ordinary case the first page already does.
 */
export async function repliedParents(
  agent: AtpAgent,
  config: Config,
): Promise<Set<string>> {
  const cutoff = Date.now() - config.lookbackMinutes * 60_000;
  const parents = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_DEDUPE_PAGES; page += 1) {
    const response = await agent.com.atproto.repo.listRecords({
      repo: agent.did!,
      collection: 'app.bsky.feed.post',
      limit: 100,
      cursor,
    });

    let reachedCutoff = false;
    for (const item of response.data.records) {
      const validated = AppBskyFeedPost.validateRecord(item.value);
      if (!validated.success) continue;
      if (validated.value.reply) {
        parents.add(validated.value.reply.parent.uri);
      }
      if (new Date(validated.value.createdAt).getTime() < cutoff) {
        reachedCutoff = true;
      }
    }

    cursor = response.data.cursor;
    if (reachedCutoff || !cursor || response.data.records.length === 0) break;
  }

  return parents;
}

/**
 * The ancestors of a mention, oldest first, so the model can read the
 * conversation it is being pulled into rather than a bare sentence.
 */
export async function threadContext(
  agent: AtpAgent,
  uri: string,
): Promise<{ handle: string; text: string }[]> {
  const response = await agent.app.bsky.feed.getPostThread({
    uri,
    depth: 0,
    parentHeight: 5,
  });

  const context: { handle: string; text: string }[] = [];
  // Typed as unknown rather than the parent union: the validator's return
  // type is derived from its argument, and feeding it its own output back
  // makes the inference circular.
  let node: unknown = response.data.thread;

  // The requested post is the first node, so skip it and walk up from there.
  let first = true;
  while (node) {
    const view = AppBskyFeedDefs.validateThreadViewPost(node);
    if (!view.success) break;
    if (!first) {
      const record = AppBskyFeedPost.validateRecord(view.value.post.record);
      if (record.success) {
        context.unshift({
          handle: view.value.post.author.handle,
          text: record.value.text,
        });
      }
    }
    first = false;
    node = view.value.parent;
  }
  return context;
}

/**
 * Post an answer as a reply, chaining any continuation posts onto the one
 * before so the whole answer reads as a single thread.
 *
 * The facets are the ones format.ts built and nothing else. Notably this does
 * *not* call RichText.detectFacets: that would re-derive facets from the
 * text, which would put back the mention facets the format layer exists to
 * keep out, and would resolve handles over the network while doing it.
 */
export async function postReply(
  agent: AtpAgent,
  posts: PreparedPost[],
  mention: Mention,
): Promise<StrongRef[]> {
  const written: StrongRef[] = [];
  let parent: StrongRef = { uri: mention.uri, cid: mention.cid };

  for (const post of posts) {
    const result = await agent.post({
      text: post.text,
      facets: post.facets.length > 0 ? post.facets : undefined,
      langs: ['en'],
      reply: { root: mention.root, parent },
      createdAt: new Date().toISOString(),
    });
    written.push(result);
    parent = result;
  }

  return written;
}

