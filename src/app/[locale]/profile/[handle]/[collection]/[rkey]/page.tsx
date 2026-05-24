// Canonical generic record route:
// `aturi.to/profile/{handle}/{collection}/{rkey}`. The bare
// `aturi.to/{handle}/{collection}/{rkey}` form still works (handled by
// `src/app/[handle]/[collection]/[rkey]/page.tsx`) for backwards compatibility,
// but new links should use this path.
//
// We re-export the page module so both routes stay in lockstep.
export { default, generateMetadata } from '@/app/[locale]/[handle]/[collection]/[rkey]/page';
