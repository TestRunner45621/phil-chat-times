#!/usr/bin/env node
'use strict';
/*
 * fill.js — the ragged-bottom meter.
 *
 * fit-check.js cannot see dead space. It measures
 *   pageHeight - paddingBottom - deepestContentBottom
 * and every page here lays its body out in a full-height CSS grid, so
 * SOMETHING always reaches the bottom and the answer is structurally 0.00in on
 * every page — including pages that are visibly forty per cent empty.
 *
 * slack.js measures the right thing off the rasterised PDF, but this paper
 * prints full-height column RULES, which put ink on every scanline of every
 * band and defeat its lastInkRow floor.
 *
 * So measure it in the DOM instead. For each flow box, find the deepest leaf
 * and report the gap between it and the bottom of the box. Because .story uses
 * column-fill:auto, copy fills each column to the foot in sequence, so the
 * deepest leaf is by definition in the last column in use and this gap IS the
 * ragged bottom.
 *
 *   node fill.js <issue.html> [--tol 0.35] [--all]
 *
 * Exit code 1 if any box is short by more than the tolerance.
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? dflt : parseFloat(argv[i + 1]);
};
const TOL = opt('tol', 0.35);
const ALL = argv.includes('--all');

if (!file) {
  console.error('usage: node fill.js <file.html> [--tol in] [--all]');
  process.exit(2);
}
if (!fs.existsSync(CHROME)) {
  console.error(`fill: Chrome not found at ${CHROME}`);
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), {
    waitUntil: 'networkidle0',
  });

  const report = await page.evaluate(() => {
    const IN = 96;

    /* Per-COLUMN deepest painted edge.
     *
     * The naive version of this — one maximum over the whole box — is worse
     * than useless here. column-fill:auto fills column 1 to the foot before it
     * starts column 2, so column 1 always touches the bottom and the box-wide
     * maximum reports a full page while the last column sits half empty. That
     * is exactly the defect being hunted. So bucket every painted rect into its
     * column by x, and measure each column's own foot.
     *
     * Walk elements and text runs both: a bare text node at the foot of a
     * column has no element of its own, and missing it overstates the gap. */
    function columnFeet(box, cols, gapPx) {
      const br = box.getBoundingClientRect();
      const colW = (br.width - (cols - 1) * gapPx) / cols;
      const pitch = colW + gapPx;
      const feet = new Array(cols).fill(-Infinity);

      const push = (r) => {
        if (!r || r.height <= 0.5 || r.width <= 0.5) return;
        // a rule or box spanning several columns belongs to the last it touches
        let ci = Math.floor((r.left - br.left + gapPx * 0.5) / pitch);
        if (ci < 0) ci = 0;
        if (ci > cols - 1) ci = cols - 1;
        if (r.bottom > feet[ci]) feet[ci] = r.bottom;
      };

      box.querySelectorAll('*').forEach((n) => push(n.getBoundingClientRect()));
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) push(r);
      }
      return feet;
    }

    const label = (n) => {
      const c = String(n.className || '').trim().split(/\s+/).filter(Boolean);
      return c.length ? '.' + c.slice(0, 2).join('.') : n.tagName.toLowerCase();
    };

    return [...document.querySelectorAll('.page')].map((pg, i) => {
      /* Every box copy actually flows into. .rail is a flex column, so its own
       * height is content height — measure its PARENT cell instead, which is
       * the grid track it was given and the space it was meant to fill. */
      const boxes = [];
      pg.querySelectorAll('.story, .index-body, .stack > .grow, .rail').forEach((n) =>
        boxes.push(n)
      );
      /* Grid cells are flow boxes too. A .row3 or a .g-third region stretches
       * every cell to the height of the tallest, so a short cell is dead space
       * even though nothing about it overflows. */
      pg.querySelectorAll('.row3, .region.g-third, .region.g-half').forEach((grid) => {
        [...grid.children].forEach((cell) => {
          if (!cell.matches('.story, .rail, .stack')) boxes.push(cell);
        });
      });

      const rows = [];
      for (const b of boxes) {
        const br = b.getBoundingClientRect();
        if (br.height < IN) continue; // furniture, not a flow box

        const cs = getComputedStyle(b);
        const cols = parseInt(cs.columnCount, 10) || 1;
        const gapPx = parseFloat(cs.columnGap) || 0;

        /* A .rail and a grid cell both size to their content, so their own
         * rects never show a gap. The track they sit in is the space they were
         * meant to fill. */
        const shrinks = b.classList.contains('rail') || !b.matches('.story, .grow, .index-body');
        const floorPx = shrinks ? b.parentElement.getBoundingClientRect().bottom : br.bottom;

        const feet = columnFeet(b, cols, gapPx);
        const used = feet.map((f) => f !== -Infinity);
        const lastUsed = used.lastIndexOf(true);
        const emptyCols = cols - 1 - lastUsed; // trailing columns with nothing in them

        // gap at the foot of the last column that carries copy
        const tailGap = lastUsed === -1 ? br.height : floorPx - feet[lastUsed];
        /* A break-inside:avoid block that will not fit at the foot of column 1
         * jumps to column 2 and leaves a hole behind it. That hole is dead
         * space on the printed page just as surely as a short last column, and
         * a last-column-only measure never sees it. Take the worst gap over
         * every column that carries copy. */
        let holeGap = 0;
        let holeCol = 0;
        for (let c = 0; c < lastUsed; c++) {
          if (!used[c]) continue;
          const g = floorPx - feet[c];
          if (g > holeGap) {
            holeGap = g;
            holeCol = c + 1;
          }
        }
        // total dead area, in column-inches: the tail plus every empty column
        const dead = (Math.max(tailGap, holeGap) + emptyCols * br.height) / IN;

        /* If the box overflows sideways, "trim until it clears" is blind
         * guesswork: the reported overflow is one fixed column width however
         * much is actually over, so nothing changes until a threshold is
         * crossed. Measure the real figure instead.
         *
         * Not by adding a column — that narrows every column and reflows the
         * whole box, which measures a different layout. Instead lay the same
         * copy out ONCE, in a single column of the SAME width, off-screen. Its
         * natural height minus (columns x column height) is the true spill, and
         * spill x chars-per-inch is the trim. Slightly optimistic, because it
         * cannot model the lines a break-inside:avoid block wastes at a column
         * foot, so treat the number as a floor. */
        let spill = 0;
        let spillWho = '';
        if (b.scrollWidth - b.clientWidth > 1 && cols > 1) {
          /* The overflow column is really there, just clipped — so measure it
           * directly rather than modelling it. Anything whose left edge is at
           * or past the right edge of the box is in a column the reader will
           * never see. Walk text runs as well as elements: a bare text node in
           * the hidden column has no element of its own, and it is usually the
           * thing that tipped the page over. */
          let foot = -Infinity;
          let who = null;
          const probe = (r, node) => {
            if (!r || r.height <= 0.5 || r.width <= 0.5) return;
            if (r.left < br.right - 1) return;
            if (r.bottom > foot) {
              foot = r.bottom;
              who = node;
            }
          };
          b.querySelectorAll('*').forEach((n) => probe(n.getBoundingClientRect(), n));
          const w2 = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
          const rg = document.createRange();
          for (let n = w2.nextNode(); n; n = w2.nextNode()) {
            if (!n.nodeValue.trim()) continue;
            rg.selectNodeContents(n);
            for (const r of rg.getClientRects()) probe(r, n.parentElement);
          }
          if (foot > -Infinity) {
            spill = (foot - br.top) / IN;
            spillWho = who ? label(who) + ': ' + who.textContent.replace(/\s+/g, ' ').trim().slice(0, 44) : '';
          }
        }

        rows.push({
          who: label(b),
          gap: dead,
          tail: tailGap / IN,
          emptyCols,
          cols,
          spill,
          spillWho,
          hole: holeGap / 96,
          holeCol,
          h: br.height / IN,
          chars: b.textContent.replace(/\s+/g, ' ').trim().length,
        });
      }
      return { n: i + 1, rows };
    });
  });

  await browser.close();

  let bad = 0;
  console.log(`\n  ${path.basename(file)} — ragged-bottom meter, tolerance ${TOL.toFixed(2)}in\n`);

  for (const p of report) {
    const over = p.rows.filter((r) => r.gap > TOL || r.spill > 0);
    if (over.length) bad += over.length;
    if (!over.length && !ALL) continue;
    const worst = p.rows.reduce((a, r) => (r.gap > a ? r.gap : a), 0);
    const detail = (ALL ? p.rows : over)
      .map((r) => {
        const dens = r.h && r.chars ? Math.round(r.chars / r.h) : 0;
        if (r.spill > 0) {
          // spill is in COLUMN-inches, so the density must be per column-inch too
          const perIn = r.h ? r.chars / (r.h * r.cols) : 0;
          return (
            `${r.who} SPILLS ${r.spill.toFixed(2)}in past its last column ` +
            `— cut about ${Math.ceil((r.spill * perIn) / 50) * 50} chars ` +
            (r.hole > 0.35
              ? `, but first close the ${r.hole.toFixed(2)}in HOLE at the foot of col ${r.holeCol} ` +
                `(a break-inside:avoid block jumping) `
              : '') +
            `(c${r.cols}, ${r.chars} ch, ${dens}/in)` + (r.spillWho ? `
            last in the hidden column: ${r.spillWho}` : '')
          );
        }
        return (
          `${r.who} dead ${r.gap.toFixed(2)}in` +
          (r.emptyCols ? ` [${r.emptyCols} EMPTY col]` : '') +
          (r.hole > 0.35 ? ` [HOLE ${r.hole.toFixed(2)}in at foot of col ${r.holeCol}]` : '') +
          ` (c${r.cols}, tail ${r.tail.toFixed(2)}in, ${r.chars} ch, ${dens}/in)`
        );
      })
      .join('   ');
    console.log(
      `  p${String(p.n).padStart(2)}  worst ${worst.toFixed(2)}in  ` +
        (over.length ? '<-- ' : '    ') +
        detail
    );
  }

  if (!bad) console.log('  every flow box fills to within tolerance');
  console.log(`\n  ${bad ? bad + ' short box(es)' : 'clean'}\n`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('fill failed:', e.message);
  process.exit(2);
});
