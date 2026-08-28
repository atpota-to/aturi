// Canonical profile route: `aturi.to/profile/{handle}`. The bare
// `aturi.to/{handle}` form still works (handled by `src/app/[handle]/page.tsx`)
// for backwards compatibility, but new links should use this path.
//
// We re-export the page module so both routes stay in lockstep.
export { default, generateMetadata } from '@/app/[handle]/page';

// Route segment config has to be statically parseable in the route file
// itself — Next rejects it re-exported, so this is the one thing that can't
// ride along with the module above. Keep the value in step with `[handle]/page.tsx`.
export const revalidate = 60;

// Empty, and required for the `revalidate` above to do anything at all — see
// `explore/[repo]/page.tsx`.
export function generateStaticParams() {
  return [];
}
