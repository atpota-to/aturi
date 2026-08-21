/**
 * OAuth scope definitions and helpers.
 *
 * Aturi advertises a superset of granular per-action scopes in its OAuth
 * client metadata and then lets users opt out of individual permissions
 * at sign-in time. Per the atproto OAuth PAR spec, the runtime-requested
 * scope must be a subset of what the metadata advertises — so the
 * metadata string is the union of every granular scope below.
 *
 * Repo reads aren't gated by a scope (records in the user's own repo
 * are public), but AppView RPC reads now require an explicit `rpc:`
 * grant since the granular-scope rollout — that one is bundled into
 * BASE_SCOPE below so it isn't optional. The picker exposes write-side
 * actions plus the two permissioned-data reads, which are the only
 * granular scopes that ship unticked.
 */

export type ScopeId =
  | 'create'
  | 'update'
  | 'delete'
  | 'blob'
  | 'spacesSelf'
  | 'spacesAll'
  | 'spacesWrite';

export type GranularScope = {
  id: ScopeId;
  scope: string;
  label: string;
  hint: string;
  /**
   * Whether the picker ticks this row when it opens. Absent means `true`:
   * the write-side actions have always defaulted on and still do.
   */
  defaultOn?: boolean;
};

/**
 * Permissioned data ("Spaces") — two read-only scopes, both default-off.
 *
 * Spaces are the atproto proposal for records that live outside the public
 * repo: an authority grants members permission to write into a shared,
 * per-member permissioned repo, and reads are gated by a credential instead
 * of being world-readable. The explorer can render them, but only with an
 * OAuth grant carrying a `space:` token.
 *
 * Why both tokens go into the client metadata unconditionally: metadata
 * `scope` is never parsed token-by-token. The provider checks a charset
 * regex, that the string contains `atproto`, and that no token repeats.
 * Every character of `space:*?authority=*&action=read` is inside that
 * charset, so an authorization server that has never heard of spaces
 * accepts the metadata unchanged. Declaring both lets the picker offer
 * either one without a metadata redeploy, because the runtime-requested
 * scope is validated against the declared set by exact string membership.
 *
 * Why they are default-OFF in the picker: a `space:` token in the
 * *authorize* request does reach scope parsing. Providers drop tokens they
 * don't recognize on the same path that already carries aturi's `rpc:` /
 * `repo:` / `blob:` tokens, but that could not be verified against the exact
 * build running on bsky.social. With both rows unticked the requested scope
 * string is byte-identical to what this app sent before spaces existed, so
 * an ordinary Bluesky sign-in cannot regress: a `space:` token only ever
 * leaves the browser because a user ticked a box, and if their server
 * rejects it the picker's back button lets them retry without it. Flip a row
 * to `defaultOn: true` only after confirming that a space-token request
 * completes sign-in against a real PDS.
 *
 * Scope syntax notes (from @atproto/oauth-scopes space-permission.ts):
 *   - The type is the positional parameter and MUST stay the wildcard `*`.
 *     A concrete space-type NSID makes a spaces-aware server resolve that
 *     lexicon on the consent screen, again at the code exchange, and again
 *     on every subsequent refresh — where the failure is uncaught and
 *     permanently breaks the session. `space:*` is exempt at all three.
 *   - `authority` defaults to `self`, which would pin the grant to spaces
 *     the user themselves authors. Listing spaces and reading anyone else's
 *     space both match against an `authority` of `*`, so the wildcard here
 *     is load-bearing, not decorative.
 *   - `skey`, `collection` and `manage` are omitted deliberately. `skey`
 *     defaults to `*`; `collection` defaults to the empty list, which with
 *     `type=*` has no declaration to expand from, so create/update/delete
 *     can never match; `manage` defaults to empty. Both tokens are read-only.
 *   - Serialization is exact. Parameter order follows the schema (type →
 *     authority → skey → collection → action → manage), defaults are omitted
 *     by the formatter, and `*` is form-urlencoded-safe so it stays bare
 *     (never `%2A`). The declared-vs-requested check is a plain array
 *     membership test, so METADATA_SCOPE and the runtime string have to
 *     agree byte for byte — which is why both are generated from these two
 *     constants and the literals are never hand-copied anywhere else.
 *   - `read` implies `read_self` in the matcher, so `buildScopeString`
 *     drops `read_self` whenever `read` is selected.
 */
