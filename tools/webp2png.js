#!/usr/bin/env node
'use strict';
/*
 * webp2png.js — Typst reads PNG/JPEG/GIF/SVG but not WebP, and roughly a third
 * of the Discord image exports are .webp. This mirrors an images/ folder into a
 * sibling folder with every .webp re-encoded as .png and everything else copied
 * through unchanged, so paths stay one-to-one.
 *
 *   node webp2png.js <images-dir> [out-dir] [--limit N]
 *
 * Only needed if the paper is built in Typst. The HTML build renders .webp
 * natively and needs none of this.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const src = process.argv[2];
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : src + '-png';
const li = process.argv.indexOf('--limit');
const limit = li === -1 ? Infinity : parseInt(process.argv[li + 1], 10);

if (!src || !fs.existsSync(src)) {
  console.error('usage: node webp2png.js <images-dir> [out-dir] [--limit N]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

(async () => {
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile());
  const webp = files.filter((f) => f.toLowerCase().endsWith('.webp'));
  const other = files.filter((f) => !f.toLowerCase().endsWith('.webp'));

  let done = 0;
  let failed = 0;
  const t0 = Date.now();

  for (const f of webp.slice(0, limit)) {
    const dst = path.join(out, f.replace(/\.webp$/i, '.png'));
    try {
      await sharp(path.join(src, f)).png({ compressionLevel: 9 }).toFile(dst);
      done++;
    } catch (e) {
      failed++;
      console.error(`  FAILED ${f}: ${e.message}`);
    }
  }

  let copied = 0;
  if (limit === Infinity) {
    for (const f of other) {
      fs.copyFileSync(path.join(src, f), path.join(out, f));
      copied++;
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `  ${done}/${Math.min(webp.length, limit)} webp converted, ${failed} failed, ` +
      `${copied} other files copied, ${secs}s -> ${out}`
  );
  if (failed) process.exit(1);
})();
