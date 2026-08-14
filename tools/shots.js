#!/usr/bin/env node
'use strict';
/*
 * shots.js — render every .page of the issue to its own PNG.
 *
 *   node shots.js <issue.html> <outdir> [onlyPageNumber]
 *
 * Screenshots the element box in print media at 2x, so what you see in the PNG
 * is what the PDF gets. Named page-01.png, page-02.png, ...
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const outdir = process.argv[3] || '.';
const only = process.argv[4] ? parseInt(process.argv[4], 10) : null;

if (!file) { console.error('usage: node shots.js <file.html> <outdir> [pageNo]'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
    defaultViewport: { width: 816, height: 1056, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

  const n = await page.$$eval('.page', (els) => els.length);
  const els = await page.$$('.page');
  const written = [];
  for (let i = 0; i < els.length; i++) {
    if (only && i + 1 !== only) continue;
    const name = 'page-' + String(i + 1).padStart(2, '0') + '.png';
    await els[i].screenshot({ path: path.join(outdir, name) });
    written.push(name);
  }
  await browser.close();
  console.log(`${n} page(s) in document; wrote ${written.length}: ${written.join(', ')}`);
})().catch((e) => { console.error('shots failed:', e.message); process.exit(1); });