const SPACE_READ_SELF_SCOPE = 'space:*?authority=*&action=read_self';
const SPACE_READ_SCOPE = 'space:*?authority=*&action=read';

/**
 * Writing into a space: create, update and delete, over the whole of the
 * signed-in account's own permissioned repo.
 *
 * `collection=*` is the load-bearing part, and the reason this token can't be
 * folded into either read scope. The three write actions are the only ones the
 * matcher constrains by collection, and `collection` defaults to *the empty
 * list*, not to "all" — with `type=*` there is no space-type declaration to
 * expand that default from, so a token that omits it authorizes no write
 * target at all. The wildcard is also what keeps issuance cheap: a token that
 * names its collections skips the declaration lookup that
 * `withDefaultCollections` would otherwise do.
 *
 * A concrete collection list isn't an option here for the same reason the type
 * stays `*`. The explorer is generic — it renders whatever collection a space
 * happens to hold, including lexicons published after this build shipped — so
 * there is no set of NSIDs it could enumerate at sign-in that would still be
 * right at edit time.
 *
 * Actions are serialized in the matcher's own order (read_self, read, create,
 * update, delete) because its `normalize` re-sorts them into that order before
 * formatting, and the declared-vs-requested check is byte-exact.
 *
 * This is a write grant over permissioned data, so it ships `defaultOn: false`
 * like the two read rows, for the same reason: an unticked box means the
 * requested scope string is byte-identical to the pre-spaces one.
 */
const SPACE_WRITE_SCOPE =
  'space:*?authority=*&collection=*&action=create&action=update&action=delete';

export const GRANULAR_SCOPES: GranularScope[] = [
  {
    id: 'create',
    scope: 'repo:*?action=create',
    label: 'Create',
    hint: 'Add records to your repo.',
  },
  {
    id: 'update',
    scope: 'repo:*?action=update',
    label: 'Update',
    hint: 'Change records you already have.',
  },
  {
    id: 'delete',
    scope: 'repo:*?action=delete',
    label: 'Delete',
    hint: 'Delete records from your repo.',
  },
  {
    id: 'blob',
    scope: 'blob:*/*',
    label: 'Upload',
    hint: 'Attach images and other media.',
  },
  {
    id: 'spacesSelf',
    scope: SPACE_READ_SELF_SCOPE,
    label: 'Read your permissioned data',
    hint: 'Your spaces, and your own records in them.',
    defaultOn: false,
  },
  {
    id: 'spacesAll',
    scope: SPACE_READ_SCOPE,
    label: 'Read whole spaces',
    // The scope is `authority=*`: it authorizes this app to ask *any* space
    // authority, on your behalf, for a credential to read a whole space. The
    // PDS mints the delegation token without checking membership — that is the
    // authority's determination, not the PDS's — so "spaces you belong to" is
    // what you get in practice, not what the grant says. The hint says the
    // thing that is actually true.
    //
    // It is also the longest hint here on purpose. The picker used to carry
    // this warning in a paragraph above the group; that paragraph is gone for
    // height, so the row it was warning about states it itself.
    hint: 'Other members’ records too. Asks any authority, including one a link names, for a credential in your name.',
    defaultOn: false,
  },
  {
    id: 'spacesWrite',
    scope: SPACE_WRITE_SCOPE,
    // Only ever your own records: a space write is attributed to its author,
    // so the write methods take an OAuth token and nothing else, and a PDS
    // answers a write aimed at anyone else's repo the same way it answers a
    // read — as though the repo weren't there.
    label: 'Edit your permissioned records',
    hint: 'Write and delete your own records in a space.',
    defaultOn: false,
  },
];

