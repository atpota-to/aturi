/**
 * Which feedback space aturi.to's board renders.
 *
 * There is no registry to look a space up in — a space is just a record in
 * somebody's repo — so the board needs to be told which one is *ours*. Two
 * ways to say it, in priority order:
 *
 *   NEXT_PUBLIC_FEEDBACK_SPACE_URI — an exact `at://…/app.userinput.space/…`
 *     URI. Fastest path: one record fetch, no identity resolution, and it
 *     pins the board to a specific space even if the owner later creates
 *     more.
 *
 *   NEXT_PUBLIC_FEEDBACK_OWNER — a handle or DID whose repo is scanned for
 *     `app.userinput.space` records; the earliest-created one wins. This is
 *     the default path, and it's what makes the in-app setup panel work
 *     without a redeploy: the owner creates the space from /feedback and the
 *     board finds it on the next load.
 *
 * Both are `NEXT_PUBLIC_` because the board reads Constellation and Slingshot
 * straight from the browser — there's no server hop to hide them behind, and
 * neither value is a secret (both are public records on the network).
 */

const DEFAULT_OWNER = 'aturi.to';

/**
 * aturi.to's own board, pinned so the common case is a single cached record
 * fetch. `resolveSpace` still falls back to discovery if this record ever goes
 * away, so a deleted-and-recreated space doesn't take the page down with it.
 */
const DEFAULT_SPACE_URI =
  'at://did:plc:6teuhlkizzebk6wdp42633el/app.userinput.space/3msquvq7ps72p';

/** Handle or DID whose repo owns the board's space. */
export const FEEDBACK_OWNER =
  process.env.NEXT_PUBLIC_FEEDBACK_OWNER?.trim() || DEFAULT_OWNER;

/**
 * Exact space AT URI, when pinned. Empty means "discover from the owner".
 *
 * The built-in default only applies while the owner is also the built-in
 * default: a fork that points `NEXT_PUBLIC_FEEDBACK_OWNER` at its own account
 * must not silently keep rendering aturi.to's board.
 */
export const FEEDBACK_SPACE_URI =
  process.env.NEXT_PUBLIC_FEEDBACK_SPACE_URI?.trim() ||
  (FEEDBACK_OWNER === DEFAULT_OWNER ? DEFAULT_SPACE_URI : '');

/** Where the lexicon family this board speaks is published. */
export const USERINPUT_HOME = 'https://userinput.app';

/** The lexicon schema records themselves, in aturi.to's own explorer. */
export const USERINPUT_LEXICONS_PATH =
  '/explore/userinput.app/com.atproto.lexicon.schema';
