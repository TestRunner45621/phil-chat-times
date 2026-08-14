/* Build the reacted-message index from a log's working/ day files.
 * Reactions are the room's own highlight reel — only a few per cent of
 * messages draw one — so this is where lead-hunting starts.
 *
 *   node reacted.js "<path to log folder>" "<out file>" [minReactions]
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const outFile = process.argv[3];
const min = +(process.argv[4] || 1);

const work = path.join(dir, 'working');
const files = fs.readdirSync(work).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();

const out = ['# REACTED MESSAGES — the week\'s pre-filtered highlight reel', ''];
let total = 0;

for (const f of files) {
  const blocks = fs.readFileSync(path.join(work, f), 'utf8').split(/\n---\n/);
  const kept = [];
  for (const b of blocks) {
    const m = /^⭐ \*\*Reactions:\*\* (.*)$/m.exec(b);
    if (!m) continue;
    const n = [...m[1].matchAll(/×(\d+)/g)].reduce((a, x) => a + +x[1], 0);
    if (n < min) continue;
    kept.push(b.trim());
  }
  total += kept.length;
  out.push(`\n=================== ${f} — ${kept.length} reacted ===================\n`);
  out.push(kept.join('\n---\n'));
}

fs.writeFileSync(outFile, out.join('\n'), 'utf8');
console.log(`${total} reacted messages -> ${outFile}`);
