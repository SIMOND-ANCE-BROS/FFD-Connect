/**
 * Génère des icônes par variante avec un ruban d'angle (PREV / BETA / DEV)
 * pour distinguer les apps sur l'écran d'accueil. Prod garde l'icône propre.
 *
 * Usage: node scripts/make-variant-icons.js
 */
const path = require("path");
const sharp = require("sharp");

const ASSETS = path.resolve(__dirname, "..", "assets");
const SIZE = 1024;

// Ruban diagonal dans le coin haut-gauche, centré sur le quadrant (256,256)
// pour rester en retrait du coin (survit au masque arrondi iOS).
function ribbonSvg(label, color) {
  return Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-45 256 256)">
      <rect x="-260" y="188" width="1032" height="136" fill="${color}"/>
      <text x="256" y="256"
        font-family="Helvetica, Arial, sans-serif" font-size="104" font-weight="bold"
        fill="#ffffff" text-anchor="middle" dominant-baseline="central"
        letter-spacing="10">${label}</text>
    </g>
  </svg>`);
}

async function make(label, color, out) {
  await sharp(path.join(ASSETS, "icon.png"))
    .resize(SIZE, SIZE)
    .composite([{ input: ribbonSvg(label, color), top: 0, left: 0 }])
    .flatten({ background: "#ffffff" }) // iOS refuse le canal alpha sur l'icône
    .removeAlpha() // supprime le canal alpha (pas seulement la transparence)
    .png({ palette: true, quality: 100, effort: 10 }) // PNG8 → ~5x plus léger
    .toFile(path.join(ASSETS, out));
  console.log("✓", out);
}

(async () => {
  await make("PREV", "#F59E0B", "icon.preview.png");
  await make("BETA", "#E30613", "icon.beta.png");
  await make("DEV", "#64748B", "icon.dev.png");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
