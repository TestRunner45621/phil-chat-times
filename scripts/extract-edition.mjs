#!/usr/bin/env node
/**
 * extract-edition.mjs — extract text from an edition PDF into structured markdown.
 *
 *   node scripts/extract-edition.mjs [--slug vol-1-no-3] [--all] [--force]
 *
 * The paper is a broadsheet: banner headlines that span the page, articles laid
 * out in columns beneath them, boxes and briefs sitting in the gaps. Reading it
 * back out of the PDF is a layout problem before it is a text problem, because
 * pdf.js hands over text items in content-stream order, which is not reading
 * order.
 *
 * So: segment each page into blocks by recursive XY-cut (project the text boxes
 * onto each axis, cut at the widest run of whitespace, recurse), peeling
 * full-width banner rows off the top of a block first so the columns underneath
 * them become visible to the projection. Then assemble lines inside each block,
 * where the geometry is finally simple enough that x-order and y-order mean what
 * they look like they mean.
 *
 * Output: editions/<slug>/edition.md with YAML frontmatter from editions.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// pdfjs-dist setup for Node — Windows needs file:// URLs for dynamic imports
const pdfjsPath = path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const pdfjsLib = await import(pathToFileURL(pdfjsPath).href);

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ALL = args.includes('--all');
const slugArg = (() => {
  const i = args.indexOf('--slug');
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) {
    console.error('--slug needs an edition slug, e.g. --slug vol-1-no-3');
    process.exit(1);
  }
  return v;
})();

// ---------------------------------------------------------------- manifest

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'editions.json'), 'utf-8'));

// ---------------------------------------------------------------- tuning
//
// Everything here is a multiple of the page's median font size, so a page set
// at 8.6pt and one set at 11pt get the same treatment.

const TUNING = {
  gutterX: 0.6, // min width of a vertical gutter, to cut columns apart
  gutterY: 0.7, // min height of a horizontal band, to cut blocks apart
  rowTol: 0.4, // baselines within this are the same line
  wordGap: 0.18, // gap above which two items are separate words
  bannerMaxRows: 14, // never peel more than this many rows as one banner
  paraGap: 1.45, // line-to-line jump this much of the leading starts a paragraph
  dropCap: 2.2, // an initial this much larger than the leaf is a drop cap
  h1: 2.0, // font size ratios against the page median, for heading levels
  h2: 1.5,
  h3: 1.2,
  sizeBand: 0.2, // headline rows within this of each other are one heading
  indentMin: 0.4, // first-line indent, in ems, that starts a paragraph
  indentMax: 2.5, // deeper than this is drop-cap wrap, not an indent
  crossheadFill: 0.92, // an all-caps line filling less than this of the measure
  crossRows: 0.25, // share of rows that may cross a band and it still be a gutter
};

// ---------------------------------------------------------------- geometry

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function extentOf(items) {
  return {
    x0: Math.min(...items.map((i) => i.x0)),
    x1: Math.max(...items.map((i) => i.x1)),
    y0: Math.min(...items.map((i) => i.y0)),
    y1: Math.max(...items.map((i) => i.y1)),
  };
}

/**
 * The widest run of whitespace across `items` on one axis, ignoring runs that
 * touch the edges of the block. Returns null if nothing is wide enough.
 *
 * This is a projection profile: paint every item's extent onto a 1pt-per-cell
 * strip, then look for the gaps. A gutter between two columns shows up as a run
 * of cells no item touches, because it has to be clear on every single line for
 * the whole height of the block — which is exactly what makes it a gutter and
 * not just a wide word space on one line.
 */
