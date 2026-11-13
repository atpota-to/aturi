/**
 * The tools that have something to say about a given record or account, for
 * the explorer to offer where that record or account is already open.
 *
 * Kept beside the catalog so the query parameter each tool reads is written
 * down in one place: a tool that renames its parameter breaks the test here,
 * not a link three components away.
 */

import { toolHref } from './catalog';

export type ToolLink = {
  /** The tool's slug, for its icon and title from the catalog. */
  slug: string;
  /** What the link says. */
  label: string;
  href: string;
  /** A sentence for the tooltip. */
  title: string;
};

function link(slug: string, param: string, value: string, label: string, title: string): ToolLink {
  return { slug, label, title, href: `${toolHref(slug)}?${param}=${encodeURIComponent(value)}` };
}

/** Tools worth opening for one record, by its collection. Empty for most. */
export function toolLinksForRecord(collection: string, atUri: string, rkey: string): ToolLink[] {
  switch (collection) {
    case 'app.bsky.feed.post':
      return [link('post', 'post', atUri, 'Inspect post', 'Facets by byte range, reply rules, labels and timestamps')];
    case 'app.bsky.feed.generator':
      return [link('feed', 'feed', atUri, 'Inspect feed', 'Who runs this feed, whether its generator answers, and what it returns')];
    case 'com.atproto.lexicon.schema':
      // A schema record's key is the NSID it defines.
      return [link('lexicon', 'nsid', rkey, 'Check publishing', 'Follow this lexicon from its DNS record to this schema record')];
    default:
      return [];
  }
}

/** Tools that read a whole account, for its overview. */
export function toolLinksForAccount(did: string): ToolLink[] {
  return [
    link('activity', 'actor', did, 'Activity calendar', 'A year of this account’s writes across every app'),
    link('memberships', 'account', did, 'Lists and verifications', 'Lists this account is on, and who has verified it'),
    link('labels', 'subject', did, 'Labels', 'Labels on this account, from every labeler'),
    link('shadowban', 'subject', did, 'Shadowban check', 'Whether Bluesky’s AppView quietly leaves this account out'),
    link('car', 'actor', did, 'Repo archive', 'Browse this account’s repository export'),
  ];
}
