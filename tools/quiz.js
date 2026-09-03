// quiz.js — "who said it", built from the week's most-reacted lines.
//
// The natural game for this paper: the answers are all real, the room can play
// it from memory, and a stranger can play it on voice alone. Picks lines the
// room already rewarded, one per author, and prints the quiz and the key.
//
//     node tools/quiz.js "<log folder>" [howMany=6] [--seed 828] [--min 3]
//
// Nothing is invented. Style.txt's quotes policy means a "which of these is
// fake" round is off the table — every quotation in the paper was typed by the
// person it is attributed to, and a game cannot be the exception.
'use strict';
const { readLog, flat } = require('./log');

const dir = process.argv[2];
if (!dir) { console.error('usage: node quiz.js "<log folder>" [howMany] [--seed N] [--min N]'); process.exit(1); }
const want = Number(process.argv[3]) || 6;
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? Number(process.argv[i + 1]) : d; };
let seed = arg('--seed', 828);
const min = arg('--min', 3);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const { msgs } = readLog(dir);

/* One line per author, the best they did, and only lines that stand alone:
 * no images, no links, short enough to read aloud, and not a bare reply that
 * makes no sense without its parent. */
// Style.txt: a raw :KEKW: token never appears in the paper, so strip emote
// tokens here and judge the length of what would actually be printed.
const clean = (s) => flat(s).replace(/:[A-Za-z0-9_]{2,}:/g, ' ').replace(/\s+/g, ' ').trim();

const byAuthor = new Map();
for (const m of msgs) {
  const t = clean(m.text);
  if (m.reacts < min || m.images.length) continue;
  if (t.length < 25 || t.length > 190) continue;
  if (/https?:\/\//.test(t)) continue;
  const cur = byAuthor.get(m.name);
  if (!cur || m.reacts > cur.reacts) byAuthor.set(m.name, { ...m, quote: t });
}

const pool = [...byAuthor.values()].sort((a, b) => b.reacts - a.reacts);
if (pool.length < 4) { console.error('not enough quotable lines; lower --min'); process.exit(1); }

const picked = pool.slice(0, Math.max(want * 2, 8))
  .map((m) => ({ m, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, want).map((x) => x.m);

const names = picked.map((m) => m.name).map((n) => ({ n, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.n);

console.log('WHO SAID IT\n');
console.log('The names, in no order: ' + names.join(' · ') + '\n');
picked.forEach((m, i) => {
  console.log(`${i + 1}. "${m.quote}"`);
  console.log(`   (${m.day} ${m.dow} ${m.time}, ${m.reacts} reactions)\n`);
});
console.log('\nANSWERS');
picked.forEach((m, i) => console.log(`${i + 1}. ${m.name}`));
console.log('\nCheck each line in context before printing it — reacted.js finds them, day.js explains them.');
console.log('Names here are the log\'s. NAMES.txt is the authority on what gets printed: Monkey, never papagaio.');