function widestGap(items, axis, minGap) {
  const lo = axis === 'x' ? 'x0' : 'y0';
  const hi = axis === 'x' ? 'x1' : 'y1';
  const start = Math.floor(Math.min(...items.map((i) => i[lo])));
  const end = Math.ceil(Math.max(...items.map((i) => i[hi])));
  if (end - start < minGap) return null;

  const occupied = new Uint8Array(end - start + 2);
  for (const item of items) {
    const a = Math.max(0, Math.floor(item[lo] - start));
    const b = Math.min(occupied.length - 1, Math.ceil(item[hi] - start));
    for (let k = a; k <= b; k++) occupied[k] = 1;
  }

  let best = null;
  let run = null;
  // k starts at 1 and stops short of the end so edge whitespace is never a cut
  for (let k = 1; k < occupied.length - 1; k++) {
    if (!occupied[k]) {
      if (run === null) run = k;
      continue;
    }
    if (run !== null && k - run >= minGap && (!best || k - run > best.width)) {
      best = { lo: run + start, hi: k - 1 + start, width: k - run };
    }
    run = null;
  }
  return best;
}

/** Group items into rows by baseline. */
function toRows(items, tol) {
  const rows = [];
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.base - item.base) < tol) row.items.push(item);
    else rows.push({ base: item.base, items: [item] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x0 - b.x0);
  return rows;
}

const rowWidth = (row) =>
  Math.max(...row.items.map((i) => i.x1)) - Math.min(...row.items.map((i) => i.x0));

/**
 * How many rows to peel off each end of this block to expose its columns.
 *
 * The things that lie across a set of columns — a headline, a deck, a byline, a
 * pull quote dropped in at the foot — are what hide the column structure from
 * the projection. The test is not "does this row look like a headline" but
 * "does removing it reveal a gutter", so peeling the fewest rows that expose a
 * vertical gap is both the definition and the stopping condition. Returns null
 * for a block with no such rows, which includes every ordinary single column of
 * body copy.
 *
 * A peeled row has to be one unbroken run of type. Every row of a four-column
 * article spans the block too — it is four lines, one per column, sharing a
 * baseline — and the gutter inside such a row is what tells the two apart. Note
 * that a spanning row need not be *wide*: a deck sets ragged and its last line
 * is often short, but it is still a single run of type lying across the columns.
 */
function spanTrim(items, cfg) {
  const rows = toRows(items, cfg.rowTol);
  if (rows.length < 4) return null;

  const box = extentOf(items);
  const start = Math.floor(box.x0);
  const width = Math.ceil(box.x1) - start;
  if (width < cfg.gutterX * 3) return null;

  // How many rows put ink on each column of the block. A gutter reads as a band
  // where this drops to nearly nothing — nearly, not exactly, because the
  // handful of rows lying across the columns are what we are trying to find.
  const cover = new Uint16Array(width + 2);
  const seen = new Uint8Array(width + 2);
  for (const row of rows) {
    seen.fill(0);
    for (const item of row.items) {
      const a = Math.max(0, Math.floor(item.x0 - start));
      const b = Math.min(width, Math.ceil(item.x1 - start));
      for (let k = a; k <= b; k++) seen[k] = 1;
    }
    for (let k = 0; k <= width; k++) if (seen[k]) cover[k]++;
  }

  // Work up from the strictest tolerance, so the fewest rows are treated as
  // spanning. The claim is only accepted when removing them leaves a gutter
  // that is genuinely empty, which is what stops this from finding "columns"
  // inside an ordinary single column of justified copy.
  const maxCross = Math.max(2, Math.round(rows.length * TUNING.crossRows));
  for (let tolerance = 0; tolerance <= maxCross; tolerance++) {
    let band = null;
    let run = null;
    for (let k = 1; k < width; k++) {
      if (cover[k] <= tolerance) {
        if (run === null) run = k;
        continue;
      }
      if (run !== null && k - run >= cfg.gutterX && (!band || k - run > band.width)) {
        band = { lo: run, hi: k - 1, width: k - run };
      }
      run = null;
    }
    if (!band) continue;

    // The rows crossing the band are the spanning ones. They only count as
    // spanning if they are unbroken runs of type — a row of four column-lines
    // crosses nothing, it stops at every gutter.
    const spans = rows.map(
      (row) =>
        row.items.some((i) => i.x1 - start > band.lo && i.x0 - start < band.hi) &&
        !widestGap(row.items, 'x', cfg.gutterX)
    );
    if (!spans.some(Boolean)) continue;

    const rest = rows.filter((_, k) => !spans[k]).flatMap((r) => r.items);
    if (rest.length < 8 || !widestGap(rest, 'x', cfg.gutterX)) continue;
    return spans;
  }
  return null;
}

