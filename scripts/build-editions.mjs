#!/usr/bin/env node
/*
 * build-editions.mjs — ingest the Past Editions folder into the site.
 *
 *   node scripts/build-editions.mjs [--source "<path to Past Editions>"] [--force]
 *
 * For every "Vol <roman> No <n> - <yyyy-mm-dd>" folder that contains a PDF it:
 *   - copies the PDF to editions/<slug>/edition.pdf
 *   - renders page 1 to a cover JPEG and a small thumb
 *   - records page count, page size and the front-page headline
 * and writes the lot to editions.json, which the site reads at runtime.
 *
 * Rendering happens in headless Chrome against the vendored pdf.js build (see
 * render-cover.html) so covers come out of exactly the renderer the site uses.
 * Editions still in production — no PDF yet — are skipped, so re-running this
 * once a new issue ships is all it takes to publish it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i === -1 ? dflt : args[i + 1];
};
const FORCE = args.includes('--force');
const SOURCE = path.resolve(
  argOf('--source', 'C:/Users/John/Desktop/Phil Chat Times X-Effort/Past Editions')
);
const CHROME =
  argOf('--chrome', null) ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((p) => fs.existsSync(p));

const SIZES = { cover: 1000, thumb: 320 }; // px wide
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

/** "Vol I No 3 - 2026-07-30" -> { volume: 1, number: 3, date: "2026-07-30" } */
function parseFolder(name) {
  const m = name.match(/^Vol\s+([IVX]+)\s+No\s+(\d+)\s*-\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const volume = ROMAN[m[1].toUpperCase()];
  if (!volume) return null;
  return { volume, romanVolume: m[1].toUpperCase(), number: Number(m[2]), date: m[3] };
}

/*
 * Some edition folders hold more than one PDF (a first cut and a revision).
 * Prefer the one that looks final — "-v2" beats the bare name — and fall back
 * to the most recently modified file.
 */
function pickPdf(dir) {
  const pdfs = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => {
      const full = path.join(dir, f);
      return {
        file: f,
        full,
        rev: Number((f.match(/-v(\d+)\.pdf$/i) || [])[1] || 1),
        mtime: fs.statSync(full).mtimeMs,
      };
    });
  if (!pdfs.length) return null;
  pdfs.sort((a, b) => b.rev - a.rev || b.mtime - a.mtime);
  return pdfs[0];
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`source folder not found: ${SOURCE}`);
    process.exit(2);
  }
  if (!CHROME) {
    console.error('could not find Chrome; pass --chrome "<path to chrome.exe>"');
    process.exit(2);
  }

  const folders = fs
    .readdirSync(SOURCE, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, meta: parseFolder(e.name) }))
    .filter((e) => e.meta);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  const harness =
    'file:///' + path.join(ROOT, 'scripts/render-cover.html').replace(/\\/g, '/');
  await page.goto(harness, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.harnessReady === true', { timeout: 20000 });

  const editions = [];
  const skipped = [];

  for (const { name, meta } of folders) {
    const pdf = pickPdf(path.join(SOURCE, name));
    if (!pdf) {
      // Written but not yet printed — the archive shows it as a placeholder.
      skipped.push({
        volume: meta.volume,
        romanVolume: meta.romanVolume,
        number: meta.number,
        date: meta.date,
        title: `Vol ${meta.romanVolume} No ${meta.number}`,
      });
      continue;
    }

    const slug = `vol-${meta.volume}-no-${meta.number}`;
    const outDir = path.join(ROOT, 'editions', slug);
    fs.mkdirSync(outDir, { recursive: true });

    const destPdf = path.join(outDir, 'edition.pdf');
    const srcStat = fs.statSync(pdf.full);
    const changed =
      FORCE ||
      !fs.existsSync(destPdf) ||
      fs.statSync(destPdf).size !== srcStat.size ||
      !fs.existsSync(path.join(outDir, 'cover.jpg'));
    if (changed) fs.copyFileSync(pdf.full, destPdf);

    const bytes = [...fs.readFileSync(destPdf)];
    const info = await page.evaluate(
      (b, sizes) => window.renderEdition(b, sizes),
      bytes,
      SIZES
    );

    if (changed) {
      for (const [key, b64] of Object.entries(info.images)) {
        fs.writeFileSync(path.join(outDir, `${key}.jpg`), Buffer.from(b64, 'base64'));
      }
    }

    editions.push({
      slug,
      volume: meta.volume,
      romanVolume: meta.romanVolume,
      number: meta.number,
      date: meta.date,
      title: `Vol ${meta.romanVolume} No ${meta.number}`,
      headline: info.headline,
      pages: info.pages,
      width: info.width,
      height: info.height,
      pdf: `editions/${slug}/edition.pdf`,
      cover: `editions/${slug}/cover.jpg`,
      thumb: `editions/${slug}/thumb.jpg`,
      bytes: srcStat.size,
      sourceFile: pdf.file,
    });

    console.log(
      `  ${slug.padEnd(12)} ${String(info.pages).padStart(2)}pp  ` +
        `${info.width}x${info.height}pt  ${(srcStat.size / 1048576).toFixed(1)}MB` +
        `  <- ${pdf.file}`
    );
  }

  await browser.close();

  const sortByIssue = (a, b) => a.volume - b.volume || a.number - b.number;
  editions.sort(sortByIssue);
  skipped.sort(sortByIssue);

  fs.writeFileSync(
    path.join(ROOT, 'editions.json'),
    JSON.stringify(
      {
        title: 'The Phil Chat Times',
        generated: new Date().toISOString(),
        editions,
        upcoming: skipped,
      },
      null,
      2
    ) + '\n'
  );

  console.log(`\nwrote editions.json — ${editions.length} edition(s)`);
  if (skipped.length) {
    console.log(
      `in production (no PDF yet): ${skipped.map((s) => s.title).join(', ')}`
    );
  }
}

main().catch((e) => {
  console.error('build-editions failed:', e);
  process.exit(1);
});
