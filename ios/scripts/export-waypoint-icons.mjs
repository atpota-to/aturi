#!/usr/bin/env node
// Writes the waypoint brand marks into the app's asset catalog.
//
// Source of truth is packages/waypoints/src/waypointIcons.data.ts, the SVG
// catalog the sync script derives from src/utils/waypointIcons.tsx, so the
// iOS app shows the same marks as the web picker and the extension. Run it
// from the repo root after `cd packages && npm run sync` whenever a waypoint
// is added:
//
//   node --experimental-strip-types ios/scripts/export-waypoint-icons.mjs
//
// Marks are shipped as SVG image sets. Xcode rasterises them at build time and
// iOS 13+ can draw them as vector data, so no per-scale PNGs are needed.
//
// Two colour treatments:
//
//   - Most marks paint only `currentColor`. They become template images, so
//     SwiftUI tints them with whatever foreground colour the view uses, in
//     both light and dark palettes.
//   - A few marks knock part of the shape out to `var(--bg-primary, white)`.
//     A template image would tint the knockout along with the rest and the
//     hole disappears, so those get one SVG per appearance instead, painted
//     in the moss text and background colours for dark and light.
//
// Asset catalog SVGs cannot resolve CSS custom properties or `currentColor`,
// so both are rewritten to literal colours here.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const catalogPath = path.join(repoRoot, 'packages/waypoints/src/waypointIcons.data.ts');
const outDir = path.join(repoRoot, 'ios/Aturi/Resources/Assets.xcassets/Waypoints');

const { WAYPOINT_ICON_SVGS } = await import(catalogPath);

const KNOCKOUT = /var\(--bg-primary,\s*white\)/g;

// Moss palette values from src/app/globals.css, the app's default scheme.
const DARK = { fg: '#f0f0ee', bg: '#0a0a0a' };
const LIGHT = { fg: '#1a1c18', bg: '#faf8f3' };

function paint(svg, fg, bg) {
  return svg.replace(/currentColor/g, fg).replace(KNOCKOUT, bg);
}

async function writeImageSet(id, svg) {
  const dir = path.join(outDir, `${id}.imageset`);
  await mkdir(dir, { recursive: true });

  const usesKnockout = KNOCKOUT.test(svg);
  KNOCKOUT.lastIndex = 0;

  if (!usesKnockout) {
    await writeFile(path.join(dir, `${id}.svg`), paint(svg, '#000000', '#ffffff'));
    await writeFile(
      path.join(dir, 'Contents.json'),
      JSON.stringify(
        {
          images: [{ filename: `${id}.svg`, idiom: 'universal' }],
          info: { author: 'xcode', version: 1 },
          properties: {
            'preserves-vector-representation': true,
            'template-rendering-intent': 'template',
          },
        },
        null,
        2,
      ) + '\n',
    );
    return 'template';
  }

  await writeFile(path.join(dir, `${id}-light.svg`), paint(svg, LIGHT.fg, LIGHT.bg));
  await writeFile(path.join(dir, `${id}-dark.svg`), paint(svg, DARK.fg, DARK.bg));
  await writeFile(
    path.join(dir, 'Contents.json'),
    JSON.stringify(
      {
        images: [
          { filename: `${id}-light.svg`, idiom: 'universal' },
          {
            appearances: [{ appearance: 'luminosity', value: 'dark' }],
            filename: `${id}-dark.svg`,
            idiom: 'universal',
          },
        ],
        info: { author: 'xcode', version: 1 },
        properties: {
          'preserves-vector-representation': true,
          'template-rendering-intent': 'original',
        },
      },
      null,
      2,
    ) + '\n',
  );
  return 'appearance';
}

// Start from a clean folder so a renamed or removed waypoint does not leave a
// stale image set behind.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'Contents.json'),
  JSON.stringify(
    { info: { author: 'xcode', version: 1 }, properties: { 'provides-namespace': true } },
    null,
    2,
  ) + '\n',
);

const counts = { template: 0, appearance: 0 };
for (const [id, svg] of Object.entries(WAYPOINT_ICON_SVGS)) {
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) {
    throw new Error(`waypoint ${id} has no SVG markup`);
  }
  if (/<linearGradient|<radialGradient|<style|<use|\bid=/.test(svg)) {
    // Xcode's SVG support is a subset; anything referencing ids or styles
    // would render blank, and the catalog's own tests forbid ids anyway.
    throw new Error(`waypoint ${id} uses SVG features the asset catalog cannot render`);
  }
  counts[await writeImageSet(id, svg)] += 1;
}

const written = (await readdir(outDir)).filter((name) => name.endsWith('.imageset')).length;
console.log(
  `wrote ${written} image sets to ${path.relative(repoRoot, outDir)} ` +
    `(${counts.template} template, ${counts.appearance} light/dark)`,
);
