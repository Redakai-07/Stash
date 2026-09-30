/**
 * Icon generation.
 *
 * Every icon Stash ships is derived from three SVG masters, and this script is
 * the only thing that writes the rasterised copies:
 *
 *   public/icons/icon.svg        the rounded tile        -> web, PWA, legacy launcher
 *   public/icons/maskable.svg    full-bleed background   -> PWA maskable
 *   public/icons/foreground.svg  mark only, transparent  -> Android adaptive icon
 *
 * Rasterising is a build step rather than a design step: a PNG that was drawn by
 * hand drifts from the master the moment the master is edited, and a launcher
 * icon is the one asset nobody re-checks. Run it after any change to the three
 * files above:
 *
 *   node scripts/make-icons.mjs
 *
 * It uses `sharp`, which arrives as a dependency of Next.js. If a future version
 * stops shipping it, `npm i -D sharp` is the fix — nothing else here is unusual.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative));

const TILE = await read('public/icons/icon.svg');
const MASKABLE = await read('public/icons/maskable.svg');
const FOREGROUND = await read('public/icons/foreground.svg');

/** Rasterise an SVG at `size`, blowing it up first so curves stay crisp. */
async function render(svg, size, file, { round = false } = {}) {
  const target = path.join(root, file);
  let image = sharp(svg, { density: 512 }).resize(size, size, { fit: 'contain' });
  if (round) {
    const circle = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    image = sharp(await image.png().toBuffer()).composite([{ input: circle, blend: 'dest-in' }]);
  }
  await image.png({ compressionLevel: 9 }).toFile(target);
  return file;
}

/**
 * Density buckets Android expects, as multiples of the 48dp baseline. The
 * launcher icon is 48dp, the adaptive foreground is a 108dp canvas.
 */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

const written = [];

// Web: the tab icon, the iOS home-screen icon, and the two manifest sizes.
written.push(await render(TILE, 48, 'src/app/icon.png'));
written.push(await render(TILE, 180, 'src/app/apple-icon.png'));
written.push(await render(TILE, 192, 'public/icons/icon-192.png'));
written.push(await render(TILE, 512, 'public/icons/icon-512.png'));
written.push(await render(MASKABLE, 512, 'public/icons/maskable-512.png'));

// Android: the pre-API-26 launcher icons, and the adaptive-icon foreground.
for (const [bucket, scale] of DENSITIES) {
  const dir = `android/app/src/main/res/mipmap-${bucket}`;
  written.push(await render(TILE, Math.round(48 * scale), `${dir}/ic_launcher.png`));
  written.push(await render(TILE, Math.round(48 * scale), `${dir}/ic_launcher_round.png`, { round: true }));
  written.push(await render(FOREGROUND, Math.round(108 * scale), `${dir}/ic_launcher_foreground.png`));
}

// The point of running this is to see what it wrote.
// eslint-disable-next-line no-console
for (const file of written) console.log(`wrote ${file}`);
