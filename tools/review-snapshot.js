// review-snapshot.js — keeps the issue as it stood before REVIEW and as REVIEW left it, and says what changed, so the
// editor can have anything REVIEW did put back (editor, 23 Sep 2026: "create a before and after review edition ... just
// in case you change something that I want reverted" and "i also want to know what changes are made"). Every review
// gets a numbered pair in <edition>/review/:
//   "1 before"  the issue as BUILD left it, taken before the first REVIEW session starts
//   "1 after"   the issue as REVIEW left it, taken when STATUS turns READY TO PUBLISH, with
//               changes.html  every changed page: before and after side by side, the wording that changed, and
//                             REVIEW's own account of what it did and why (notes/review.md)
//               changes.txt   the same list of files, short
// Each copy holds parts/, img/, pages/, issue.html, issue.pdf and issue.txt. A later review makes "2 before" etc.
//
//   node tools/review-snapshot.js "<edition folder>" before|after|report
//
// Safe to call any number of times: "before" opens a new pair only when the last one is closed, and "after" only
// closes an open one. "report" rewrites changes.html for the last closed pair. pipeline.js calls it, and so does the
// session hook tools/hooks/review-snapshot-hook.js, which covers REVIEW sessions started by hand and drivers started
// before this file existed.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ITEMS = ['parts', 'img', 'pages', 'issue.html', 'issue.pdf', 'issue.txt'];

function pairs(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => /^\d+ before$/.test(f)).length;
}

function copy(edition, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of ITEMS) {
    const from = path.join(edition, item);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dest, item), { recursive: true });
  }
}

function hashes(root, sub) {
  const out = {};
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p).replace(/\\/g, '/')] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(path.join(root, sub));
  return out;
}

// ---------------------------------------------------------------------------- the report
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', times: '×', thinsp: ' ', ensp: ' ', emsp: ' ', bull: '•',
  deg: '°', frac12: '½', eacute: 'é', copy: '©', larr: '←', rarr: '→', uarr: '↑', darr: '↓', minus: '−', shy: '' };

// The words a reader sees on a page part, one block per line. Scripts and styles are left out; a change in them is
// reported separately, as a change to the drawing or the layout.
function pageText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|td|th|tr|figcaption|caption|blockquote|section|article|header|footer|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e] || m)
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const codeOf = (html) => (html.match(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi) || []).join('\n');
const markupOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/>[^<]*</g, '><');

// Longest common subsequence diff: [['=', x] | ['-', x] | ['+', x]].
function diff(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', a[i++]]);
    else out.push(['+', b[j++]]);
  }
  while (i < n) out.push(['-', a[i++]]);
  while (j < m) out.push(['+', b[j++]]);
  return out;
}

// A line that was rewritten shows its words struck and inserted in place; whole lines cut or added show as such.
function wordDiff(x, y) {
  return diff(x.split(' '), y.split(' ')).map(([op, w]) =>
    op === '=' ? esc(w) : op === '-' ? `<del>${esc(w)}</del>` : `<ins>${esc(w)}</ins>`).join(' ');
}
function textDiffHtml(a, b) {
  const d = diff(a, b), rows = [];
  for (let k = 0; k < d.length; k++) {
    if (d[k][0] === '=') continue;
    const dels = [], adds = [];
    while (k < d.length && d[k][0] !== '=') { (d[k][0] === '-' ? dels : adds).push(d[k][1]); k++; }
    const ctx = d.slice(Math.max(0, k - dels.length - adds.length - 1), k - dels.length - adds.length).filter((e) => e[0] === '=').map((e) => e[1]);
    if (ctx.length) rows.push(`<p class="ctx">… ${esc(ctx[0].slice(-120))}</p>`);
    const pairsN = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairsN; p++) rows.push(`<p class="chg">${wordDiff(dels[p], adds[p])}</p>`);
    for (const l of dels.slice(pairsN)) rows.push(`<p class="cut"><del>${esc(l)}</del></p>`);
    for (const l of adds.slice(pairsN)) rows.push(`<p class="add"><ins>${esc(l)}</ins></p>`);
  }
  return rows.join('\n');
}

