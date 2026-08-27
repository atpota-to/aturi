/**
 * The queue that turns mentions into replies.
 *
 * Serial on purpose. Jetstream delivers in bursts — a thread where several
 * people tag the account at once arrives as several events in the same
 * second — and answering them in parallel would mean several concurrent model
 * calls, several concurrent tool fan-outs, and a rate limiter that only finds
 * out afterwards. One at a time keeps the caps meaningful and the ordering
 * readable.
 */

import type { AtpAgent } from '@atproto/api';
import type { Config } from './config.ts';
import type { Mention } from './bluesky.ts';
import { postReply, repliedParents, resolveHandle, threadContext } from './bluesky.ts';
import { composeAnswer, systemPrompt } from './answer.ts';
import { preparePosts } from './format.ts';
import { SlidingWindow, leaksInstructions, screenAuthor } from './guards.ts';

export type Processor = {
  submit: (mention: Mention) => void;
  /** Re-read the repo so the answered set reflects anything this process missed. */
  refreshAnswered: () => Promise<void>;
  idle: () => Promise<void>;
};

export function createProcessor(
  agent: AtpAgent,
  config: Config,
  botHandle: string,
): Processor {
  /**
   * Seeded from the repo and added to as replies land. The repo is the
   * durable record — this is the fast path in front of it, so a burst of
   * events does not become a burst of listRecords calls. It assumes one
   * instance; two agents on one account would each hold their own copy and
   * could both answer the same mention.
   */
  const answered = new Set<string>();
  const perAuthor = new SlidingWindow();
  const global = new SlidingWindow();

  const queue: Mention[] = [];
  let running: Promise<void> = Promise.resolve();
  let draining = false;

  async function handle(mention: Mention): Promise<void> {
    if (answered.has(mention.uri)) return;

    const handleName =
      mention.authorHandle ?? (await resolveHandle(agent, mention.authorDid));
    const author = { did: mention.authorDid, handle: handleName };

    const screened = screenAuthor(config, author);
    if (!screened.ok) {
      console.log(`[skip] @${handleName}: ${screened.reason}`);
      return;
    }
    if (!perAuthor.take(author.did, config.maxRepliesPerAuthorPerHour)) {
      console.warn(`[limit] @${handleName} is over the per-account hourly cap`);
      return;
    }
    if (!global.take('all', config.maxRepliesPerHour)) {
      console.warn('[limit] account is over its hourly reply cap');
      return;
    }

    const context = await threadContext(agent, mention.uri);
    const answer = await composeAnswer(
      config,
      botHandle,
      mention,
      handleName,
      context,
    );

    if (!answer.text) {
      console.warn(
        `[skip] ${mention.uri} produced no text (finish: ${answer.finishReason})`,
      );
      return;
    }
    if (leaksInstructions(answer.text, systemPrompt(config, botHandle))) {
      // Not a reply worth arguing with: the prompt already refuses, so this
      // firing means the refusal did not hold. Drop it and leave a trail.
      console.error(`[blocked] ${mention.uri}: reply quoted the instructions`);
      return;
    }

    const posts = preparePosts(answer.text, config.maxPostsPerReply);
    if (posts.length === 0) return;

    if (config.dryRun) {
      console.log(
        `[dry-run] @${handleName} via [${answer.toolsUsed.join(', ')}]:\n` +
          posts
            .map((p, i) => `  ${i + 1}. ${p.text}  (${p.facets.length} link facets)`)
            .join('\n'),
      );
      answered.add(mention.uri);
      return;
    }

    const written = await postReply(agent, posts, mention);
    answered.add(mention.uri);
    console.log(
      `[reply] @${handleName} -> ${written.length} post(s), tools: [${answer.toolsUsed.join(', ')}]`,
    );
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const mention = queue.shift();
        if (!mention) break;
        try {
          await handle(mention);
        } catch (error) {
          // One bad mention must not stop the queue. Nothing was written for
          // it, so the next reconcile sweep will offer it again.
          console.error(`[error] ${mention.uri}:`, error);
        }
      }
    } finally {
      draining = false;
      perAuthor.prune();
      global.prune();
    }
  }

  return {
    submit(mention) {
      if (answered.has(mention.uri)) return;
      if (queue.some((queued) => queued.uri === mention.uri)) return;
      queue.push(mention);
      running = running.then(drain).catch((error) => {
        console.error('[queue] drain failed:', error);
      });
    },
    async refreshAnswered() {
      for (const uri of await repliedParents(agent, config)) answered.add(uri);
    },
    idle() {
      return running;
    },
  };
}
