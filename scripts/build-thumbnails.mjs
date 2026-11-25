// Converts every image in assets/thumbnails/ to a resized WebP in assets/thumbnails/webp/.
// Originals are left untouched. Skips files whose WebP is already newer than the source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'assets', 'thumbnails');
const outDir = path.join(srcDir, 'webp');
const WIDTH = 640;
const EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.avif']);

await fs.mkdir(outDir, { recursive: true });
let converted = 0, skipped = 0;
for (const name of await fs.readdir(srcDir)) {
  const ext = path.extname(name).toLowerCase();
  if (!EXTS.has(ext)) continue;
  const src = path.join(srcDir, name);
  const dest = path.join(outDir, path.basename(name, path.extname(name)) + '.webp');
  const srcStat = await fs.stat(src);
  if (!srcStat.isFile()) continue;
  const destStat = await fs.stat(dest).catch(() => null);
  if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) { skipped++; continue; }
  await sharp(src, ext === '.svg' ? { density: 150 } : {})
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(dest);
  converted++;
}
console.log(`Thumbnails: ${converted} converted, ${skipped} up to date -> assets/thumbnails/webp/`);
