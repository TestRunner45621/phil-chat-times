// fill.js — dead-space check for a page-boxed print HTML, measured in the DOM by headless Chrome.
// Usage: node tools/fill.js "<path to issue.html>" [--all]
//
// The HTML must contain the measurement script (tools/measure-snippet.js, inlined) which, when the page is
// opened with ?measure=1, walks every .page, buckets painted rects into that page's .col containers, and
// writes a JSON report into <pre id="fill-report">. This script launches Chrome with --dump-dom, extracts
// the report and prints a table: per page, per column: column height, deepest content edge, gap at the foot;
// plus overflow (content lower than the page box, which print would clip) and empty columns.
// Air declared with data-air="<reason>" is listed as AIR and not counted as a defect. A page with nothing
// measurable (no .col or .flow outside declared air) is listed as UNMEASURED: check that page's PNG by eye.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
if (!file) { console.error('usage: node fill.js <issue.html> [--all]'); process.exit(1); }
const showAll = process.argv.includes('--all');
const abs = path.resolve(file);
const url = 'file:///' + abs.replace(/\\/g, '/').replace(/^\/+/, '') + '?measure=1';

let dom;
try {
  dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=30000', '--run-all-compositor-stages-before-draw',
    '--window-size=1000,1400', '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.error('chrome failed:', e.message); process.exit(2);
}
const m = dom.match(/<pre id="fill-report"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) { console.error('no fill-report found in DOM (is the measure snippet in the HTML?)'); process.exit(3); }
const report = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

const PX_PER_IN = 96;
const fmt = px => (px / PX_PER_IN).toFixed(2) + 'in';
let problems = 0;
console.log(`pages: ${report.pages.length}   (page box ${fmt(report.pageW)} x ${fmt(report.pageH)})`);
for (const p of report.pages) {
  const flags = [];
  const notes = [];
  if (p.air && p.air.length) notes.push('AIR (declared): ' + p.air.join(' | '));
  if (!p.cols.length) notes.push('UNMEASURED: nothing here for fill.js to measure, check the PNG by eye');
  (p.packs || []).forEach(r => notes.push('PACK: ' + r));
  if (p.overflow > 2) flags.push(`OVERFLOW ${fmt(p.overflow)} below page box`);
  const dry = [];
  p.cols.forEach((c, i) => {
    if (c.empty) { flags.push(`col${i + 1} EMPTY`); return; }
    const name = c.label ? c.label : `col${i + 1}`;
    if (c.ox > 2 && /:1$/.test(name)) flags.push(`${name.replace(/:1$/,'')} SPILLS into hidden column, ${fmt(c.hid||0)} deep (cut that much)`);
    if (c.gap < -2) flags.push(`${name} OVERFLOWS by ${fmt(-c.gap)}`);
    // a packed flow is fenced boxes whose feet can be written to within a line, so it is held tighter
    else if (c.gap > (c.packed ? 0.15 : 0.35) * PX_PER_IN) dry.push(`${name} gap ${fmt(c.gap)}${c.packed ? ' (packed: limit 0.15in)' : ''}`);
  });
  if (dry.length) flags.push('DRY: ' + dry.join(', '));
  if (flags.length) problems++;
  if (flags.length || notes.length || showAll) {
    console.log(`\npage ${p.n} [${p.id || ''}] ${flags.length ? '!! ' + flags.join(' | ') : 'ok'}`);
    notes.forEach(n => console.log('   ' + n));
    p.cols.forEach((c, i) => console.log(`   col${i + 1}: height ${fmt(c.h)}  content-to ${fmt(c.deep)}  gap ${fmt(c.gap)}${c.empty ? '  (empty)' : ''}${c.label ? '  ' + c.label : ''}`));
    if (p.overflow > 0) console.log(`   overflow: ${fmt(p.overflow)}`);
  }
}
console.log(`\n${problems ? problems + ' page(s) need attention' : 'all pages clean'}`);
