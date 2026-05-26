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
 * BASE_SCOPE below so it isn't optional. The picker only exposes
 * write-side actions.
 */

export type ScopeId = 'create' | 'update' | 'delete' | 'blob';

export type GranularScope = {
  id: ScopeId;
  scope: string;
  label: string;
  hint: string;
};

export const GRANULAR_SCOPES: GranularScope[] = [
  {
    id: 'create',
    scope: 'repo:*?action=create',
    label: 'Create',
    hint: 'Add new records to any collection in your repo.',
  },
  {
    id: 'update',
    scope: 'repo:*?action=update',
    label: 'Update',
    hint: 'Edit existing records (Record Editor, preferences).',
  },
  {
    id: 'delete',
    scope: 'repo:*?action=delete',
    label: 'Delete',
    hint: 'Remove records from your repo.',
  },
  {
    id: 'blob',
    scope: 'blob:*/*',
    label: 'Upload',
    hint: 'Upload images and other media attachments.',
  },
];

/**
 * Reads from the Bluesky AppView (profile lookups, viewer state, known
 * followers, post threads, etc.) go through the user's PDS, which since
 * the granular-scope OAuth rollout requires an explicit `rpc:` grant
 * before it will proxy the call with a user-identifying service-auth
 * token. Without this the explorer's relationship strip silently gets
 * `viewer: {}` back from the AppView because the PDS forwards the
 * request anonymously.
 *
 * `app.bsky.*` is a read-only wildcard and core to the explorer
 * working at all, so it's bundled into BASE_SCOPE rather than exposed
 * as an opt-in chip in the granular scope picker.
 */
const APPVIEW_RPC_SCOPE = 'rpc:app.bsky.*?aud=did:web:api.bsky.app#bsky_appview';

export const BASE_SCOPE = ['atproto', APPVIEW_RPC_SCOPE].join(' ');

/** Superset string baked into oauth-client-metadata.json. */
export const METADATA_SCOPE = [
  BASE_SCOPE,
  ...GRANULAR_SCOPES.map((s) => s.scope),
].join(' ');

export const ALL_SCOPE_IDS: ReadonlySet<ScopeId> = new Set(
  GRANULAR_SCOPES.map((s) => s.id),
);

/** Build the runtime scope string from a set of selected granular IDs. */
export function buildScopeString(selected: Set<ScopeId>): string {
  const granular = GRANULAR_SCOPES.filter((s) => selected.has(s.id)).map(
    (s) => s.scope,
  );
  return [BASE_SCOPE, ...granular].join(' ');
}
