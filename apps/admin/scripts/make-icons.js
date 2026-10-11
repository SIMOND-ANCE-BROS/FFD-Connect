/**
 * Generates the installable back-office icons (public/icons/) from the FFD
 * Connect app icon (apps/client/assets/icon.png — the project's own artwork,
 * never the federation logo) with an `ADMIN` corner ribbon, in the same style
 * as the mobile variants (apps/client/scripts/make-variant-icons.js: BETA red,
 * PREV orange, DEV slate). The ADMIN ribbon is purple so it reads as distinct.
 *
 * - apple-touch-icon (180), icon-192, icon-512: icon + diagonal ADMIN ribbon.
 * - icon-maskable-512: launchers crop it to any shape down to the 80 % safe
 *   circle, where a corner ribbon would be cut off. The artwork is shrunk into
 *   the safe zone and the ribbon becomes an ADMIN badge, also inside it.
 * - favicon-32: text is unreadable at 32 px; a plain purple corner keeps the
 *   tab distinguishable from the mobile app.
 *
 * Usage (from the repo root): pnpm --filter admin icons
 */
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(ROOT, '..', 'client', 'assets', 'icon.png');
const OUT = path.join(ROOT, 'public', 'icons');

/** Ribbon colour (violet-700): white text stays readable at 180 px. */
const RIBBON = '#6D28D9';
/** Background of the source icon, reused for the maskable bleed and the manifest. */
const BACKGROUND = '#01468A';
const SIZE = 1024;

// Same geometry as the mobile variants: diagonal band centred on the top-left
// quadrant (256,256), set back from the corner so it survives iOS rounding.
// Slightly larger text than the mobile ribbon: the icon is shown down to 180 px.
const ribbonSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-45 256 256)">
    <rect x="-260" y="180" width="1032" height="152" fill="${RIBBON}"/>
    <text x="256" y="256"
      font-family="Helvetica, Arial, sans-serif" font-size="108" font-weight="bold"
      fill="#ffffff" text-anchor="middle" dominant-baseline="central"
      letter-spacing="8">ADMIN</text>
  </g>
</svg>`;

// Maskable: the safe zone is the centred circle of radius 40 % (410 px at
// 1024). Artwork scaled to 62 % and lifted, badge below it — every corner of
// the badge stays within ~330 px of the centre.
const MASK_ART = 640;
const MASK_ART_TOP = 150;
const maskBadgeSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="302" y="680" width="420" height="112" rx="56" fill="${RIBBON}"/>
  <text x="512" y="736"
    font-family="Helvetica, Arial, sans-serif" font-size="80" font-weight="bold"
    fill="#ffffff" text-anchor="middle" dominant-baseline="central"
    letter-spacing="6">ADMIN</text>
</svg>`;

// Favicon: a plain purple triangle in the top-left corner, no text.
const cornerSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <polygon points="0,0 440,0 0,440" fill="${RIBBON}"/>
</svg>`;

async function save(image, size, name) {
  await sharp(await image.png().toBuffer())
    .resize(size, size, { kernel: 'lanczos3' })
    .flatten({ background: BACKGROUND }) // iOS ignores transparency on touch icons
    .removeAlpha()
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(OUT, name));
  process.stdout.write(`✓ ${name}\n`);
}

const icon = () => sharp(SOURCE).resize(SIZE, SIZE);
const withOverlay = (svg) => icon().composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);

const ribboned = await withOverlay(ribbonSvg).png().toBuffer();
await save(sharp(ribboned), 180, 'apple-touch-icon.png');
await save(sharp(ribboned), 192, 'icon-192.png');
await save(sharp(ribboned), 512, 'icon-512.png');

const art = await icon().resize(MASK_ART, MASK_ART).png().toBuffer();
await save(
  sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: BACKGROUND },
  }).composite([
    { input: art, top: MASK_ART_TOP, left: (SIZE - MASK_ART) / 2 },
    { input: Buffer.from(maskBadgeSvg), top: 0, left: 0 },
  ]),
  512,
  'icon-maskable-512.png',
);

await save(withOverlay(cornerSvg), 32, 'favicon-32.png');