/**
 * Segment a page into blocks, in reading order.
 *
 * Column cuts are taken in preference to horizontal ones. In a paper set in
 * columns a gutter runs the full height of the article, so cutting it first
 * keeps each column whole; cutting horizontally first would slice every column
 * at the same height and then interleave the halves, which is the failure that
 * turns a page of newsprint into word salad.
 */
function segment(items, cfg, depth = 0) {
  if (items.length <= 1 || depth > 16) return [items];

  const spans = spanTrim(items, cfg);
  if (spans) {
    // Split top to bottom: each spanning row stands alone, and the columns
    // between them are segmented on their own.
    const rows = toRows(items, cfg.rowTol);
    const parts = [];
    for (let k = 0; k < rows.length; k++) {
      const last = parts[parts.length - 1];
      if (last && last.spanning === spans[k]) last.rows.push(rows[k]);
      else parts.push({ spanning: spans[k], rows: [rows[k]] });
    }
    return parts.flatMap((part) =>
      segment(
        part.rows.flatMap((r) => r.items),
        cfg,
        depth + 1
      )
    );
  }

  const rows = toRows(items, cfg.rowTol);
  // A block of one or two lines is a headline, not a column layout. Projecting
  // it would find its word spaces and cut it into pieces.
  const gapX = rows.length >= 3 ? widestGap(items, 'x', cfg.gutterX) : null;
  const gapY = widestGap(items, 'y', cfg.gutterY);

  const cut = gapX ? { gap: gapX, axis: 'x' } : gapY ? { gap: gapY, axis: 'y' } : null;
  if (!cut) return [items];

  const edge = cut.axis === 'x' ? 'x1' : 'y1';
  const first = items.filter((i) => i[edge] <= cut.gap.hi);
  const second = items.filter((i) => i[edge] > cut.gap.hi);
  if (!first.length || !second.length) return [items];

  return [...segment(first, cfg, depth + 1), ...segment(second, cfg, depth + 1)];
}

// ---------------------------------------------------------------- text

/**
 * Join one row's items into a line.
 *
 * pdf.js breaks a rendered line apart wherever the typesetter adjusted spacing,
 * so an unconditional space between items lands inside words: "evolu tion",
 * "agree ment". Measured on these pages, gaps within a word run 0.0–3.3pt and
 * gaps between words run 5.6–11.9pt, so the item's own font size separates them
 * with room to spare.
 */
function joinRow(row) {
  let text = row.items[0].str;
  for (let k = 1; k < row.items.length; k++) {
    const item = row.items[k];
    const gap = item.x0 - row.items[k - 1].x1;
    text += (gap > item.size * TUNING.wordGap ? ' ' : '') + item.str;
  }
  return text.replace(/\s+/g, ' ').trim();
}

const HYPHEN = /[‐­-]$/;

