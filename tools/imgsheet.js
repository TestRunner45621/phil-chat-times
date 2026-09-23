// imgsheet.js — a day's chat pictures as numbered contact sheets, so a read session can look at every
// one of them without opening each file.
// Usage: node tools/imgsheet.js "<log folder>" <MM-DD> [<MM-DD> ...] [--across 4] [--rows 3]
//
// Writes <log>/working/imgsheets/<MM-DD>-NN.png, twelve pictures to a sheet by default, and
// <MM-DD>.txt, the key: number, time, who posted it, reactions, file, and the line it came with.
// A sheet costs about as much to read as one full-size picture. A thumbnail tells you what a
// picture is; open the file itself before you caption it (Style.txt, IMAGES).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readLog, flat } = require('./log');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = parseInt(args[i + 1], 10);
  args.splice(i, 2);
  return v || dflt;
};
const across = opt('--across', 4);
const rows = opt('--rows', 3);
const [logArg, ...days] = args;
if (!logArg || !days.length) {
  console.error('usage: node tools/imgsheet.js "<log folder>" <MM-DD> [<MM-DD> ...] [--across 4] [--rows 3]');
  process.exit(1);
}
const logDir = path.resolve(logArg);
const imgDir = path.join(logDir, 'images');
const outDir = path.join(logDir, 'working', 'imgsheets');
fs.mkdirSync(outDir, { recursive: true });

const { msgs } = readLog(logDir);
const cellW = 360, cellH = 250, label = 34, gap = 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');

for (const day of days) {
  const pics = [];
  for (const m of msgs) {
    if (m.day !== day) continue;
    for (const f of m.images || []) {
      if (!fs.existsSync(path.join(imgDir, f))) continue;
      pics.push({ n: pics.length + 1, f, m });
    }
  }
  if (!pics.length) { console.log(`${day}: no pictures`); continue; }

  const key = pics.map(({ n, f, m }) =>
    `#${n}  ${m.time}  ${m.name} (${m.handle})  ${m.reacts ? m.reacts + ' reacts' : 'no reacts'}  ${f}` +
    (m.text ? `  — "${flat(m.text).slice(0, 110)}"` : ''));
  fs.writeFileSync(path.join(outDir, `${day}.txt`),
    `Pictures posted ${day} (Eastern), numbered as on the sheets ${day}-NN.png.\n\n` + key.join('\n') + '\n');

  const per = across * rows;
  const sheets = Math.ceil(pics.length / per);
  for (let s = 0; s < sheets; s++) {
    const chunk = pics.slice(s * per, (s + 1) * per);
    const r = Math.ceil(chunk.length / across);
    const W = across * cellW + (across + 1) * gap;
    const H = r * (cellH + label) + (r + 1) * gap;
    const cells = chunk.map(({ n, f, m }) => `<figure><div class="im"><img src="${fileUrl(path.join(imgDir, f))}"></div>` +
      `<figcaption><b>#${n}</b> ${esc(m.time)} ${esc(m.name)}${m.reacts ? ` <i>${m.reacts}★</i>` : ''}</figcaption></figure>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#26282b}
main{display:grid;grid-template-columns:repeat(${across},${cellW}px);gap:${gap}px;padding:${gap}px}
figure{margin:0}.im{width:${cellW}px;height:${cellH}px;background:#111;display:flex;align-items:center;justify-content:center}
img{max-width:100%;max-height:100%;object-fit:contain}
figcaption{font:14px/${label}px Bahnschrift,Arial,sans-serif;color:#e8e4da;height:${label}px;white-space:nowrap;overflow:hidden}
b{color:#ffd166;font-size:16px}i{color:#7bdff2;font-style:normal}
</style></head><body><main>${cells}</main></body></html>`;
    const tmp = path.join(outDir, `.${day}-${s + 1}.html`);
    const out = path.join(outDir, `${day}-${String(s + 1).padStart(2, '0')}.png`);
    fs.writeFileSync(tmp, html);
    try {
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--allow-file-access-from-files', '--virtual-time-budget=15000', `--window-size=${W},${H}`,
        '--screenshot=' + out, fileUrl(tmp)], { stdio: 'ignore', windowsHide: true });
    } catch (e) { /* chrome exits non-zero after a screenshot on some builds */ }
    fs.unlinkSync(tmp);
    if (!fs.existsSync(out)) { console.error(`sheet not produced: ${out}`); process.exit(3); }
  }
  console.log(`${day}: ${pics.length} pictures on ${sheets} sheet(s) -> ${path.join(outDir, day)}-NN.png, key ${day}.txt`);
}
