const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Icon appearance ─────────────────────────────────────────────
// Edit these to restyle the toolbar icon, then re-run: `node create_icons.js`
const BG_COLOR = '#020202';   // Domdhi obsidian void background
const FG_COLOR = '#9D4EDD';   // Deep Amethyst (System gem) — shipped default glyph
const ROUNDED  = false;       // brutalist hard square — zero radius everywhere
// ────────────────────────────────────────────────────────────────
//
// This script has NO external dependencies — it rasterizes the icon by hand
// (4x4 supersampling for smooth edges) and encodes PNG via Node's built-in zlib.

const sizes = [16, 48, 128];
const SS = 4; // supersampling factor

const iconsDir = path.join(__dirname, 'src', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Is point (px,py) inside an SxS rounded rect with corner radius r? */
function inRoundedRect(px, py, S, r) {
    const dx = px < r ? r - px : (px > S - r ? px - (S - r) : 0);
    const dy = py < r ? r - py : (py > S - r ? py - (S - r) : 0);
    if (px < 0 || px > S || py < 0 || py > S) return false;
    return dx * dx + dy * dy <= r * r;
}

/** Is point (px,py) inside triangle (ax,ay)(bx,by)(cx,cy)? */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}

// ── PNG encoding (RGBA, 8-bit) ──────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type RGBA
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    // raw scanlines, each prefixed with filter byte 0
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 4);
        raw[rowStart] = 0;
        rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([
        sig,
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Render each size ────────────────────────────────────────────
const bg = hexToRgb(BG_COLOR);
const fg = hexToRgb(FG_COLOR);

sizes.forEach(size => {
    const r = ROUNDED ? Math.max(2, Math.floor(size * 0.18)) : 0;
    const pad = Math.floor(size * 0.15);

    // Icon D layout (all coords in pixels, scaled to `size`):
    //   Left zone  (x: pad .. linesRight):  3 horizontal motion bars
    //   Right zone (x: triLeft .. size-pad): play triangle pointing right
    //
    // Divide the inner draw area: left ~42% for bars, right ~58% for triangle.
    const drawW  = size - pad * 2;
    const linesW = Math.floor(drawW * 0.42);   // width budget for motion bars
    const triLeft = pad + linesW + Math.max(1, Math.floor(size * 0.04)); // gap between bars and triangle
    const triRight = size - pad;
    const triTop   = Math.floor(size * 0.2);
    const triBot   = size - Math.floor(size * 0.2);
    const triMidY  = size / 2;

    // 3 motion bars: horizontal segments of varying length, vertically spaced
    // Bar lengths: short / long / short  (matching popup SVG: h3 / h4 / h3 out of viewport ~24u)
    // Scale the bar lengths proportionally inside the linesW budget.
    const barLong  = linesW;                            // longest bar uses full linesW
    const barShort = Math.floor(linesW * 0.75);         // shorter bars are 75% of linesW
    const barH     = Math.max(1, Math.floor(size * 0.08)); // bar thickness
    // Bar Y centres at triTop, triMidY, triBot
    const bars = [
        { x: pad, w: barShort, y: triTop   - barH / 2 },   // top bar (short)
        { x: pad, w: barLong,  y: triMidY  - barH / 2 },   // middle bar (long)
        { x: pad, w: barShort, y: triBot   - barH / 2 },   // bottom bar (short)
    ];

    const rgba = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let rs = 0, gs = 0, bs = 0, colored = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const px = x + (sx + 0.5) / SS;
                    const py = y + (sy + 0.5) / SS;
                    if (ROUNDED && !inRoundedRect(px, py, size, r)) continue;
                    // Play triangle: apex on right (triRight, triMidY), base on left, right-pointing
                    const inPlay = inTriangle(px, py,
                        triLeft, triTop,
                        triRight, triMidY,
                        triLeft, triBot);
                    // Motion bars: 3 horizontal rectangles
                    const inBars = bars.some(b =>
                        px >= b.x && px <= b.x + b.w &&
                        py >= b.y && py <= b.y + barH);
                    const inGlyph = inPlay || inBars;
                    const c = inGlyph ? fg : bg;
                    rs += c[0]; gs += c[1]; bs += c[2]; colored++;
                }
            }
            const total = SS * SS;
            const idx = (y * size + x) * 4;
            if (colored === 0) {
                rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = rgba[idx + 3] = 0;
            } else {
                rgba[idx] = Math.round(rs / colored);
                rgba[idx + 1] = Math.round(gs / colored);
                rgba[idx + 2] = Math.round(bs / colored);
                rgba[idx + 3] = Math.round((colored / total) * 255);
            }
        }
    }

    fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), encodePng(size, size, rgba));
});

console.log('Icons created successfully!');
