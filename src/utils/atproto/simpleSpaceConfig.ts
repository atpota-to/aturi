/**
 * The editable shape of a simplespace's two rules, and the copy for the ways a
 * host refuses to change them. Pure — no React, no network — which is why it
 * lives here rather than beside the forms that use it: `spaceClient.ts` states
 * what the two config unions are on the wire, and this states what they are
 * while somebody is editing them.
 *
 * A space's configuration is two open unions on the wire and two dropdowns on
 * screen, and the gap between those is the whole reason this module exists:
 *
 *   - **An unknown variant must survive being looked at.** Both unions are open,
 *     so an authority may run a policy this build has never heard of. Reading
 *     one and rendering the nearest familiar option would let a form that was
 *     only opened to change the *other* rule quietly rewrite it — `updateSpace`
 *     replaces a supplied rule wholesale, so a wrong dropdown value is a
 *     silently applied policy change. `unknown` is therefore a first-class
 *     variant here, and a form holding one is expected to refuse to submit it.
 *   - **A variant with a payload is invalid until it has one.** The two that
 *     carry data — a managing app's service id, an allow list's client ids —
 *     are chosen from a dropdown before they are filled in, so the draft passes
 *     through a state the lexicon would reject. Converting to the wire type is
 *     where that is caught.
 */

import { isValidDid } from './spaceUri';
import {
  SIMPLESPACE_APP_ACCESS,
  SIMPLESPACE_POLICY,
  spaceErrorCode,
  spaceErrorMessage,
  type SimpleSpaceAppAccessInput,
  type SimpleSpaceConfig,
  type SimpleSpacePolicyInput,
} from './spaceClient';

/* ------------------------------------------------------------------ drafts */

/** Who the authority will mint a space credential for. */
export type PolicyDraft =
  | { kind: 'public' }
  | { kind: 'memberList' }
  | { kind: 'managingApp'; managingApp: string }
  | { kind: 'unknown'; type: string };

/** Which applications may present one. */
export type AppAccessDraft =
  | { kind: 'open' }
  | { kind: 'allowList'; allowed: string[] }
  | { kind: 'unknown'; type: string };

/**
 * What a new space starts as. The member list is the default because it is the
 * only one of the three that is both enforceable by the host alone and closed:
 * `public` puts the space in reach of anyone who finds the address, and
 * `managingApp` needs a service that answers `checkUserAccess` to exist first.
 */
export const DEFAULT_POLICY_DRAFT: PolicyDraft = { kind: 'memberList' };
export const DEFAULT_APP_ACCESS_DRAFT: AppAccessDraft = { kind: 'open' };

export function policyDraftFromConfig(policy: SimpleSpaceConfig['policy']): PolicyDraft {
  switch (policy?.$type) {
    case SIMPLESPACE_POLICY.public:
      return { kind: 'public' };
    case SIMPLESPACE_POLICY.memberList:
      return { kind: 'memberList' };
    case SIMPLESPACE_POLICY.managingApp:
      return { kind: 'managingApp', managingApp: policy.managingApp ?? '' };
    default:
      return { kind: 'unknown', type: policy?.$type ?? '' };
  }
}

export function appAccessDraftFromConfig(
  appAccess: SimpleSpaceConfig['appAccess'],
): AppAccessDraft {
  switch (appAccess?.$type) {
    case SIMPLESPACE_APP_ACCESS.open:
      return { kind: 'open' };
    case SIMPLESPACE_APP_ACCESS.allowList:
      return { kind: 'allowList', allowed: appAccess.allowed ?? [] };
    default:
      return { kind: 'unknown', type: appAccess?.$type ?? '' };
  }
}

/**
 * A managing app is "a DID with an optional service fragment", e.g.
 * `did:web:example.com#forum`. Only the DID half is checked: the fragment names
 * a service entry in that DID's document, which is the authority's business to
 * resolve and not something this app can validate from here.
 */
export function isValidManagingApp(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const hash = trimmed.indexOf('#');
  const did = hash === -1 ? trimmed : trimmed.slice(0, hash);
  // A trailing `#` names no service, so it is a typo rather than "no fragment".
  if (hash !== -1 && trimmed.length === hash + 1) return false;
  return isValidDid(did);
}

