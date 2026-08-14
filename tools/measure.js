#!/usr/bin/env node
'use strict';
/* measure.js <file.html> — per-page region geometry, so copyfitting stops being a guess. */
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.goto('file:///' + path.resolve(file).replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  const rows = await page.evaluate(() => {
    const px2in = (v) => (v / 96).toFixed(2);
    return [...document.querySelectorAll('.page')].map((el, i) => {
      const reg = el.querySelector('.region');
      const st = el.querySelector('.story');
      const rail = el.querySelector('.rail');
      const o = { n: i + 1 };
      if (reg) { o.regionH = px2in(reg.clientHeight); }
      if (st) {
        o.storyH = px2in(st.clientHeight);
        o.storyW = px2in(st.clientWidth);
        o.overW = st.scrollWidth - st.clientWidth;
        const cols = getComputedStyle(st).columnCount;
        o.cols = cols;
        o.chars = st.textContent.replace(/\s+/g, ' ').trim().length;
      }
      if (rail) { o.railH = px2in(rail.scrollHeight); }
      return o;
    });
  });
  await browser.close();
  rows.forEach((r) => console.log(JSON.stringify(r)));
})().catch((e) => { console.error(e.message); process.exit(1); });
