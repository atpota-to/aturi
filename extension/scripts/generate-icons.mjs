// Rasterizes assets/icon.svg into public/icon/{size}.png at the sizes WXT
// auto-picks up for the extension's toolbar icon. A single brand-sage icon
// is used across both light and dark browser themes for visual consistency.
//
// Run `npm run icons` after editing assets/icon.svg.

import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const outDir = path.join(root, 'public', 'icon');

const SIZES = [16, 32, 48, 96, 128];

async function main() {
  await mkdir(outDir, { recursive: true });
  const svg = await readFile(svgPath);

  await Promise.all(
    SIZES.map(async (size) => {
      const outPath = path.join(outDir, `${size}.png`);
      await sharp(svg, { density: 512 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPath);
      console.log(`wrote ${path.relative(root, outPath)}`);
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
