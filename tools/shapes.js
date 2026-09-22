// shapes.js — is the issue one page twenty times? Measures every page's silhouette and says so.
// Usage: node tools/shapes.js "<path to issue.html>"
//
// Works on any built issue, old or new: it copies the HTML to a temporary file beside it (so image paths
// still resolve), injects tools/shape-snippet.js, and reads the result through headless Chrome.
//
// Per page: body-text columns, biggest type (pt), headline count, largest picture and all pictures as a
// share of the page, text coverage, and light or dark ground. Those collapse into a silhouette key such as
// "3col / small pic / 26-43pt / light". It then reports:
//   RUN      three or more consecutive pages with the same key
//   FORMULA  one key covering more than half the issue
//   FEW DRAWINGS  more than half the pages with no drawn flourish or built graphic (inline SVG, canvas,
//                 or anything marked data-drawn; see VISUAL FLOURISHES in Style.txt)
//   and whether the issue has any page that is mostly picture, any page that is not columns, and any
//   real spread of headline sizes.
// It checks variety; it does not judge a page, and it will not design one. Read the contact sheet too.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
if (!file) { console.error('usage: node tools/shapes.js "<issue.html>"'); process.exit(1); }
const abs = path.resolve(file);
const snippet = fs.readFileSync(path.join(__dirname, 'shape-snippet.js'), 'utf8');
let html = fs.readFileSync(abs, 'utf8');
const inject = `<script>\n${snippet}\n</script>\n`;
html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, inject + '</body>') : html + inject;
const tmp = path.join(path.dirname(abs), '.shapes-' + path.basename(abs));
fs.writeFileSync(tmp, html);

let dom;
try {
  dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=30000', '--run-all-compositor-stages-before-draw', '--window-size=1000,1400',
    '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/') + '?shape=1'],
    { encoding: 'utf8', maxBuffer: 1 << 29, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { console.error('chrome failed:', e.message); process.exit(2); }
finally { try { fs.unlinkSync(tmp); } catch (e) {} }
// the snippet's own source mentions the tag, so take the last match: the one the script appended
const all = [...dom.matchAll(/<pre id="shape-report"[^>]*>([\s\S]*?)<\/pre>/g)];
const m = all.length ? all[all.length - 1] : null;
if (!m) { console.error('no shape-report in the DOM'); process.exit(3); }
const pages = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
if (pages.error) { console.error('snippet error:', pages.error); process.exit(4); }

const pct = x => (Math.round(x * 100) + '%').padStart(4);
const key = p => [
  p.cols >= 3 ? '3+col' : p.cols === 2 ? '2col' : '0-1col',
  p.bigPic >= 0.40 ? 'BIG pic' : p.bigPic >= 0.15 ? 'mid pic' : 'small pic',
  p.maxPt >= 44 ? '44pt+' : p.maxPt >= 26 ? '26-43pt' : '<26pt',
  p.dark ? 'dark' : 'light',
].join(' / ');

console.log('page  cols  type  heads  drawn  big-pic  pics  text  ground   silhouette');
pages.forEach(p => {
  p.key = key(p);
  console.log(`${String(p.n).padStart(4)}  ${String(p.cols).padStart(4)}  ${String(p.maxPt).padStart(4)}  ${String(p.heads).padStart(5)}  ${String(p.drawn || 0).padStart(5)}  ${pct(p.bigPic).padStart(7)}  ${pct(p.pics)}  ${pct(p.text)}  ${(p.dark ? 'dark' : 'light').padEnd(7)}  ${p.key}`);
});

const flags = [];
for (let i = 0; i < pages.length;) {
  let j = i; while (j + 1 < pages.length && pages[j + 1].key === pages[i].key) j++;
  if (j - i + 1 >= 3) flags.push(`RUN      pages ${pages[i].n}-${pages[j].n} share one silhouette (${pages[i].key})`);
  i = j + 1;
}
const counts = {};
pages.forEach(p => { counts[p.key] = (counts[p.key] || 0) + 1; });
const [topKey, topN] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
if (pages.length >= 6 && topN / pages.length > 0.5) flags.push(`FORMULA  ${topN} of ${pages.length} pages are "${topKey}"`);
if (!pages.some(p => p.bigPic >= 0.40)) flags.push('NO PICTURE PAGE  no page gives a single picture 40% of the sheet');
if (pages.length >= 3 && !pages.some(p => p.cols <= 1)) flags.push('ALL COLUMNS  every page is two or more columns of body text');
const types = pages.slice(1).map(p => p.maxPt).filter(Boolean);
if (types.length >= 3 && Math.max(...types) - Math.min(...types) < 14) flags.push(`ONE SIZE  after page 1 the biggest type only ranges ${Math.min(...types)}-${Math.max(...types)}pt`);
const bare = pages.filter(p => !p.drawn).map(p => p.n);
if (pages.length >= 3 && bare.length > pages.length / 2) flags.push(`FEW DRAWINGS  ${bare.length} of ${pages.length} pages have no drawn flourish or built graphic (pages ${bare.join(', ')})`);

console.log(`\n${Object.keys(counts).length} distinct silhouettes in ${pages.length} pages`);
console.log(flags.length ? flags.join('\n') : 'no sameness flags');
