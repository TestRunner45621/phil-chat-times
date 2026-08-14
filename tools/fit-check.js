#!/usr/bin/env node
'use strict';
/*
 * fit-check.js — DOM-side layout check for the HTML build.
 *
 * slack.js reads the finished PDF and cannot see what was thrown away. This
 * reads the live DOM in the SAME Chrome that writes the PDF, and catches the
 * things that are invisible once printed:
 *
 *   - CLIPPED pages. With `overflow: hidden` on a fixed-size page, copy that
 *     doesn't fit is silently eaten rather than spilled. This is the check that
 *     makes the fixed-canvas approach safe to use at all.
 *   - DUPLICATE blocks across pages (Vol. III printed 37 of them).
 *   - Images escaping their column.
 *   - Printed folio disagreeing with actual page position (Vol. III's
 *     "PAGE 10" was the 19th sheet).
 *
 *   node fit-check.js issue.html
 *
 * Exit code 1 on any finding.
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const file = process.argv[2];
if (!file) {
  console.error('usage: node fit-check.js <file.html>');
  process.exit(2);
}
if (!fs.existsSync(CHROME)) {
  console.error(`fit-check: Chrome not found at ${CHROME}`);
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
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const pages = [...document.querySelectorAll('.page')];

    const out = pages.map((el, i) => {
      /* Overflow hides in two directions here. A normal block overflows
       * DOWNWARD (scrollHeight), but a multi-column box overflows SIDEWAYS —
       * it just makes another column off the right edge, which `overflow:
       * hidden` then eats in complete silence. Check both, on the page and on
       * every clipping box inside it. */
      const clippers = [el, ...el.querySelectorAll('*')].filter((n) => {
        const o = getComputedStyle(n);
        return /hidden|clip/.test(o.overflow + o.overflowX + o.overflowY);
      });
      let clip = 0;
      let clipWho = '';
      for (const n of clippers) {
        const dv = n.scrollHeight - n.clientHeight;
        const dh = n.scrollWidth - n.clientWidth;
        const d = Math.max(dv, dh);
        if (d > clip) {
          clip = d;
          clipWho =
            (n.className ? '.' + String(n.className).split(' ')[0] : n.tagName.toLowerCase()) +
            (dh > dv ? ' (sideways — extra column)' : '');
        }
      }

      // deepest content bottom relative to the page's padding box
      const pr = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const padB = parseFloat(cs.paddingBottom) || 0;
      let deepest = 0;
      el.querySelectorAll('*').forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.height && r.bottom - pr.top > deepest) deepest = r.bottom - pr.top;
      });
      const slackPx = pr.height - padB - deepest;

      const imgBad = [];
      el.querySelectorAll('img').forEach((img) => {
        const ir = img.getBoundingClientRect();
        const par = img.parentElement.getBoundingClientRect();
        if (ir.right - par.right > 1 || par.left - ir.left > 1) {
          imgBad.push(img.getAttribute('src') || '(inline)');
        }
      });

      const blocks = [...el.querySelectorAll('.brief, .box, .article, article, aside')]
        .map((b) => norm(b.textContent))
        .filter((t) => t.length > 40);

      const folioEl = el.querySelector('.folio, [data-folio]');
      const folioTxt = folioEl ? norm(folioEl.textContent) : '';
      const m = folioTxt.match(/(\d+)\s*$/);

      return {
        n: i + 1,
        clip,
        clipWho,
        slackPx,
        h: pr.height,
        imgBad,
        blocks,
        folio: m ? parseInt(m[1], 10) : null,
      };
    });

    return { count: pages.length, out };
  });

  await browser.close();

  if (!report.count) {
    console.error('fit-check: no .page elements found — is this a fixed-canvas build?');
    process.exit(2);
  }

  // duplicates across pages
  const where = new Map();
  report.out.forEach((p) => {
    new Set(p.blocks).forEach((b) => {
      const k = b.slice(0, 120).toLowerCase();
      if (!where.has(k)) where.set(k, { sample: b.slice(0, 58), pages: [] });
      where.get(k).pages.push(p.n);
    });
  });
  const dupes = [...where.values()].filter((d) => d.pages.length > 1);

  let bad = 0;
  console.log(`\n  ${path.basename(file)} — ${report.count} pages\n`);
  for (const p of report.out) {
    const flags = [];
    if (p.clip > 1) {
      flags.push(`CLIPPED +${Math.round(p.clip)}px on ${p.clipWho}`);
      bad++;
    }
    if (p.slackPx < -1) {
      flags.push(`OVERFULL ${(-p.slackPx / 96).toFixed(2)}in past the bottom margin`);
      bad++;
    }
    if (p.imgBad.length) {
      flags.push(`IMG overflows (${p.imgBad.length})`);
      bad++;
    }
    if (p.folio !== null && p.folio !== p.n) {
      flags.push(`folio says ${p.folio}`);
      bad++;
    }
    const slackIn = (p.slackPx / 96).toFixed(2);
    console.log(
      `  p${String(p.n).padStart(2)}  slack ${slackIn.padStart(5)}in  ` +
        (flags.length ? '<-- ' + flags.join(' · ') : 'ok')
    );
  }

  if (dupes.length) {
    bad += dupes.length;
    console.log(`\n  DUPLICATE BLOCKS — ${dupes.length}\n`);
    dupes.forEach((d) => console.log(`  pages ${d.pages.join(', ')}  "${d.sample}..."`));
  } else {
    console.log('\n  duplicate blocks: none');
  }

  console.log(`\n  ${bad ? bad + ' finding(s)' : 'clean'}\n`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('fit-check failed:', e.message);
  process.exit(2);
});
