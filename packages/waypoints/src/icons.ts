// Entry point for `@aturi.to/waypoints/icons`.
//
// The marks live behind a subpath rather than the package root on purpose. They
// are a `Record` keyed by waypoint id, and a bundler cannot drop unused keys of
// an object literal, so putting them on the main entry would charge every
// consumer that only wanted a link builder for ~80KB of brand marks. Importing
// this module is the opt in.
//
// The values are plain SVG markup, so any framework can render them: React via
// `dangerouslySetInnerHTML`, Svelte via `{@html}`, Vue via `v-html`, or a
// template engine writing HTML directly. React consumers who would rather have
// components can use `@aturi.to/waypoints-react` instead.
import { WAYPOINT_ICON_SVGS } from './waypointIcons.data';

export * from './waypointIcons.data';

/**
 * The SVG markup for a waypoint's brand mark, or `undefined` for an id the
 * catalog does not carry.
 *
 * Every id in `WAYPOINT_ORDER` has a mark, so this only returns `undefined` for
 * an id that is not a waypoint at all. The `typeof` guard is what keeps an
 * arbitrary caller-supplied string off `Object.prototype`: a plain lookup of
 * `"toString"` would otherwise hand back a function.
 */
export function getWaypointIconSvg(id: string): string | undefined {
  const svg = WAYPOINT_ICON_SVGS[id];
  return typeof svg === 'string' ? svg : undefined;
}
