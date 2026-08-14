/* Measure body-text line pitch straight off a rasterised page.
 * Finds runs of ink-bearing rows inside a column and reports the spacing
 * between successive text lines, which gives the effective leading in points. */
const { PNG } = require('pngjs');
const fs = require('fs');

const [file, dpi, x0, x1, y0, y1] = process.argv.slice(2);
const D = +dpi;
const p = PNG.sync.read(fs.readFileSync(file));

const counts = new Map();
for (let y = 0; y < p.height; y += 3)
  for (let x = 0; x < p.width; x += 3) {
    const i = (p.width * y + x) << 2;
    const k = ((p.data[i] >> 4) << 8) | ((p.data[i + 1] >> 4) << 4) | (p.data[i + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
let bk = 0,
  bc = -1;
for (const [k, c] of counts) if (c > bc) ((bc = c), (bk = k));
const paper = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];

const rows = [];
for (let y = +y0; y < +y1; y++) {
  let n = 0;
  for (let x = +x0; x < +x1; x++) {
    const i = (p.width * y + x) << 2;
    const dr = p.data[i] - paper[0],
      dg = p.data[i + 1] - paper[1],
      db = p.data[i + 2] - paper[2];
    if (dr * dr + dg * dg + db * db > 900) n++;
  }
  rows.push(n > 1);
}

const starts = [];
for (let i = 1; i < rows.length; i++) if (rows[i] && !rows[i - 1]) starts.push(i);
const gaps = [];
for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
gaps.sort((a, b) => a - b);
const med = gaps[Math.floor(gaps.length / 2)];
console.log(
  `lines found: ${starts.length}  median pitch: ${med}px @${D}dpi = ${((med / D) * 72).toFixed(2)}pt leading`
);
