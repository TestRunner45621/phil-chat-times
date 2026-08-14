#!/usr/bin/env node
'use strict';
/*
 * slack.js — engine-neutral page-fit meter for The Phil Chat Times.
 *
 * Reads a finished PDF (from Chrome, Typst, anything) and answers the two
 * questions that layout kept getting wrong:
 *
 *   1. How much white is left at the bottom of each column?  (the ragged-bottom
 *      complaint — measured in inches, against an agreed tolerance)
 *   2. Is any block of copy printed on more than one page?   (the Vol. III bug,
 *      where a whole rail of briefs was printed three times)
 *
 * It works on pixels and extracted text, not on a DOM, so it scores an HTML
 * build and a Typst build identically.
 *
 *   node slack.js issue.pdf [--tol 1.0] [--dpi 100] [--bot 0.55] [--top 0.75]
 *
 * Exit code 1 if any page busts tolerance or any duplicated block is found.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const pdf = argv.find((a) => !a.startsWith('--'));
if (!pdf) {
  console.error('usage: node slack.js <file.pdf> [--tol in] [--dpi n] [--bot in] [--top in]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? dflt : parseFloat(argv[i + 1]);
};
const TOL = opt('tol', 1.0); // inches of bottom slack allowed
const DPI = opt('dpi', 100);
const BOT = opt('bot', 0.55); // inset excluding the running footer
const TOP = opt('top', 0.75); // inset excluding the running head
const DELTA = opt('delta', 24); // colour distance that counts as ink
const KEEP = argv.includes('--keep');

// ---------------------------------------------------------------- raster

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-'));
process.on('exit', () => {
  if (!KEEP) fs.rmSync(tmp, { recursive: true, force: true });
});

execFileSync('pdftoppm', ['-png', '-r', String(DPI), pdf, path.join(tmp, 'pg')], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const pages = fs
  .readdirSync(tmp)
  .filter((f) => f.endsWith('.png'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((f) => path.join(tmp, f));

if (!pages.length) {
  console.error('slack: pdftoppm produced no pages');
  process.exit(2);
}

// ---------------------------------------------------------------- pixels

/* The paper is printed on a cream tint, not white, so "empty" cannot mean
 * "white". Take the page's modal colour as the paper, and call anything far
 * enough from it ink — which correctly counts tinted boxes and rules as
 * content rather than as background. */
function paperColour(png) {
  const { width, height, data } = png;
  const counts = new Map();
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (width * y + x) << 2;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let bestKey = 0;
  let best = -1;
  for (const [k, c] of counts) {
    if (c > best) {
      best = c;
      bestKey = k;
    }
  }
  return [((bestKey >> 8) & 15) * 16 + 8, ((bestKey >> 4) & 15) * 16 + 8, (bestKey & 15) * 16 + 8];
}

function inkMask(png, paper) {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  const [pr, pg, pb] = paper;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const dr = data[i] - pr;
      const dg = data[i + 1] - pg;
      const db = data[i + 2] - pb;
      if (dr * dr + dg * dg + db * db > DELTA * DELTA) mask[width * y + x] = 1;
    }
  }
  return mask;
}

/* Find the text columns, so one short column on an otherwise full page is still
 * caught.
 *
 * Two things defeat the naive "look for empty vertical gutters" approach, and
 * both are present in this paper. Gutters carry printed column RULES, so they
 * are not empty; and full-width furniture (banner headlines, section heads,
 * footer rules) puts ink in every x-position if you scan the whole page height.
 * So: scan only the lower part of the body band, where the columns actually
 * run, and judge each x by ink DENSITY rather than presence. A hairline rule
 * comes out as its own very narrow band and is dropped by the width filter. */
function bandsInWindow(mask, width, r0, r1) {
  const rh = r1 - r0;
  const minGutter = Math.max(3, Math.round(0.04 * DPI));
  const minBand = Math.round(0.6 * DPI);
  const thresh = Math.max(2, Math.round(rh * 0.015));

  const dense = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = r0; y < r1; y++) if (mask[width * y + x]) n++;
    dense[x] = n >= thresh ? 1 : 0;
  }

  const runs = [];
  let start = null;
  for (let x = 0; x <= width; x++) {
    const on = x === width ? 0 : dense[x];
    if (on && start === null) start = x;
    if (!on && start !== null) {
      runs.push([start, x]);
      start = null;
    }
  }

  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run[0] - prev[1] < minGutter) prev[1] = run[1];
    else merged.push([...run]);
  }
  return merged.filter(([a, b]) => b - a >= minBand);
}

