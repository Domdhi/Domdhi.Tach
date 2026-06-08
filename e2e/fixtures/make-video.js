// @ts-check
// One-off generator for e2e/fixtures/video.webm.
//
// Playwright's bundled Chromium lacks proprietary codecs (H.264/AAC), so an MP4
// fixture fails to decode (MEDIA_ERR_SRC_NOT_SUPPORTED). VP8/WebM is decoded
// natively. Rather than ship a hand-crafted binary, we let the browser record a
// short VP8 clip via canvas.captureStream() + MediaRecorder — guaranteeing the
// asset is decodable by the very same Chromium the specs run in.
//
// Run manually if the fixture ever needs regenerating:
//   node e2e/fixtures/make-video.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADLESS === '1', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const stream = canvas.captureStream(10);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    /** @type {Blob[]} */ const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const start = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = (performance.now() - start) / 1000;
        ctx.fillStyle = `hsl(${(t * 120) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (t >= 1.2) return resolve(undefined);
        requestAnimationFrame(draw);
      };
      draw();
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  await browser.close();
  const out = path.join(__dirname, 'video.webm');
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
})();
