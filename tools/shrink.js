// shrink.js — make downsized JPEG copies of the log images an edition uses, so the PDF and the
// inlined HTML stay a sensible size. Pages reference img/<basename>.jpg; this fills img/ from the
// log's images folder (any source extension: jpg, png, webp). An <img ... data-hi> gets 2600px
// instead of 1600px, for a chart that runs across a whole page.
// Usage: node tools/shrink.js "<edition folder>" "<log folder>"      (needs ffmpeg on PATH)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [ed, log] = process.argv.slice(2);
if (!ed || !log) { console.error('usage: node tools/shrink.js "<edition>" "<log folder>"'); process.exit(1); }
const parts = path.join(ed, 'parts');
const out = path.join(ed, 'img');
fs.mkdirSync(out, { recursive: true });
const srcDir = path.join(log, 'images');
const sources = fs.readdirSync(srcDir);
const wanted = new Map();
for (const f of fs.readdirSync(parts).filter(f => /\.html$/i.test(f))) {
  const s = fs.readFileSync(path.join(parts, f), 'utf8');
  for (const m of s.matchAll(/<img\b([^>]*)>/g)) {
    const attrs = m[1];
    const sm = attrs.match(/src="img\/([^"]+)"/);
    if (!sm) continue;
    const hi = /\bdata-hi\b/.test(attrs);
    wanted.set(sm[1], (wanted.get(sm[1]) || false) || hi);
  }
}
let made = 0, missing = 0, kept = 0;
for (const [file, hi] of wanted) {
  const dst = path.join(out, file);
  if (fs.existsSync(dst)) { kept++; continue; }
  const base = path.basename(file, path.extname(file));
  const cand = sources.find(x => x === file || path.basename(x, path.extname(x)) === base);
  if (!cand) { console.error('no source for', file); missing++; continue; }
  const w = hi ? 2600 : 1600;
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(srcDir, cand),
      '-vf', `scale='min(${w},iw)':-2`, '-pix_fmt', 'yuvj420p', '-q:v', hi ? '2' : '4', dst],
      { stdio: 'inherit', windowsHide: true });
    made++;
  } catch (e) { console.error('ffmpeg failed for', file, e.message); missing++; }
}
console.log(`img/: ${wanted.size} referenced, ${made} made, ${kept} already there, ${missing} missing`);
if (missing) process.exit(2);
