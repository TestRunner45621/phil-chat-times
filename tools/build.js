// build.js — concatenate parts/*.html into issue.html, inlining the nameplate font CSS,
// the box packer (pack-snippet.js) and the measurement snippet. Usage: node tools/build.js "<edition folder>"
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build.js "<edition folder>"'); process.exit(1); }
const partsDir = path.join(dir, 'parts');
const toolsDir = __dirname;
const fontCss = fs.readFileSync(path.join(toolsDir, 'nameplate-font.css'), 'utf8');
const snippet = fs.readFileSync(path.join(toolsDir, 'measure-snippet.js'), 'utf8');
const packer = fs.readFileSync(path.join(toolsDir, 'pack-snippet.js'), 'utf8');
const files = fs.readdirSync(partsDir).filter(f => /\.html$/i.test(f)).sort();
let out = '';
for (const f of files) {
  let s = fs.readFileSync(path.join(partsDir, f), 'utf8');
  s = s.replace('/*NAMEPLATE_FONT_CSS*/', () => fontCss);
  out += `\n<!-- ${f} -->\n` + s;
}
// the packer runs first (it rearranges .flow[data-pack] boxes), then the measuring code sees the result
out += `\n<script>\n${packer}\n</script>\n<script>\n${snippet}\n</script>\n</body>\n</html>\n`;
fs.writeFileSync(path.join(dir, 'issue.html'), out);
const pages = (out.match(/class="page[ "]/g) || []).length;
console.log(`built issue.html from ${files.length} parts; ${pages} .page elements; ${(out.length / 1024).toFixed(0)} KB`);
