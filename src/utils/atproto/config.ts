/**
 * Shared endpoint constants for the Atmosphere explorer's protocol layer.
 *
 * No React/Next imports here — this module is consumed from both server
 * components and the browser extension popup, so it must stay isomorphic.
 */

export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';
export const CONSTELLATION = 'https://constellation.microcosm.blue';
export const JETSTREAM = 'wss://jetstream2.us-east.bsky.network/subscribe';
export const HANDLE_RESOLVER_FALLBACK = 'https://bsky.social';

export const ATURI_BASE = 'https://aturi.to';