function report(dir, n) {
  const before = path.join(dir, `${n} before`), after = path.join(dir, `${n} after`);
  const list = (root) => (fs.existsSync(path.join(root, 'parts')) ? fs.readdirSync(path.join(root, 'parts')).filter((f) => /\.html$/i.test(f)).sort() : []);
  const pageNo = (root) => { const m = {}; list(root).filter((f) => !/^00-/.test(f)).forEach((f, i) => { m[f] = i + 1; }); return m; };
  const pa = pageNo(before), pb = pageNo(after);
  const png = (root, no) => {
    const f = no && fs.existsSync(path.join(root, 'pages')) && fs.readdirSync(path.join(root, 'pages')).find((x) => new RegExp(`^page-0*${no}\\.png$`).test(x));
    return f ? `${encodeURI(path.basename(root))}/pages/${f}` : null;
  };
  const ha = hashes(before, 'parts'), hb = hashes(after, 'parts');
  const files = [...new Set([...Object.keys(ha), ...Object.keys(hb)])].filter((f) => ha[f] !== hb[f]).sort();
  const ia = hashes(before, 'img'), ib = hashes(after, 'img');
  const imgs = [...new Set([...Object.keys(ia), ...Object.keys(ib)])].filter((f) => ia[f] !== ib[f]).sort();

  const sections = files.map((rel) => {
    const f = path.basename(rel);
    const A = fs.existsSync(path.join(before, rel)) ? fs.readFileSync(path.join(before, rel), 'utf8') : '';
    const B = fs.existsSync(path.join(after, rel)) ? fs.readFileSync(path.join(after, rel), 'utf8') : '';
    const where = /^00-/.test(f) ? 'the issue-wide design (every page)'
      : !A ? `page ${pb[f]} (new page)` : !B ? `was page ${pa[f]} (page removed)`
      : pa[f] === pb[f] ? `page ${pb[f]}` : `page ${pb[f]} (was page ${pa[f]})`;
    const other = [];
    if (A && B && codeOf(A) !== codeOf(B)) other.push(/^00-/.test(f) ? 'the shared styles or scripts' : 'the drawing, graphic or page styles (script/style)');
    if (A && B && markupOf(A) !== markupOf(B)) other.push('the layout or pictures (markup: sizes, crops, classes, image sources)');
    const text = textDiffHtml(pageText(A), pageText(B));
    const ia = png(path.join(dir, `${n} before`), pa[f]), ib = png(path.join(dir, `${n} after`), pb[f]);
    return `<section>
<h2>${esc(where)} <span>${esc(rel)}</span></h2>
${other.length ? `<p class="also">Also changed: ${esc(other.join('; '))}.</p>` : ''}
${text ? `<div class="diff">${text}</div>` : '<p class="also">No change to the words.</p>'}
${ia || ib ? `<div class="pair"><figure>${ia ? `<img src="../${ia}" loading="lazy">` : '<div class="none">not in this version</div>'}<figcaption>Before</figcaption></figure><figure>${ib ? `<img src="../${ib}" loading="lazy">` : '<div class="none">not in this version</div>'}<figcaption>After</figcaption></figure></div>` : ''}
</section>`;
  });

  const said = fs.existsSync(path.join(after, 'review.md')) ? fs.readFileSync(path.join(after, 'review.md'), 'utf8') : '(REVIEW left no notes/review.md.)';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Review ${n}: what changed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f6f6f4;--card:#fff;--ink:#16171a;--mute:#6b6e76;--line:#dcdde1;--del:#b3261e;--delbg:#fde7e5;--ins:#11663a;--insbg:#dcf5e6}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--card:#1d1f23;--ink:#eceef2;--mute:#9a9ea8;--line:#34373d;--del:#ff8a80;--delbg:#3d1a18;--ins:#7ee2a8;--insbg:#123321}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px} .sub{color:var(--mute);margin:0 0 24px}
section,details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 18px}
h2{font-size:18px;margin:0 0 8px} h2 span{font:13px ui-monospace,Consolas,monospace;color:var(--mute);margin-left:8px}
.also{color:var(--mute);margin:4px 0}
.diff{border-left:3px solid var(--line);padding-left:12px;margin:10px 0}
.diff p{margin:6px 0} .ctx{color:var(--mute);font-size:13px}
del{color:var(--del);background:var(--delbg);text-decoration:line-through} ins{color:var(--ins);background:var(--insbg);text-decoration:none}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
figure{margin:0} figure img{width:100%;border:1px solid var(--line);border-radius:4px;background:#fff}
figcaption{color:var(--mute);font-size:13px;text-align:center}
.none{aspect-ratio:8.5/11;display:grid;place-items:center;border:1px dashed var(--line);color:var(--mute)}
pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Consolas,monospace;margin:10px 0 0}
summary{cursor:pointer;font-weight:600}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Review ${n}: what changed</h1>
<p class="sub">${files.length} page file${files.length === 1 ? '' : 's'} changed${imgs.length ? `, ${imgs.length} picture file${imgs.length === 1 ? '' : 's'}` : ''}. Left is the issue as the build left it ("${n} before"), right is the issue after review ("${n} after"). Struck red words were cut; green words were added. To put anything back, name the page and the change.</p>
<details open><summary>What the review says it did, and why (notes/review.md)</summary><pre>${esc(said)}</pre></details>
${sections.join('\n') || '<p>No page files changed.</p>'}
${imgs.length ? `<section><h2>Picture files</h2><p class="also">${imgs.map(esc).join('<br>')}</p></section>` : ''}
</main></body></html>`;
  fs.writeFileSync(path.join(after, 'changes.html'), html);
  fs.writeFileSync(path.join(after, 'changes.txt'), [
    `What review ${n} changed, comparing "${n} before" with "${n} after". changes.html shows it page by page.`,
    'To revert a page, copy its file from "before" back into the edition folder, then build, fill and render as usual.',
    '', `PAGE FILES (${files.length})`, ...files.map((f) => '  ' + f), '', `PICTURE FILES (${imgs.length})`, ...imgs.map((f) => '  ' + f), '',
  ].join('\n'));
  return { files: files.length, imgs: imgs.length };
}

// ---------------------------------------------------------------------------- snapshots
// Returns a sentence saying what it did, or null when there was nothing to do.
function snapshot(edition, which) {
  edition = path.resolve(edition);
  const dir = path.join(edition, 'review');
  const n = pairs(dir);
  if (which === 'before') {
    if (n > 0 && !fs.existsSync(path.join(dir, `${n} after`))) return null; // review n is still open
    if (!fs.existsSync(path.join(edition, 'parts'))) return null;
    const dest = path.join(dir, `${n + 1} before`);
    copy(edition, dest);
    return `Saved the issue as it stood before REVIEW in ${dest}.`;
  }
  if (which === 'after') {
    if (n === 0 || fs.existsSync(path.join(dir, `${n} after`))) return null; // no open review
    const dest = path.join(dir, `${n} after`);
    copy(edition, dest);
    const notes = path.join(edition, 'notes', 'review.md');
    if (fs.existsSync(notes)) fs.copyFileSync(notes, path.join(dest, 'review.md'));
    const r = report(dir, n);
    return `Saved the issue as REVIEW left it in ${dest}; changes.html lists ${r.files} changed page file(s) and ${r.imgs} picture file(s).`;
  }
  if (which === 'report') {
    if (n === 0 || !fs.existsSync(path.join(dir, `${n} after`))) return null;
    const r = report(dir, n);
    return `Rewrote ${path.join(dir, `${n} after`, 'changes.html')} (${r.files} page file(s), ${r.imgs} picture file(s)).`;
  }
  throw new Error(`unknown snapshot "${which}" (before|after|report)`);
}

module.exports = { snapshot };

if (require.main === module) {
  const [edition, which] = process.argv.slice(2);
  if (!edition || !/^(before|after|report)$/.test(which || '')) {
    console.error('usage: node tools/review-snapshot.js "<edition folder>" before|after|report');
    process.exit(1);
  }
  console.log(snapshot(edition, which) || 'nothing to do');
}
