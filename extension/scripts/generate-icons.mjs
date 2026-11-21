// Rasterizes assets/icon.svg into public/icon/{size}.png at the sizes WXT
// auto-picks up for the extension's toolbar icon. Also rasterizes the
// "active" variant (assets/icon-active.svg) into public/icon/active-{size}.png
// — the background worker swaps to this variant per-tab whenever the
// passive scan detects AT URIs on the page.
//
// The Safari build also lists 64/256/512 px icons, which Safari shows in its
// extension settings. Those go to assets/safari-icon/ instead of public/icon/:
// WXT adds every PNG in public/icon/ to the manifest, so putting them there
// would change the Chrome and Firefox manifests too. wxt.config.ts copies
// them into the Safari build only.
//
// Run `npm run icons` after editing either SVG.

import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'icon');
const safariOutDir = path.join(root, 'assets', 'safari-icon');

const SIZES = [16, 32, 48, 96, 128];

// Keep in sync with SAFARI_EXTRA_ICON_SIZES in wxt.config.ts.
const SAFARI_SIZES = [64, 256, 512];

const VARIANTS = [
  { svg: 'icon.svg', prefix: '' },
  { svg: 'icon-active.svg', prefix: 'active-' },
];

async function rasterize(svg, size, outPath) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(safariOutDir, { recursive: true });

  for (const { svg: svgName, prefix } of VARIANTS) {
    const svgPath = path.join(root, 'assets', svgName);
    const svg = await readFile(svgPath);

    await Promise.all(
      SIZES.map((size) => rasterize(svg, size, path.join(outDir, `${prefix}${size}.png`)))
    );
  }

  // Only the idle icon: the active variant is a per-tab toolbar swap, and
  // the toolbar never asks for these sizes.
  const safariSvg = await readFile(path.join(root, 'assets', 'icon.svg'));
  await Promise.all(
    SAFARI_SIZES.map((size) => rasterize(safariSvg, size, path.join(safariOutDir, `${size}.png`)))
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