/**
 * Client ids one per line. Split on newlines rather than commas because an
 * OAuth client id is a URL, and a URL may legitimately contain a comma.
 */
export function parseAllowList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatAllowList(allowed: string[]): string {
  return allowed.join('\n');
}

/** The wire union, or null when the draft is one the lexicon would reject. */
export function policyDraftToInput(draft: PolicyDraft): SimpleSpacePolicyInput | null {
  switch (draft.kind) {
    case 'public':
      return { $type: SIMPLESPACE_POLICY.public };
    case 'memberList':
      return { $type: SIMPLESPACE_POLICY.memberList };
    case 'managingApp':
      return isValidManagingApp(draft.managingApp)
        ? { $type: SIMPLESPACE_POLICY.managingApp, managingApp: draft.managingApp.trim() }
        : null;
    default:
      return null;
  }
}

export function appAccessDraftToInput(
  draft: AppAccessDraft,
): SimpleSpaceAppAccessInput | null {
  switch (draft.kind) {
    case 'open':
      return { $type: SIMPLESPACE_APP_ACCESS.open };
    case 'allowList':
      return draft.allowed.length > 0
        ? { $type: SIMPLESPACE_APP_ACCESS.allowList, allowed: draft.allowed }
        : null;
    default:
      return null;
  }
}

/**
 * Whether a draft still says what the space already says.
 *
 * `updateSpace` replaces a supplied rule wholesale, so the manage form sends
 * only the halves that changed. That is not merely economical: an unknown
 * variant can be left alone precisely because it is never sent, which is what
 * lets someone change their app access without their unrecognised policy being
 * rewritten into one of the three this build knows.
 */
export function policyDraftEquals(a: PolicyDraft, b: PolicyDraft): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'managingApp' && b.kind === 'managingApp') {
    return a.managingApp.trim() === b.managingApp.trim();
  }
  if (a.kind === 'unknown' && b.kind === 'unknown') return a.type === b.type;
  return true;
}

export function appAccessDraftEquals(a: AppAccessDraft, b: AppAccessDraft): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'allowList' && b.kind === 'allowList') {
    return a.allowed.length === b.allowed.length && a.allowed.every((v, i) => v === b.allowed[i]);
  }
  if (a.kind === 'unknown' && b.kind === 'unknown') return a.type === b.type;
  return true;
}

/* ------------------------------------------------------------------ errors */

/**
 * Plain text for an administrative refusal.
 *
 * These are separate from `classifySpaceError`, which reduces the *read* errors
 * to the cases a reader distinguishes. An administrator's failures are a
 * different set with different remedies — a key that is taken, a policy the
 * host won't store — and collapsing them into "couldn't read this" would tell
 * someone their own space is unreachable when what actually happened is that
 * they picked a name twice.
 *
 * `NotSpaceOwner` is included for completeness rather than because a UI should
 * be able to reach it: every affordance behind these methods is shown only to
 * the authority. Seeing it means the address and the session disagree, which is
 * worth saying rather than swallowing.
 */
export function describeSpaceManageError(err: unknown): string {
  switch (spaceErrorCode(err)) {
    case 'SpaceAlreadyExists':
      return 'You already have a space with this type and key. Pick a different key, or leave it blank to have your server generate one.';
    case 'SpaceNotFound':
      return 'This space host has no simplespace configuration at this address. Writing to a space address creates the data without creating a space to govern it.';
    case 'NotSpaceOwner':
      return 'Only the account a space is anchored on can administer it, and this session is signed in as somebody else.';
    case 'UnsupportedPolicy':
      return 'This server does not implement that access rule, so it refused to store it rather than keep a rule it cannot enforce.';
    case 'UnsupportedAppAccess':
      return 'This server does not implement that application-access rule, so it refused to store it rather than keep a rule it cannot enforce.';
    case 'InvalidRequest':
      // Reached by a space key that is syntactically fine here and not at the
      // host, so the host's own message is the whole of the useful half.
      return spaceErrorMessage(err) ?? 'This server rejected the request.';
    default:
      return spaceErrorMessage(err) ?? String(err);
  }
}