/** Join rows into one line of text, closing up words broken at a line end. */
function joinRows(rows) {
  let text = '';
  for (const row of rows) {
    const line = joinRow(row);
    if (!text) text = line;
    else if (HYPHEN.test(text) && /^\p{L}/u.test(line)) text = text.replace(HYPHEN, '') + line;
    else text += ' ' + line;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Turn a block into paragraphs.
 *
 * This paper marks a new paragraph with a first-line indent, not with space —
 * the columns are set solid, so looking for extra leading finds nothing and the
 * whole column comes back as one paragraph. An indent of about one em starts a
 * paragraph. A much deeper indent does not: those are the two or three lines
 * set around a drop cap, and they belong to the paragraph already open.
 *
 * The leading test is kept as well, for the blocks that are set open.
 * End-of-line hyphens are rejoined with the word they were split from.
 */
function toParagraphs(rows, unit, margin) {
  const lines = rows.map((row) => ({
    text: joinRow(row),
    base: row.base,
    indent: Math.min(...row.items.map((i) => i.x0)) - margin,
  }));
  const leads = [];
  for (let k = 1; k < lines.length; k++) leads.push(lines[k].base - lines[k - 1].base);
  const leading = median(leads.filter((d) => d > 0)) || 0;

  const paragraphs = [];
  let current = '';
  for (let k = 0; k < lines.length; k++) {
    const indented =
      lines[k].indent > unit * TUNING.indentMin && lines[k].indent < unit * TUNING.indentMax;
    const spaced =
      leading > 0 && k > 0 && lines[k].base - lines[k - 1].base > leading * TUNING.paraGap;
    const broke = k > 0 && (indented || spaced);
    if (broke && current) {
      paragraphs.push(current);
      current = '';
    }
    if (!current) current = lines[k].text;
    else if (HYPHEN.test(current) && /^[a-z]/.test(lines[k].text))
      current = current.replace(HYPHEN, '') + lines[k].text;
    else current += ' ' + lines[k].text;
  }
  if (current) paragraphs.push(current);
  return paragraphs.filter((p) => p.trim());
}

/**
 * Pull the drop cap out of a block and put it back on the front of the copy.
 *
 * A drop cap is set several lines deep, so its baseline sorts below the line it
 * belongs to and it arrives as a row of its own — which is how "What Thursday"
 * becomes a heading reading "W" and a paragraph starting "hat Thursday".
 */
function liftDropCap(rows, leafSize) {
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    if (row.items.length !== 1) continue;
    const item = row.items[0];
    if (item.size < leafSize * TUNING.dropCap) continue;
    if (!/^[A-Za-z]$/.test(item.str.trim())) continue;

    const rest = rows.filter((r) => r !== row);
    if (!rest.length) continue;
    rest[0] = { ...rest[0], items: [...rest[0].items] };
    rest[0].items[0] = { ...rest[0].items[0], str: item.str.trim() + rest[0].items[0].str };
    return rest;
  }
  return rows;
}

/**
 * A crosshead — the little all-caps line that breaks up a long column.
 *
 * These are set *smaller* than the body (8.0pt against 8.6pt) and centred, so
 * font size cannot find them and they read as a shouted sentence in the middle
 * of a paragraph. Being all capitals and not filling the measure does find them.
 */
function isCrosshead(row, columnWidth) {
  const text = joinRow(row);
  if (text.length < 4) return false;
  if (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text)) return false;
  return rowWidth(row) < columnWidth * TUNING.crossheadFill;
}

/** Split rows into consecutive runs set at the same size. */
function groupBySize(rows) {
  const runs = [];
  for (const row of rows) {
    const size = Math.max(...row.items.map((i) => i.size));
    const run = runs[runs.length - 1];
    if (run && Math.abs(run.size - size) <= run.size * TUNING.sizeBand) {
      run.rows.push(row);
      run.size = Math.max(run.size, size);
    } else {
      runs.push({ size, rows: [row] });
    }
  }
  return runs;
}

// ---------------------------------------------------------------- pages

