// Canonical profile route: `aturi.to/profile/{handle}`. The bare
// `aturi.to/{handle}` form still works (handled by `src/app/[handle]/page.tsx`)
// for backwards compatibility, but new links should use this path.
//
// We re-export the page module so both routes stay in lockstep.
export { default, generateMetadata } from '@/app/[locale]/[handle]/page';
