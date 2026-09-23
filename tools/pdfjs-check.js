// pdfjs-check.js — lists every repeating-gradient pattern in an edition's parts that will print as a flat block of colour
// in the website's reader. pdf.js paints Chrome's repeating gradients as one colour (Vol I No 10: the ruled notepad
// and the sermon board came out bright pink, the airmail stripes solid). A pattern is safe once it sits on a layer of
// its own (a ::before/::after) carrying filter:opacity(.999), which makes Chrome print that layer as an image.
// Style.txt OUTPUT, print rule 10.
//
//   node tools/pdfjs-check.js "<edition folder>"      exit code 1 when something needs fixing
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/pdfjs-check.js "<edition folder>"'); process.exit(1); }
const partsDir = path.join(dir, 'parts');
let bad = 0, ok = 0;
for (const f of fs.readdirSync(partsDir).filter((x) => /\.html$/i.test(x)).sort()) {
  const html = fs.readFileSync(path.join(partsDir, f), 'utf8');
  const css = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const inline = [...html.matchAll(/style="([^"]*repeating-[a-z]+-gradient[^"]*)"/gi)].map((m) => m[1]);
  // rule by rule: "selector { declarations }" (nested @media blocks are flattened by the same pattern)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' '), body = m[2];
    if (!/repeating-[a-z]+-gradient/i.test(body)) continue;
    const layer = /::?(before|after)\b/.test(sel);
    const raster = /filter\s*:\s*opacity\(\s*0?\.99/i.test(body);
    if (layer && raster) { ok++; continue; }
    bad++;
    console.log(`${f}: ${sel.slice(0, 90)} — ${!layer ? 'pattern on the box itself (move it to a ::before/::after)' : ''}${!layer && !raster ? '; ' : ''}${!raster ? 'no filter:opacity(.999)' : ''}`);
  }
  for (const s of inline) { bad++; console.log(`${f}: inline style with a repeating gradient — move it to a ::before/::after with filter:opacity(.999): ${s.slice(0, 80)}`); }
}
console.log(bad ? `${bad} pattern(s) will print flat in pdf.js; ${ok} fine` : `all ${ok} repeating pattern(s) flattened for pdf.js`);
process.exit(bad ? 1 : 0);
