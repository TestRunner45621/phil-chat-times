// sheet.js — the whole issue on one image, so sameness can be seen.
// Usage: node tools/sheet.js "<edition folder or its pages/ folder>" [--across 8]
//
// Reads the page PNGs render.sh wrote (pages/page-*.png), lays them out as a grid in a throwaway HTML
// file and screenshots it with headless Chrome. Writes pages/sheet.png and prints its path.
// Reading pages one at a time catches a bad page; only a sheet catches twenty pages that are the same
// page. Look at it before an issue ships (see THE BAR in Style.txt).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const arg = process.argv[2];
if (!arg) { console.error('usage: node tools/sheet.js "<edition folder>" [--across N]'); process.exit(1); }
const i = process.argv.indexOf('--across');
const across = i > 0 ? parseInt(process.argv[i + 1], 10) || 8 : 8;

let dir = path.resolve(arg);
if (fs.existsSync(path.join(dir, 'pages'))) dir = path.join(dir, 'pages');
const pngs = fs.readdirSync(dir)
  .filter(f => /^page-\d+\.png$/i.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
if (!pngs.length) { console.error('no page-N.png files in ' + dir + ' (run render.sh first)'); process.exit(2); }

const thumbW = 230, thumbH = Math.round(thumbW * 11 / 8.5), gap = 14, label = 16;
const rows = Math.ceil(pngs.length / across);
const W = across * thumbW + (across + 1) * gap;
const H = rows * (thumbH + label) + (rows + 1) * gap;
const cells = pngs.map((f, k) =>
  `<figure><img src="${encodeURI(f)}"><figcaption>${k + 1}</figcaption></figure>`).join('');
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#3b3935}
main{display:grid;grid-template-columns:repeat(${across},${thumbW}px);gap:${gap}px;padding:${gap}px}
figure{margin:0}img{display:block;width:${thumbW}px;height:${thumbH}px;box-shadow:0 1px 4px rgba(0,0,0,.6)}
figcaption{font:12px/16px Bahnschrift,Arial,sans-serif;color:#d8d2c4;text-align:center;height:${label}px}
</style></head><body><main>${cells}</main></body></html>`;
const tmp = path.join(dir, '.sheet.html');
fs.writeFileSync(tmp, html);
const out = path.join(dir, 'sheet.png');
try {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=10000', `--window-size=${W},${H}`, '--screenshot=' + out,
    'file:///' + tmp.replace(/\\/g, '/')], { stdio: 'ignore', windowsHide: true });
} catch (e) { /* chrome exits non-zero after a screenshot on some builds */ }
fs.unlinkSync(tmp);
if (!fs.existsSync(out)) { console.error('sheet not produced'); process.exit(3); }
console.log(`sheet: ${out}  (${pngs.length} pages, ${across} across)`);