/* Find the text columns, so one short column on an otherwise full page is still
 * caught.
 *
 * Three things defeat naive gutter-hunting, and all three occur in this paper.
 * Gutters carry printed column RULES, so they are not empty. Full-width
 * furniture (banner headlines, notice boxes, footer rules) puts ink at every
 * x-position if you scan the whole page height. And — the one that matters most
 * — a column that has run DRY has no ink to find, so scanning a single band
 * silently drops it and the page then scores as if that column did not exist,
 * which is precisely the defect being measured.
 *
 * So: sample several horizontal windows and keep whichever yields the most
 * columns. A window crossing full-width furniture yields one band and loses; a
 * window where every column still has copy yields the true count and wins. */
function columnBands(mask, width, y0, y1) {
  const h = y1 - y0;
  const windows = [
    [y0, y0 + Math.floor(h * 0.35)],
    [y0 + Math.floor(h * 0.15), y0 + Math.floor(h * 0.5)],
    [y0 + Math.floor(h * 0.3), y0 + Math.floor(h * 0.7)],
    [y0 + Math.floor(h * 0.45), y1],
    [y0, y1],
  ];
  let best = [];
  for (const [a, b] of windows) {
    if (b - a < DPI * 0.5) continue;
    const bands = bandsInWindow(mask, width, a, b);
    if (bands.length > best.length) best = bands;
  }
  if (!best.length) return [[0, width]];

  /* A column that is empty from top to bottom prints no ink anywhere, so no
   * window can find it — and a page that simply stops two thirds of the way
   * across would otherwise score as a full page with fewer columns. That is the
   * single worst thing this tool could get wrong, so recover the grid instead
   * of trusting the ink: take the pitch of the columns that DID show up and
   * extrapolate across the content box, mirroring the left margin to find the
   * right edge. */
  if (best.length >= 2) {
    const bandW = best[0][1] - best[0][0];
    const pitch = best[1][0] - best[0][0];
    const contentRight = width - best[0][0];
    const slop = Math.round(0.06 * DPI);
    let next = best[best.length - 1][0] + pitch;
    while (next + bandW <= contentRight + slop && best.length < 12) {
      best.push([next, Math.min(next + bandW, width)]);
      next += pitch;
    }
  }
  return best;
}

/* Ink bounding box over the whole page, as insets from each edge. This is the
 * "white margins, and then margins again to the text" complaint, measured:
 * if these numbers disagree page to page, or disagree with the CSS/Typst
 * margin that was asked for, the frame is being applied more than once. */
