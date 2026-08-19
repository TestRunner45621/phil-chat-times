#!/usr/bin/env node
/**
 * extract-edition.mjs — extract text from an edition PDF into structured markdown.
 *
 *   node scripts/extract-edition.mjs [--slug vol-1-no-3] [--all] [--force]
 *
 * Uses pdfjs-dist (already a project dependency) to pull text with coordinates
 * from each page, then clusters items into columns by x-position and
 * reconstructs reading order (left-to-right, top-to-bottom within each column).
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
  return i !== -1 ? args[i + 1] : null;
})();

// ---------------------------------------------------------------- manifest

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'editions.json'), 'utf-8'));

// ---------------------------------------------------------------- helpers

/**
 * Cluster text items into columns based on x-position.
 * Items whose x-midpoints are within `gap` px of each other belong
 * to the same column.
 */
function clusterColumns(items, gap = 40) {
  if (!items.length) return [];

  // Sort items by x to find natural column boundaries
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const columns = [];
  let currentCol = [sorted[0]];
  let colLeft = sorted[0].x;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    // If this item's x is far from the current column's left, start a new column
    if (item.x - colLeft > gap) {
      columns.push(currentCol);
      currentCol = [item];
      colLeft = item.x;
    } else {
      currentCol.push(item);
    }
  }
  columns.push(currentCol);
  return columns;
}

/**
 * Extract text from a single page, reconstructing reading order.
 */
async function extractPage(page, pageNum) {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });

  // Transform text items to page coordinates
  const items = textContent.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => {
      const tx = item.transform;
      return {
        str: item.str,
        x: tx[4],
        // PDF y-coordinates are bottom-up; flip to top-down
        y: viewport.height - tx[5],
        fontSize: Math.abs(tx[0]) || Math.abs(tx[3]) || 12,
        width: item.width,
        height: item.height,
      };
    });

  if (!items.length) return { pageNum, text: '', lines: [] };

  // Cluster into columns
  const columns = clusterColumns(items, viewport.width * 0.08);

  // Sort columns left-to-right, items within each column top-to-bottom
  columns.sort((a, b) => {
    const aMinX = Math.min(...a.map((i) => i.x));
    const bMinX = Math.min(...b.map((i) => i.x));
    return aMinX - bMinX;
  });

  const lines = [];
  for (const col of columns) {
    // Sort items in this column top-to-bottom, left-to-right for same line
    col.sort((a, b) => {
      const dy = a.y - b.y;
      if (Math.abs(dy) < a.fontSize * 0.5) return a.x - b.x; // same line
      return dy;
    });

    // Merge items on the same line
    let currentLine = { items: [col[0]], y: col[0].y, fontSize: col[0].fontSize };
    for (let i = 1; i < col.length; i++) {
      const item = col[i];
      if (Math.abs(item.y - currentLine.y) < currentLine.fontSize * 0.5) {
        currentLine.items.push(item);
      } else {
        lines.push(currentLine);
        currentLine = { items: [item], y: item.y, fontSize: item.fontSize };
      }
    }
    lines.push(currentLine);
  }

  // Build text with structural hints
  const textLines = lines.map((line) => {
    const text = line.items.map((i) => i.str).join(' ');
    return { text, fontSize: line.fontSize, y: line.y };
  });

  return { pageNum, lines: textLines };
}

/**
 * Infer markdown structure from font sizes.
 * Largest font → heading, mid-size → subheading, rest → body.
 */
function inferStructure(pages) {
  // Collect all font sizes
  const allSizes = [];
  for (const page of pages) {
    for (const line of page.lines) {
      allSizes.push(line.fontSize);
    }
  }
  if (!allSizes.length) return pages;

  allSizes.sort((a, b) => a - b);
  const median = allSizes[Math.floor(allSizes.length / 2)];
  // Anything > 1.6x median is a heading, > 1.2x is a subheading
  const h1Thresh = median * 2.0;
  const h2Thresh = median * 1.5;
  const h3Thresh = median * 1.2;

  for (const page of pages) {
    for (const line of page.lines) {
      if (line.fontSize >= h1Thresh) {
        line.level = 'h1';
      } else if (line.fontSize >= h2Thresh) {
        line.level = 'h2';
      } else if (line.fontSize >= h3Thresh) {
        line.level = 'h3';
      } else {
        line.level = 'body';
      }
    }
  }
  return pages;
}

/**
 * Render structured pages to markdown.
 */
function toMarkdown(edition, pages) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`volume: ${edition.romanVolume}`);
  lines.push(`number: ${edition.number}`);
  lines.push(`date: "${edition.date}"`);
  lines.push(`title: "${edition.title}"`);
  lines.push(`headline: "${edition.headline.replace(/"/g, '\\"')}"`);
  lines.push(`pages: ${edition.pages}`);
  lines.push(`slug: "${edition.slug}"`);
  lines.push('masthead: true');
  lines.push('---');
  lines.push('');

  // Blackletter heading
  lines.push('# 𝔗𝔥𝔢 𝔓𝔥𝔦𝔩 ℭ𝔥𝔞𝔱 𝔗𝔦𝔪𝔢𝔰');
  lines.push('');
  lines.push(`**${edition.title}** · ${formatDate(edition.date)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const page of pages) {
    lines.push(`## Page ${page.pageNum}`);
    lines.push('');

    let prevLevel = null;
    let bodyBuffer = [];

    const flushBody = () => {
      if (bodyBuffer.length) {
        // Join consecutive body lines into paragraphs
        lines.push(bodyBuffer.join(' '));
        lines.push('');
        bodyBuffer = [];
      }
    };

    for (const line of page.lines) {
      if (line.level === 'h1') {
        flushBody();
        lines.push(`### ${line.text}`);
        lines.push('');
      } else if (line.level === 'h2') {
        flushBody();
        lines.push(`#### ${line.text}`);
        lines.push('');
      } else if (line.level === 'h3') {
        flushBody();
        lines.push(`##### ${line.text}`);
        lines.push('');
      } else {
        // Body text: accumulate into paragraph
        if (
          prevLevel === 'body' &&
          bodyBuffer.length > 0 &&
          line.text.length < 20 &&
          !line.text.match(/^[A-Z]/)
        ) {
          // Short line that doesn't start with a capital — probably continuation
          bodyBuffer.push(line.text);
        } else if (prevLevel !== 'body') {
          flushBody();
          bodyBuffer.push(line.text);
        } else {
          // Heuristic: big y-gap between consecutive body lines = new paragraph
          bodyBuffer.push(line.text);
        }
      }
      prevLevel = line.level;
    }
    flushBody();
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
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

  console.log(`  ${edition.slug}: extracting ${edition.pages} pages...`);

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const extracted = await extractPage(page, i);
    pages.push(extracted);
  }

  inferStructure(pages);
  const markdown = toMarkdown(edition, pages);

  fs.writeFileSync(outPath, markdown, 'utf-8');
  console.log(`  ${edition.slug}: wrote edition.md (${(markdown.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const targets = ALL
    ? manifest.editions
    : slugArg
      ? manifest.editions.filter((e) => e.slug === slugArg)
      : manifest.editions;

  if (!targets.length) {
    console.error('No matching editions found.');
    process.exit(1);
  }

  console.log(`\nExtracting ${targets.length} edition(s)...\n`);

  for (const edition of targets) {
    await extractEdition(edition);
  }

  console.log('\nDone.\n');
}

main().catch((e) => {
  console.error('extract-edition failed:', e);
  process.exit(1);
});
