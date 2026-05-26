// Rasterizes assets/icon.svg into public/icon/{size}.png at the sizes WXT
// auto-picks up for the extension's toolbar icon. Also rasterizes the
// "active" variant (assets/icon-active.svg) into public/icon/active-{size}.png
// — the background worker swaps to this variant per-tab whenever the
// passive scan detects AT URIs on the page.
//
// Run `npm run icons` after editing either SVG.

import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'icon');

const SIZES = [16, 32, 48, 96, 128];

const VARIANTS = [
  { svg: 'icon.svg', prefix: '' },
  { svg: 'icon-active.svg', prefix: 'active-' },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { svg: svgName, prefix } of VARIANTS) {
    const svgPath = path.join(root, 'assets', svgName);
    const svg = await readFile(svgPath);

    await Promise.all(
      SIZES.map(async (size) => {
        const outPath = path.join(outDir, `${prefix}${size}.png`);
        await sharp(svg, { density: 512 })
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toFile(outPath);
        console.log(`wrote ${path.relative(root, outPath)}`);
      })
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
