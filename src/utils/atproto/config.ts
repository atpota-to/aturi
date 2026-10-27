/**
 * Shared endpoint constants for the Atmosphere explorer's protocol layer.
 *
 * No React/Next imports here — this module is consumed from both server
 * components and the browser extension popup, so it must stay isomorphic.
 */

export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';
export const CONSTELLATION = 'https://constellation.microcosm.blue';
export const SLINGSHOT = 'https://slingshot.microcosm.blue';
export const JETSTREAM = 'wss://jetstream2.us-east.bsky.network/subscribe';
export const HANDLE_RESOLVER_FALLBACK = 'https://bsky.social';

/**
 * Relay used as a second opinion on `com.atproto.sync.getRepoStatus`, which
 * the lexicon says both a PDS and a relay implement. Asked only about repos
 * their own PDS has already reported inactive: the PDS answers the status but
 * drops the `rev`, while the relay still carries the head rev it last saw, so
 * a taken-down repo can still show when it was last written to. Never used
 * for record reads — those belong to the account's own PDS.
 */
export const RELAY = 'https://relay1.us-east.bsky.network';

export const ATURI_BASE = 'https://aturi.to';

export const CRED_BLUE_API = 'https://api.cred.blue';
export const CRED_BLUE_BASE = 'https://cred.blue';

/**
 * DNS-over-HTTPS resolver used for `_lexicon.<authority>` TXT lookups when
 * resolving a space type declaration. The same endpoint `src/lib/oauth/client.ts`
 * already trusts for handle resolution.
 */
export const DOH_RESOLVER = 'https://dns.google/resolve';