/**
 * The permissioned-data rows, so the picker can group them under their own
 * heading without hardcoding ids and `buildScopeString` can express the
 * read/read_self collapse in one place.
 */
export const SPACE_SCOPE_IDS: ReadonlySet<ScopeId> = new Set<ScopeId>([
  'spacesSelf',
  'spacesAll',
  'spacesWrite',
]);

/**
 * Reads from the Bluesky AppView (profile lookups, viewer state, known
 * followers, post threads, etc.) go through the user's PDS, which since
 * the granular-scope OAuth rollout requires an explicit `rpc:` grant
 * before it will proxy the call with a user-identifying service-auth
 * token. Without this the explorer's relationship strip silently gets
 * `viewer: {}` back from the AppView because the PDS forwards the
 * request anonymously.
 *
 * Scope syntax notes (from @atproto/oauth-scopes rpc-permission.ts):
 *   - The `lxm` parameter is either a literal `*` or a full NSID. NSID
 *     prefix wildcards (e.g. `app.bsky.*`) are NOT supported and get
 *     dropped during scope normalization, which is why an earlier
 *     attempt at `rpc:app.bsky.*?aud=...` left the PDS still throwing
 *     ScopeMissingError.
 *   - The `#` in the audience DID fragment MUST be URL-encoded as `%23`.
 *
 * `rpc:*` is read-only and core to the explorer working at all, so it's
 * bundled into BASE_SCOPE rather than exposed as a picker chip.
 */
const APPVIEW_RPC_SCOPE = 'rpc:*?aud=did:web:api.bsky.app%23bsky_appview';

export const BASE_SCOPE = ['atproto', APPVIEW_RPC_SCOPE].join(' ');

/** Superset string baked into oauth-client-metadata.json. */
export const METADATA_SCOPE = [
  BASE_SCOPE,
  ...GRANULAR_SCOPES.map((s) => s.scope),
].join(' ');

/**
 * Every granular id, including the two space rows. Nothing selects this as a
 * default — do not: it would opt users into whole-space reads without a box
 * having been ticked. `DEFAULT_SCOPE_IDS` is the "everything we ask for
 * unprompted" set.
 */
export const ALL_SCOPE_IDS: ReadonlySet<ScopeId> = new Set(
  GRANULAR_SCOPES.map((s) => s.id),
);

/**
 * What the picker ticks when it opens: everything except the space scopes.
 * Requesting exactly this set produces the same scope string this app sent
 * before spaces existed, which is the guarantee that the change is inert for
 * anyone who doesn't opt in.
 */
export const DEFAULT_SCOPE_IDS: ReadonlySet<ScopeId> = new Set(
  GRANULAR_SCOPES.filter((s) => s.defaultOn !== false).map((s) => s.id),
);

/** Build the runtime scope string from a set of selected granular IDs. */
export function buildScopeString(selected: ReadonlySet<ScopeId>): string {
  // `read` implies `read_self` in the space matcher, so asking for both only
  // makes the consent screen longer without widening anything.
  const effective =
    selected.has('spacesAll') && selected.has('spacesSelf')
      ? new Set([...selected].filter((id) => id !== 'spacesSelf'))
      : selected;

  const granular = GRANULAR_SCOPES.filter((s) => effective.has(s.id)).map(
    (s) => s.scope,
  );
  return [BASE_SCOPE, ...granular].join(' ');
}

/**
 * Action list a `space:` token carries when it names none. The parser's
 * default is read + the three write verbs, so a bare `space:*` is a read
 * grant even though it doesn't say so.
 */
const SPACE_DEFAULT_ACTIONS = ['read', 'create', 'update', 'delete'];

function spaceTokens(grantedScope: string | null | undefined): string[] {
  if (!grantedScope) return [];
  return grantedScope.split(' ').filter((token) => token.startsWith('space:'));
}

