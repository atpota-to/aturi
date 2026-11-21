/**
 * The account card's two check rows, Labels and Visibility, in words.
 *
 * The label checker and the shadowban checker each answer in a page of
 * detail. The Explorer shows an account's answer in a line on its card and a
 * badge in the rail, and these functions decide what that line says. They
 * read the same results the tools draw, so the card and the tool can never
 * disagree; nothing here asks anything of the network.
 */

import { BLUESKY_MODERATION_DID, isExpired, type Label } from './labels';
import {
  buildAccountChecks,
  readProfileFailure,
  shadowbanVerdict,
  type CheckStatus,
  type Evidence,
  type ShadowbanCheck,
} from './shadowban';

/* -------------------------------------------------------------------------- *
 * When Bluesky has no profile
 * -------------------------------------------------------------------------- */

export type ProfileAbsence = 'missing' | 'suspended' | 'deactivated';

/**
 * Why Bluesky's AppView would not describe an account, from the words it
 * answered with (the label checker's `SubjectUnavailable`). "Profile not
 * found" is an account it never indexed: one that has not used Bluesky.
 */
export function profileAbsence(message: string): ProfileAbsence {
  const state = readProfileFailure(400, null, message).state;
  return state === 'suspended' || state === 'deactivated' ? state : 'missing';
}

/**
 * Whether the visibility check has anything to compare. An account with no
 * Bluesky profile, or one that deactivated it, has nothing for an AppView to
 * hide; a suspended one does, and the check says so.
 */
export function visibilityApplies(absence: ProfileAbsence | null): boolean {
  return absence === null || absence === 'suspended';
}

/* -------------------------------------------------------------------------- *
 * Labels
 * -------------------------------------------------------------------------- */

export type LabelSummary = {
  /** Labels in force: not withdrawn, not expired. */
  active: number;
  /** Distinct accounts behind those labels, the subject included. */
  sources: number;
  /** Some of them the account put on itself. */
  selfLabelled: boolean;
  /** Values in force from Bluesky's own moderation service, newest first. */
  moderation: string[];
};

export function labelSummary(labels: readonly Label[], subjectDid: string, now: number): LabelSummary {
  const live = labels.filter((label) => !label.neg && !isExpired(label, now));
  const sources = new Set(live.map((label) => label.src));
  const moderation = live
    .filter((label) => label.src === BLUESKY_MODERATION_DID)
    .sort((a, b) => (b.cts ?? '').localeCompare(a.cts ?? ''))
    .map((label) => label.val);
  return {
    active: live.length,
    sources: sources.size,
    selfLabelled: sources.has(subjectDid),
    moderation: [...new Set(moderation)],
  };
}

/**
 * Where a count of labels comes from, as the card's row says it: "from 10
 * labelers", "from 3 sources" when the account labelled itself too, and
 * "set by the account" when only it did.
 */
export function labelSourceWords(summary: LabelSummary): string {
  if (summary.active === 0) return '';
  if (summary.selfLabelled && summary.sources === 1) return 'set by the account';
  const noun = summary.selfLabelled ? 'source' : 'labeler';
  return `from ${summary.sources} ${noun}${summary.sources === 1 ? '' : 's'}`;
}

/* -------------------------------------------------------------------------- *
 * Visibility
 * -------------------------------------------------------------------------- */

/** One of the six dots: a check still running, or how it came out. */
export type DotState = 'run' | 'pass' | 'warn' | 'fail' | 'skip';

export type VisibilityDot = {
  id: ShadowbanCheck['id'];
  title: string;
  state: DotState;
  summary: string;
};

export type VisibilityTone = 'pending' | 'pass' | 'info' | 'warn' | 'fail';

export type VisibilitySummary = {
  /** The account checks, in the checker's order. */
  dots: VisibilityDot[];
  /** How many of them have come back. */
  done: number;
  tone: VisibilityTone;
  /** A few words for the card: "Nothing hidden", "Left out of search". */
  short: string;
  /** Further findings beyond the one `short` names. */
  more: number;
  /** The checker's own verdict, for a tooltip or a view's heading. */
  title: string;
  text: string;
};

const DOT_OF: Record<CheckStatus, DotState> = {
  pending: 'run',
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
  // "Nothing to look at" (no recent replies, a deactivated profile) and
  // "could not ask" both leave the dot grey.
  info: 'skip',
  skip: 'skip',
};

/** What a failed check found, in a few words. */
const FAIL_WORDS: Partial<Record<ShadowbanCheck['id'], string>> = {
  pds: 'Problem on its PDS',
  profile: 'Profile hidden',
  posts: 'Posts missing',
  threads: 'Replies missing',
  actorSearch: 'Left out of search',
  postSearch: 'Posts not in search',
};

/** What a warning is about, in a few words. */
const WARN_WORDS: Partial<Record<ShadowbanCheck['id'], string>> = {
  pds: 'Not active on its PDS',
  posts: 'Posts not compared',
  threads: 'Replies not checked',
  actorSearch: 'Not found in search',
  postSearch: 'Some posts not in search',
};

/**
 * The visibility check of an account so far, for its row and badge. Reads
 * the same checks and verdict the shadowban checker draws.
 */
export function visibilitySummary(evidence: Evidence, now: number): VisibilitySummary {
  const checks = buildAccountChecks(evidence, now);
  const verdict = shadowbanVerdict(evidence, checks);
  const dots = checks.map((check) => ({
    id: check.id,
    title: check.title,
    state: DOT_OF[check.status],
    summary: check.summary,
  }));
  const done = dots.filter((dot) => dot.state !== 'run').length;
  const base = { dots, done, title: verdict.title, text: verdict.text };

  if (verdict.tone === 'pending') {
    return { ...base, tone: 'pending', short: done === 0 ? 'Reading the PDS' : `${done} of ${dots.length} checks`, more: 0 };
  }

  const profile = evidence.profile;
  if (profile?.state === 'suspended') return { ...base, tone: 'fail', short: 'Suspended', more: 0 };
  if (profile?.state === 'missing') return { ...base, tone: 'fail', short: 'No profile on Bluesky', more: 0 };
  if (profile?.state === 'deactivated') return { ...base, tone: 'info', short: 'Deactivated', more: 0 };
  if (verdict.tone === 'warn' && evidence.repo?.state === 'inactive') {
    return { ...base, tone: 'warn', short: 'Not active on its PDS', more: 0 };
  }
  if (profile?.state === 'error' && (!evidence.shown || !evidence.shown.ok)) {
    return { ...base, tone: 'warn', short: `${evidence.appview.name} didn’t answer`, more: 0 };
  }

  const failed = checks.filter((check) => check.status === 'fail');
  if (failed.length > 0) {
    return { ...base, tone: 'fail', short: FAIL_WORDS[failed[0].id] ?? 'Something hidden', more: failed.length - 1 };
  }
  const warned = checks.filter((check) => check.status === 'warn');
  if (warned.length > 0) {
    const first = warned[0];
    const short =
      first.id === 'profile'
        ? profile?.state === 'found'
          ? `Labelled by ${evidence.appview.name}`
          : `${evidence.appview.name} didn’t answer`
        : (WARN_WORDS[first.id] ?? 'Worth a look');
    return { ...base, tone: 'warn', short, more: warned.length - 1 };
  }
  return { ...base, tone: 'pass', short: 'Nothing hidden', more: 0 };
}
