// pack-bake.js — fixes every packed flow (.flow[data-pack]) to the columns Chrome dealt it, so the issue reads the same
// in every browser. The packer lays columns out with CSS multicol and break-before:column, which Firefox ignores: there
// every box piled into the first column and the rest of the page was pushed off it (Vol I No 10, page 18). This opens
// the built issue in headless Chrome, lets the packer run, reads which box went into which column, and writes that into
// each flow's tag in parts/ as data-pack-plan. The packer then builds plain side-by-side columns from the plan, in Chrome
// and Firefox alike, without measuring again.
//
//   node tools/pack-bake.js "<edition folder>"           bake (run build.js first; rebuild and render after)
//   node tools/pack-bake.js "<edition folder>" --clear   remove the plans, so the packer measures afresh
//
// Bake last, just before the final render for publishing. A baked page no longer re-deals its boxes, so after
// changing any copy on one, run --clear, build, check the page, and bake again.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [dirArg, flag] = process.argv.slice(2);
if (!dirArg) { console.error('usage: node tools/pack-bake.js "<edition folder>" [--clear]'); process.exit(1); }
const dir = path.resolve(dirArg);
const partsDir = path.join(dir, 'parts');
const parts = fs.readdirSync(partsDir).filter((f) => /\.html$/i.test(f)).sort();

// The opening tag of a packed flow: data-pack as an attribute of its own, not data-pack-first/-tail/-plan.
const FLOW_TAG = /<[a-zA-Z][^<>]*?\sdata-pack(?![-\w])[^<>]*>/g;
const PLAN_ATTR = /\s+data-pack-plan='[^']*'/;

if (flag === '--clear') {
  let n = 0;
  for (const f of parts) {
    const p = path.join(partsDir, f), s = fs.readFileSync(p, 'utf8');
    const t = s.replace(FLOW_TAG, (tag) => (PLAN_ATTR.test(tag) ? (n++, tag.replace(PLAN_ATTR, '')) : tag));
    if (t !== s) fs.writeFileSync(p, t);
  }
  console.log(`cleared ${n} plan(s). Rebuild with build.js.`);
  process.exit(0);
}

// 1. Chrome packs the issue as built, but with every existing plan removed, so it deals afresh; a reporter reads the
//    result: the DOM order after packing is column order, break-before:column opens each column after the first, and
//    data-pack-order is each box's written index.
const issue = path.join(dir, 'issue.html');
if (!fs.existsSync(issue)) { console.error('no issue.html: run build.js first'); process.exit(1); }
const reporter = `<script>
(function () {
  function read() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.flow[data-pack]'), function (flow) {
      var n = parseInt(getComputedStyle(flow).columnCount, 10) || 1, cols = [], hide = [], tail = null, c = 0;
      for (var i = 0; i < n; i++) cols.push([]);
      Array.prototype.forEach.call(flow.children, function (el) {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || !el.hasAttribute('data-pack-order')) return;
        var ix = Number(el.getAttribute('data-pack-order'));
        if (el.hasAttribute('data-pack-tail')) { tail = ix; return; }
        if (el.style.display === 'none') { hide.push(ix); return; }
        if (el.style.breakBefore === 'column') c = Math.min(c + 1, n - 1);
        cols[c].push(ix);
      });
      out.push({ page: (flow.closest('.page') || {}).id || '', cols: cols, hide: hide, tail: tail,
                 report: flow.getAttribute('data-pack-report') || '' });
    });
    var pre = document.createElement('pre'); pre.id = 'pack-plans'; pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }
  function later() { setTimeout(read, 1500); }
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(function () { if (document.readyState === 'complete') later(); else window.addEventListener('load', later); });
})();
</script>`;
const html = fs.readFileSync(issue, 'utf8').replace(/\s+data-pack-plan='[^']*'/g, '');
const tmp = path.join(dir, 'issue.pack-bake.html');
fs.writeFileSync(tmp, html.replace(/<\/body>\s*<\/html>\s*$/, reporter + '\n</body>\n</html>\n'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let dom;
try {
  dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=30000',
    '--run-all-compositor-stages-before-draw', '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/').replace(/ /g, '%20')],
  { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  fs.unlinkSync(tmp);
}
const m = dom.match(/<pre id="pack-plans">([\s\S]*?)<\/pre>/);
if (!m) { console.error('Chrome did not report the packing (no #pack-plans in the dumped page)'); process.exit(2); }
const plans = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

// 2. Write each plan into its flow's tag. Flows are matched in document order: the Nth packed flow in the issue is the
//    Nth packed-flow tag across the parts in build order.
const tags = [];
for (const f of parts) {
  const s = fs.readFileSync(path.join(partsDir, f), 'utf8');
  for (const t of s.matchAll(FLOW_TAG)) tags.push({ f, tag: t[0] });
}
if (tags.length !== plans.length) {
  console.error(`found ${tags.length} packed-flow tags in parts/ but Chrome packed ${plans.length} flows; nothing written`);
  process.exit(3);
}
const byFile = {};
tags.forEach((t, i) => { (byFile[t.f] = byFile[t.f] || []).push(plans[i]); });
for (const [f, list] of Object.entries(byFile)) {
  const p = path.join(partsDir, f);
  let k = 0;
  const s = fs.readFileSync(p, 'utf8').replace(FLOW_TAG, (tag) => {
    const pl = list[k++];
    const json = JSON.stringify({ cols: pl.cols, hide: pl.hide, tail: pl.tail });
    return tag.replace(PLAN_ATTR, '').replace(/\sdata-pack(?![-\w])(="[^"]*")?/, (a) => `${a} data-pack-plan='${json}'`);
  });
  fs.writeFileSync(p, s);
  list.forEach((pl) => console.log(`${f} (${pl.page || 'page'}): ${pl.cols.map((c) => c.length).join('/')} boxes` +
    `${pl.hide.length ? `, ${pl.hide.length} spare(s) hidden` : ''}${pl.tail != null ? ', tail' : ''} · Chrome's pack: ${pl.report}`));
}
console.log(`baked ${plans.length} flow(s). Now rebuild (build.js), then fill.js and render.sh.`);
