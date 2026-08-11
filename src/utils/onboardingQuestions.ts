/**
 * The questions the guided setup asks, and how each answer becomes
 * `to.aturi.actor.preferredClients` rules.
 *
 * Two different groupings meet here:
 *
 *   - **Compat families** (`waypoints.data.ts`) group apps by the data they
 *     render. That's what makes a shortlist worth showing: every app in a
 *     family is a genuine alternative to the others, so a family with more
 *     than one member is a real question ("several apps open this — which do
 *     you want?"). A family with one member has nothing to choose.
 *   - **Scopes** (`preferredClients.ts`) are what a rule is written against:
 *     an NSID, a namespace wildcard, a record kind, or `*`.
 *
 * A question therefore pairs one family (where the options come from) with
 * the scopes its answer claims. The scopes are chosen so the three questions
 * never compete for the same record: Bluesky's rules are the most specific,
 * publications' next, and the explorer answer is `*` — the catch-all that
 * only decides records nothing more specific claimed.
 */

import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type RedirectCompatFamily,
} from './waypoints.data';
import { WAYPOINT_DESTINATIONS, type Waypoint } from './waypoints';
import { clientFromWaypointId, PREFERRED_SCOPE_ALL } from './preferredClients';
import {
  preferredClientRuleFor,
  setPreferredClients,
  type Preferences,
} from './preferences';

export type SetupQuestion = {
  /** Stable id — also the step's URL fragment, so links survive edits here. */
  id: string;
  /** Where the shortlist of options comes from. */
  family: RedirectCompatFamily;
  /** Scopes an answer writes a rule for. */
  scopes: string[];
  question: string;
  /** What this covers, in the second person. */
  blurb: string;
  /** Progress-rail label. Kept to one word where possible. */
  shortLabel: string;
};

/**
 * Catalog-ordered so a newly added client appears in the right question
 * without an edit here — `waypoints.data.ts` stays the single source of the
 * option list.
 */
const QUESTIONS: SetupQuestion[] = [
  {
    id: 'bluesky',
    family: 'bluesky-social',
    // `app.bsky.*` catches posts, lists, feeds and profile records; the bare
    // `profile` kind catches a shared handle with no collection attached,
    // which is the shape most "here's a person" links take.
    scopes: ['app.bsky.*', 'profile'],
    question: 'Where do you read Bluesky?',
    blurb:
      'Posts, profiles, lists and feeds are all app.bsky records, and every client here reads them. Shared links open bsky.app first today. Pick what you use and it goes first instead.',
    shortLabel: 'Bluesky',
  },
  {
    id: 'publications',
    family: 'standard-site',
    scopes: ['pub.leaflet.*', 'site.standard.*'],
    question: 'Where do you read publications?',
    blurb:
      'Longform writing lives in pub.leaflet and site.standard records. Every reader here opens all of them; they differ in typography, not in what they can render.',
    shortLabel: 'Publications',
  },
  {
    id: 'records',
    family: 'atproto-explorer',
    // The catch-all. Least specific of every scope, so this only decides
    // records the answers above didn't claim.
    scopes: [PREFERRED_SCOPE_ALL],
    question: 'Where do you inspect raw records?',
    blurb:
      'For when you want the JSON rather than a rendered page. This is also your fallback: anything the questions above missed opens here, including lexicons nobody has written a reader for yet.',
    shortLabel: 'Records',
  },
];

/**
 * Waypoints that are destinations in name only for this purpose. `aturi` is
 * the universal-link page itself — answering "open Bluesky posts in Aturi"
 * from inside Aturi points the picker back at the picker.
 */
const NOT_AN_ANSWER = new Set(['aturi']);

/** Built-in waypoints in a compat family, in catalog order. */
export function waypointsInFamily(family: RedirectCompatFamily): Waypoint[] {
  return WAYPOINT_ORDER.filter(
    (id) =>
      !NOT_AN_ANSWER.has(id) &&
      WAYPOINT_DESTINATIONS_DATA[id]?.redirectCompat.includes(family),
  )
    .map((id) => WAYPOINT_DESTINATIONS[id])
    .filter(Boolean);
}

/**
 * The questions worth asking right now: those whose family still has more
 * than one app in it. Guards against a question becoming a single-option
 * non-choice if the catalog ever loses members.
 */
export function setupQuestions(): (SetupQuestion & { options: Waypoint[] })[] {
  return QUESTIONS.map((q) => ({ ...q, options: waypointsInFamily(q.family) })).filter(
    (q) => q.options.length > 1,
  );
}

/**
 * The host a waypoint sends people to ("bsky.app", "leaflet.pub"), read off a
 * sample profile URL. Waypoints don't declare their domain — `getUrl` is the
 * only thing that knows it — so we build one throwaway link and keep the
 * hostname. It's the whole subtitle on an option row: the catalog's own
 * description ("View profile on bsky.app") only ever restated it.
 */
export function waypointDomain(waypoint: Waypoint): string | null {
  // Two probes, because some waypoints only build record-level URLs and
  // return null for a bare profile (Offprint, pckt). Either shape reveals the
  // host, so try the profile first and fall back to a record.
  const probes: Parameters<Waypoint['getUrl']>[] = [
    ['handle.example', undefined, undefined, 'did:plc:example'],
    ['handle.example', 'app.bsky.feed.post', '3example', 'did:plc:example'],
  ];
  for (const args of probes) {
    try {
      const url = waypoint.getUrl(...args);
      if (url) return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // A template that can't expand isn't a domain lookup failure; try the
      // next probe shape.
    }
  }
  return null;
}

/**
 * The catalog client currently answering a question, or null when the user
 * hasn't answered it. Read off the first scope: `applyAnswer` writes every
 * scope in lockstep, so they can only disagree if the rules were edited by
 * hand in the Clients tab — in which case the first scope is still the one
 * this question is really about.
 */
export function answerFor(prefs: Preferences, question: SetupQuestion): string | null {
  const rule = preferredClientRuleFor(prefs, question.scopes[0]);
  return rule?.clients[0]?.id ?? null;
}

/**
 * Record an answer: one rule per scope the question covers, or no rule at all
 * when the user picks "no preference" — an absent rule and a rule pointing
 * nowhere mean the same thing, and the honest encoding is absence.
 *
 * Only the first client is set, leaving any fallback chain the user built in
 * the Clients tab untouched below it.
 */
export function applyAnswer(
  prefs: Preferences,
  question: SetupQuestion,
  waypointId: string | null,
): Preferences {
  const client = waypointId ? clientFromWaypointId(waypointId) : null;
  return question.scopes.reduce((acc, scope) => {
    if (!client) return setPreferredClients(acc, scope, []);
    const existing = preferredClientRuleFor(acc, scope);
    const fallbacks = (existing?.clients ?? []).filter((c) => c.id !== client.id).slice(0, 9);
    return setPreferredClients(acc, scope, [client, ...fallbacks]);
  }, prefs);
}