function inkBox(mask, width, height) {
  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    let rowHit = false;
    for (let x = 0; x < width; x++) {
      if (!mask[width * y + x]) continue;
      rowHit = true;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (rowHit) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (top === -1) return null;
  return {
    top: top / DPI,
    bottom: (height - 1 - bottom) / DPI,
    left: left / DPI,
    right: (width - 1 - right) / DPI,
  };
}

function lastInkRow(mask, width, x0, x1, y0, y1) {
  const floor = Math.max(2, Math.round((x1 - x0) * 0.004));
  for (let y = y1 - 1; y >= y0; y--) {
    let n = 0;
    for (let x = x0; x < x1; x++) {
      if (mask[width * y + x]) n++;
      if (n > floor) return y;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- measure

const rows = [];
let worst = 0;
let busted = 0;

for (let p = 0; p < pages.length; p++) {
  const png = PNG.sync.read(fs.readFileSync(pages[p]));
  const paper = paperColour(png);
  const mask = inkMask(png, paper);
  const y0 = Math.round(TOP * DPI);
  const y1 = png.height - Math.round(BOT * DPI);
  const bands = columnBands(mask, png.width, y0, y1);

  let pageWorst = 0;
  let pageWorstCol = 0;
  let blank = 0;
  if (argv.includes('--bands')) {
    console.log(
      `  [bands] p${p + 1}: ` +
        bands.map(([a, b]) => `${(a / DPI).toFixed(2)}-${(b / DPI).toFixed(2)}in`).join('  ')
    );
  }
  bands.forEach(([x0, x1], ci) => {
    const last = lastInkRow(mask, png.width, x0, x1, y0, y1);
    const slackIn = last === -1 ? (y1 - y0) / DPI : (y1 - last) / DPI;
    if (last === -1) blank++;
    if (slackIn > pageWorst) {
      pageWorst = slackIn;
      pageWorstCol = ci + 1;
    }
  });

  const ok = pageWorst <= TOL;
  if (!ok) busted++;
  if (pageWorst > worst) worst = pageWorst;
  rows.push({
    page: p + 1,
    cols: bands.length,
    slack: pageWorst,
    col: pageWorstCol,
    blank,
    ok,
    box: inkBox(mask, png.width, png.height),
    trim: [png.width / DPI, png.height / DPI],
  });
}

// ---------------------------------------------------------------- duplicates

/* A repeated brief shows up as a run of consecutive identical lines appearing
 * on two different pages. Running heads and folios are single lines, so a
 * two-line minimum separates real duplication from page furniture. */
function duplicateBlocks() {
  let txt;
  try {
    txt = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    return [];
  }
  const perPage = txt.split('\f');
  const seen = new Map();
  perPage.forEach((page, pi) => {
    page
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase())
      .forEach((line, li) => {
        if (line.length < 25) return;
        if (!seen.has(line)) seen.set(line, []);
        seen.get(line).push({ page: pi + 1, line: li });
      });
  });

  const hits = [];
  perPage.forEach((page, pi) => {
    const lines = page.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
    let run = null;
    for (let li = 0; li <= lines.length; li++) {
      const norm = (lines[li] || '').toLowerCase();
      const others = (seen.get(norm) || []).filter((h) => h.page !== pi + 1);
      if (norm.length >= 25 && others.length) {
        /* Intersect, don't union. A run may contain one line that also happens
         * to appear elsewhere; only pages carrying EVERY line of the run are
         * really printing this block twice. */
        const here = new Set(others.map((o) => o.page));
        if (!run) run = { from: li, pages: here, text: [] };
        else run.pages = new Set([...run.pages].filter((p) => here.has(p)));
        run.text.push(lines[li]);
      } else if (run) {
        if (run.text.length >= 2 && run.pages.size) {
          hits.push({
            page: pi + 1,
            also: [...run.pages].sort((a, b) => a - b),
            lines: run.text.length,
            sample: run.text[0].slice(0, 58),
          });
        }
        run = null;
      }
    }
  });
  // one entry per duplicated block, keyed on its first appearance
  const uniq = new Map();
  hits.forEach((h) => {
    const key = h.sample.toLowerCase();
    if (!uniq.has(key) || uniq.get(key).page > h.page) uniq.set(key, h);
  });
  return [...uniq.values()].sort((a, b) => a.page - b.page);
}

const dupes = duplicateBlocks();

// ---------------------------------------------------------------- report

const name = path.basename(pdf);
console.log(`\n  ${name} — ${pages.length} pages @ ${DPI}dpi, tolerance ${TOL}in\n`);
for (const r of rows) {
  const bar = r.ok ? 'FIT ' : 'SLACK';
  const detail =
    r.blank > 0
      ? `${r.slack.toFixed(2)}in  (${r.blank} blank column${r.blank > 1 ? 's' : ''} of ${r.cols})`
      : `${r.slack.toFixed(2)}in  (col ${r.col} of ${r.cols})`;
  console.log(
    `  p${String(r.page).padStart(2)}  ${bar}  ${detail}${r.ok ? '' : '   <-- busts tolerance'}`
  );
}

// margins ------------------------------------------------------------

const boxed = rows.filter((r) => r.box);
if (boxed.length) {
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const m = {
    top: med(boxed.map((r) => r.box.top)),
    bottom: med(boxed.map((r) => r.box.bottom)),
    left: med(boxed.map((r) => r.box.left)),
    right: med(boxed.map((r) => r.box.right)),
  };
  const [tw, th] = rows[0].trim;
  console.log(
    `\n  MARGINS — trim ${tw.toFixed(2)} x ${th.toFixed(2)}in · ` +
      `typical T ${m.top.toFixed(2)} B ${m.bottom.toFixed(2)} ` +
      `L ${m.left.toFixed(2)} R ${m.right.toFixed(2)}in`
  );
  const off = boxed.filter(
    (r) =>
      Math.abs(r.box.top - m.top) > 0.1 ||
      Math.abs(r.box.bottom - m.bottom) > 0.1 ||
      Math.abs(r.box.left - m.left) > 0.1 ||
      Math.abs(r.box.right - m.right) > 0.1
  );
  if (off.length) {
    console.log(`  inconsistent on ${off.length} page(s):`);
    for (const r of off.slice(0, 12)) {
      console.log(
        `    p${String(r.page).padStart(2)}  T ${r.box.top.toFixed(2)} ` +
          `B ${r.box.bottom.toFixed(2)} L ${r.box.left.toFixed(2)} R ${r.box.right.toFixed(2)}`
      );
    }
  } else {
    console.log('  consistent across all pages');
  }
}

if (dupes.length) {
  console.log(`\n  DUPLICATED BLOCKS — ${dupes.length} found\n`);
  for (const d of dupes) {
    console.log(`  p${d.page} also on p${d.also.join(', p')}  (${d.lines} lines)  "${d.sample}..."`);
  }
} else {
  console.log('\n  duplicated blocks: none');
}

console.log(
  `\n  worst slack ${worst.toFixed(2)}in · ${busted} page(s) over tolerance · ${dupes.length} duplicate block(s)\n`
);
process.exit(busted || dupes.length ? 1 : 0);