async function extractPage(page, pageNum, cfg) {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });

  const items = textContent.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => {
      const tx = item.transform;
      const size = Math.abs(tx[0]) || Math.abs(tx[3]) || 12;
      // PDF y-coordinates are bottom-up; flip to top-down so "later" means "lower"
      const base = viewport.height - tx[5];
      return {
        str: item.str,
        size,
        base,
        x0: tx[4],
        x1: tx[4] + (item.width || 0),
        y0: base - (item.height || size),
        y1: base,
      };
    });

  if (!items.length) return { pageNum, blocks: [] };

  const pageSize = median(items.map((i) => i.size));
  const tuned = {
    gutterX: Math.max(4, pageSize * TUNING.gutterX),
    gutterY: Math.max(4, pageSize * TUNING.gutterY),
    rowTol: pageSize * TUNING.rowTol,
  };

  const blocks = [];
  for (const leaf of segment(items, tuned)) {
    if (!leaf.length) continue;
    const leafSize = median(leaf.map((i) => i.size));
    const ratio = pageSize ? leafSize / pageSize : 1;

    let level = 'body';
    if (ratio >= TUNING.h1) level = 'h1';
    else if (ratio >= TUNING.h2) level = 'h2';
    else if (ratio >= TUNING.h3) level = 'h3';

    let rows = toRows(leaf, tuned.rowTol);

    if (level === 'body') {
      rows = liftDropCap(rows, leafSize);
      const box = extentOf(leaf);
      const columnWidth = box.x1 - box.x0;
      // One margin for the whole column: a run that happens to start on an
      // indented line would otherwise take that indent as its left edge and lose
      // every paragraph break after it.
      const margin = Math.min(...rows.map((r) => Math.min(...r.items.map((i) => i.x0))));

      let run = [];
      let heads = [];
      const flush = () => {
        if (!run.length) return;
        const paragraphs = toParagraphs(run, pageSize, margin);
        if (paragraphs.length) blocks.push({ level: 'body', paragraphs });
        run = [];
      };
      // A crosshead runs to two lines as often as one, so consecutive ones
      // collect before they are emitted.
      const flushHeads = () => {
        if (!heads.length) return;
        const text = heads.map(joinRow).join(' ').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ level: 'h3', paragraphs: [text] });
        heads = [];
      };
      for (const row of rows) {
        if (isCrosshead(row, columnWidth)) {
          flush();
          heads.push(row);
        } else {
          flushHeads();
          run.push(row);
        }
      }
      flushHeads();
      flush();
      continue;
    }

    // A headline set over three lines is one headline, so rows merge. But a
    // headline, the deck under it and the standfirst under that also land in one
    // block, and those are three headings — so rows only merge while the type
    // stays the same size.
    for (const run of groupBySize(rows)) {
      const text = run.rows.map(joinRow).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const r = pageSize ? run.size / pageSize : 1;
      const runLevel = r >= TUNING.h1 ? 'h1' : r >= TUNING.h2 ? 'h2' : 'h3';
      blocks.push({ level: runLevel, paragraphs: [text] });
    }
  }

  return { pageNum, blocks: healColumnBreaks(blocks) };
}

/**
 * Rejoin a word broken across a column break.
 *
 * Hyphenation inside a column is handled while the lines are still together,
 * but the last line of a column can break a word too, and its other half is the
 * first line of the next column — a different block by then.
 */
function healColumnBreaks(blocks) {
  for (let k = 0; k < blocks.length - 1; k++) {
    const left = blocks[k];
    if (left.level !== 'body') continue;

    // A paragraph can run through several columns, and the piece pulled back
    // from one of them can end mid-word itself, so this repeats until the
    // paragraph closes on a whole word.
    while (left.paragraphs.length) {
      const tail = left.paragraphs[left.paragraphs.length - 1];
      if (!HYPHEN.test(tail)) break;

      // The rest of the word is at the top of the next column, which is the
      // next body block — a standing head or a pull quote can sit between the
      // two. A continuation always resumes mid-word in lower case, and no
      // article ever opens that way, so that is the test.
      const next = blocks.slice(k + 1).find((b) => b.level === 'body' && b.paragraphs.length);
      if (!next) break;
      const head = next.paragraphs[0];
      if (!/^\p{Ll}/u.test(head)) break;

      left.paragraphs[left.paragraphs.length - 1] = tail.replace(HYPHEN, '') + head;
      next.paragraphs.shift();
    }
  }
  return blocks.filter((b) => b.paragraphs.length);
}

// ---------------------------------------------------------------- markdown

/** Quote a value for YAML, escaping what a double-quoted scalar cares about. */
function yamlString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const HEADING_PREFIX = { h1: '###', h2: '####', h3: '#####' };