function spaceTokenActions(token: string): string[] {
  const q = token.indexOf('?');
  if (q < 0) return SPACE_DEFAULT_ACTIONS;
  const actions = new URLSearchParams(token.slice(q + 1)).getAll('action');
  return actions.length > 0 ? actions : SPACE_DEFAULT_ACTIONS;
}

/** True when a granted-scope string carries any space grant. */
export function hasSpaceScope(grantedScope: string | null | undefined): boolean {
  return spaceTokens(grantedScope).length > 0;
}

/**
 * The strongest space grant that survived authorization, read back off the
 * token's own `scope` claim.
 *
 * There is no pre-flight capability signal anywhere in atproto OAuth — an
 * authorization server's metadata says nothing about spaces — so this is the
 * only way to learn whether the grant actually happened. A server that
 * doesn't understand `space:` drops the token silently, and the answer here
 * is `null`, which the UI treats as "hide every space affordance".
 *
 * Only the action is inspected. This app requests `authority=*` and nothing
 * else, and a granted token round-trips through the provider's formatter
 * byte-identically, so a narrower authority would mean the server rewrote a
 * request rather than granting or dropping it — which no provider does.
 */
/** The three space actions that write. `read`/`read_self` are handled above. */
export type SpaceWriteAction = 'create' | 'update' | 'delete';

const SPACE_WRITE_ACTIONS: readonly SpaceWriteAction[] = ['create', 'update', 'delete'];

/**
 * Which collections a `space:` token authorizes writes into.
 *
 * The default is deliberately empty rather than "all", mirroring the matcher:
 * a token that names no collection confers no write target, even though its
 * default action list carries all three write verbs. So a bare `space:*`
 * grants nothing here, which is exactly what it grants at the PDS.
 */
function spaceTokenCollections(token: string): string[] {
  const q = token.indexOf('?');
  if (q < 0) return [];
  return new URLSearchParams(token.slice(q + 1)).getAll('collection');
}

/**
 * The write actions a granted scope authorizes for one collection.
 *
 * Read back off the token rather than assumed from what was requested, for the
 * same reason `spaceGrantLevel` is: an authorization server that doesn't
 * understand `space:` drops the token silently, and a server that understands
 * it may still narrow the grant. An empty set means every write affordance
 * stays hidden.
 *
 * The collection is a parameter because the matcher checks it per record: this
 * app asks for `collection=*`, but a token that came back naming collections
 * authorizes writes to those and no others, and the difference is only visible
 * once you know which record is being edited.
 */
export function spaceWriteActionsFor(
  grantedScope: string | null | undefined,
  collection: string,
): ReadonlySet<SpaceWriteAction> {
  const granted = new Set<SpaceWriteAction>();
  for (const token of spaceTokens(grantedScope)) {
    const collections = spaceTokenCollections(token);
    if (!collections.includes('*') && !collections.includes(collection)) continue;
    const actions = spaceTokenActions(token);
    for (const action of SPACE_WRITE_ACTIONS) {
      if (actions.includes(action)) granted.add(action);
    }
  }
  return granted;
}

/**
 * Whether any space token carries a write action at all, ignoring which
 * collections it covers. For copy that explains a missing capability, where
 * naming one collection would be beside the point.
 */
export function hasSpaceWriteScope(grantedScope: string | null | undefined): boolean {
  return spaceTokens(grantedScope).some((token) => {
    if (spaceTokenCollections(token).length === 0) return false;
    const actions = spaceTokenActions(token);
    return SPACE_WRITE_ACTIONS.some((action) => actions.includes(action));
  });
}

export function spaceGrantLevel(
  grantedScope: string | null | undefined,
): 'read' | 'read_self' | null {
  let level: 'read' | 'read_self' | null = null;
  for (const token of spaceTokens(grantedScope)) {
    const actions = spaceTokenActions(token);
    if (actions.includes('read')) return 'read';
    if (actions.includes('read_self')) level = 'read_self';
  }
  return level;
}
