const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

// ── Icon appearance ─────────────────────────────────────────────
// The toolbar/store icon IS the brand instrument: a miniature of the popup's
// 270° tachometer dial (arc + needle + redline tick + hub) — the product is
// named Tach, so the icon reads as the gauge, not a generic media glyph.
//
// The gauge art below is a copy of `src/popup/popup.html` .header__mark. KEEP IN
// SYNC with that SVG — it is the single source of the instrument's silhouette.
// Colors are the SHIPPED dark-theme tokens (theme.css) so the icon matches the
// product's default look:
const BG_COLOR  = '#020202';   // obsidian void (--background, dark)
const FG_COLOR  = '#9D4EDD';   // Deep Amethyst (--primary-color) — dial, needle, hub
const REDLINE   = '#FF0055';   // rose gem (--status-error, dark) — redline tip
const OUTLINE   = '#000000';   // black keyline behind every element — keeps the red
                               // tip separated from the dial even when the in-product
                               // accent (--primary-color) is set to red/near-red.
// Edit these, then re-run: `node create_icons.js` (writes src/icons/icon-*.png).
// Requires @playwright/test (devDependency) — chromium rasterizes the SVG so the
// icon is pixel-identical in geometry to the popup header dial.
// ────────────────────────────────────────────────────────────────

const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, 'src', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

/**
 * Build the gauge SVG markup for a given pixel size.
 * @param {number} size  output pixel dimension (square)
 * @param {boolean} simplified  16px variant: drop the redline tick (a single red
 *   pixel just reads as noise that small) and fatten the strokes for legibility.
 */
// ── Canonical dial geometry (24u viewBox) ───────────────────────
// Shared, pixel-for-pixel, with the popup header mark in src/popup/popup.html
// and the options header in src/options/options.html. If you change a path here,
// change it in BOTH of those SVGs too — there is no build step to sync them.
//   ARC         — 270° dial, opening at the bottom (centre 12,12 · radius 8)
//   POINTER     — full hub→rim line (used only by the 16px variant, no red tip)
//   NEEDLE      — amethyst shaft from the hub up to just below the colour junction
//   REDTIP      — red, collinear continuation from the junction (~60% up) to the rim
//   RED_OUTLINE — REDTIP extended ~0.65u past BOTH ends; drawn in black UNDER the red
//                 (and ON TOP of the arc) so the whole red section is bordered all the
//                 way around — stays distinct even when the accent colour equals the red
//   HUB         — pivot at (12,14)
const ARC = 'M6.34 19.66A8 8 0 1 1 17.66 19.66';
const POINTER = 'M12 14L18.45 5.94';
const NEEDLE = 'M12 14L15.58 9.53';
const REDTIP = 'M15.87 9.16L18.45 5.94';        // red runs from ~60% up to the rim
const RED_OUTLINE = 'M15.46 9.67L18.86 5.43';   // same line, extended a halo past each end
const HUB = { x: 12, y: 14 };

function gaugeSvg(size, simplified) {
  const cw = simplified ? 2.9 : 2;         // coloured stroke width, in viewBox units
  const ow = cw + 1.3;                     // black outline width (≈0.65u halo a side)
  const hubR = simplified ? 2.2 : 1.9;
  // Frame the 24u art inside the square: shrink (k) for the edge margin and nudge
  // it down (dy) so the dial sits centred-low like the reference, not edge-to-edge.
  const k = 0.9;
  const dy = 0.6;
  // The 16px variant drops the red tip — a sub-pixel red mark just reads as noise
  // that small — and runs the needle full-length (POINTER) in a single colour.
  const needle = simplified ? POINTER : NEEDLE;
  // Red block drawn LAST (over the arc) with its black border underneath, so the
  // whole red section is outlined on every side, the tip included.
  const red = simplified
    ? ''
    : `
    <path d="${RED_OUTLINE}" stroke="${OUTLINE}" stroke-width="${ow}" stroke-linecap="butt"/>
    <path d="${REDTIP}" stroke="${REDLINE}" stroke-width="${cw}" stroke-linecap="butt"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" shape-rendering="geometricPrecision">
  <rect x="0" y="0" width="24" height="24" fill="${BG_COLOR}"/>
  <g transform="translate(12,${12 + dy}) scale(${k}) translate(-12,-12)">
    <path d="${ARC}" fill="none" stroke="${OUTLINE}" stroke-width="${ow}" stroke-linecap="butt"/>
    <path d="${needle}" stroke="${OUTLINE}" stroke-width="${ow}" stroke-linecap="butt"/>
    <circle cx="${HUB.x}" cy="${HUB.y}" r="${hubR + 0.65}" fill="${OUTLINE}"/>
    <path d="${ARC}" fill="none" stroke="${FG_COLOR}" stroke-width="${cw}" stroke-linecap="butt"/>
    <path d="${needle}" stroke="${FG_COLOR}" stroke-width="${cw}" stroke-linecap="butt"/>
    <circle cx="${HUB.x}" cy="${HUB.y}" r="${hubR}" fill="${FG_COLOR}"/>${red}
  </g>
</svg>`;
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const size of sizes) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      const svg = gaugeSvg(size, size <= 16);
      await page.setContent(
        `<!doctype html><html><body style="margin:0;padding:0">${svg}</body></html>`,
        { waitUntil: 'networkidle' },
      );
      const buf = await page.screenshot({
        clip: { x: 0, y: 0, width: size, height: size },
        omitBackground: false,
      });
      fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), buf);
      await page.close();
    }
    console.log('Icons created successfully! (tachometer gauge → src/icons/)');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