function toMarkdown(edition, pages) {
  const out = [];

  out.push('---');
  out.push(`volume: ${yamlString(edition.romanVolume)}`);
  out.push(`number: ${edition.number}`);
  out.push(`date: ${yamlString(edition.date)}`);
  out.push(`title: ${yamlString(edition.title)}`);
  out.push(`headline: ${yamlString(edition.headline)}`);
  out.push(`pages: ${edition.pages}`);
  out.push(`slug: ${yamlString(edition.slug)}`);
  out.push('masthead: true');
  out.push('---');
  out.push('');

  out.push('# 𝔗𝔥𝔢 𝔓𝔥𝔦𝔩 ℭ𝔥𝔞𝔱 𝔗𝔦𝔪𝔢𝔰');
  out.push('');
  out.push(`**${edition.title}** · ${formatDate(edition.date)}`);
  out.push('');
  out.push('---');
  out.push('');

  for (const page of pages) {
    out.push(`## Page ${page.pageNum}`);
    out.push('');
    for (const block of page.blocks) {
      if (block.level === 'body') {
        for (const paragraph of block.paragraphs) {
          out.push(paragraph);
          out.push('');
        }
      } else {
        out.push(`${HEADING_PREFIX[block.level]} ${block.paragraphs[0]}`);
        out.push('');
      }
    }
    out.push('---');
    out.push('');
  }

  return out.join('\n');
}

// ---------------------------------------------------------------- report

/** What the run produced, in the terms the output tends to go wrong in. */
function summarise(pages) {
  let headings = 0;
  let longest = 0;
  let hyphens = 0;
  let paragraphs = 0;
  let blocks = 0;
  for (const page of pages) {
    for (const block of page.blocks) {
      blocks++;
      if (block.level !== 'body') headings++;
      for (const p of block.paragraphs) {
        if (block.level === 'body') paragraphs++;
        longest = Math.max(longest, p.length);
        hyphens += (p.match(/[‐­]/g) || []).length;
      }
    }
  }
  return { blocks, headings, paragraphs, longest, hyphens };
}

// ---------------------------------------------------------------- main

async function extractEdition(edition) {
  const pdfPath = path.join(ROOT, edition.pdf);
  const outPath = path.join(ROOT, 'editions', edition.slug, 'edition.md');

  if (!FORCE && fs.existsSync(outPath)) {
    console.log(`  ${edition.slug}: edition.md exists (use --force to overwrite)`);
    return;
  }

  if (!fs.existsSync(pdfPath)) {
    console.error(`  ${edition.slug}: PDF not found at ${pdfPath}`);
    return;
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  if (doc.numPages !== edition.pages) {
    console.warn(
      `  ${edition.slug}: editions.json says ${edition.pages} pages, PDF has ${doc.numPages} — run npm run build`
    );
  }

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push(await extractPage(page, i, TUNING));
  }

  const markdown = toMarkdown(edition, pages);
  fs.writeFileSync(outPath, markdown, 'utf-8');

  const s = summarise(pages);
  console.log(
    `  ${edition.slug}: ${doc.numPages} pages, ${s.blocks} blocks, ${s.headings} headings, ` +
      `${s.paragraphs} paragraphs, longest ${s.longest} chars, ${s.hyphens} split words ` +
      `→ ${(markdown.length / 1024).toFixed(1)} KB`
  );
  await doc.destroy();
}

async function main() {
  const targets = slugArg
    ? manifest.editions.filter((e) => e.slug === slugArg)
    : manifest.editions;

  if (!targets.length) {
    console.error(slugArg ? `No edition with slug "${slugArg}".` : 'No editions found.');
    process.exit(1);
  }
  if (!ALL && !slugArg) {
    console.log('No --slug given; extracting every edition.');
  }

  console.log(`\nExtracting ${targets.length} edition(s)...\n`);
  for (const edition of targets) await extractEdition(edition);
  console.log('\nDone.\n');
}

// Importable for inspection: `EXTRACT_LIB=1 node -e "import(...)"` loads the
// segmentation without running a pass over every edition.
export { segment, toRows, widestGap, spanTrim, joinRow, joinRows, toParagraphs, extractPage };

if (!process.env.EXTRACT_LIB) {
  main().catch((e) => {
    console.error('extract-edition failed:', e);
    process.exit(1);
  });
}
