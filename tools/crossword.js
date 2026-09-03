// crossword.js — a free-form crossword built from this week's words, validated.
//
// The tool places and checks a grid. It does not write clues and does not draw
// the puzzle: clues are the paper's voice and the grid's presentation is part of
// the issue's design, so both are done at layout time. What comes out of here is
// a validated grid, the numbering, and the slot list.
//
//     node tools/crossword.js --words words.txt [--size 15] [--seed 828] [--json]
//     node tools/crossword.js --from "<log folder>" --pick 40    suggest candidates
//
// words.txt is one entry per line. A leading * marks an insider word — chat
// jargon, somebody's name, a running joke — and anything after a | is ignored,
// so the same file can carry your clues.
//
//     ONTOLOGY   | The study of what exists
//     *CLANKER   | Disparaging name for an AI
//
// The readership's rule, from Vol VI: "I want someone who doesn't read every
// message to be able to solve this." So insider words are capped at a third of
// the grid and each one must be crossed at least twice, which is what lets a
// stranger get it from the letters. A build that cannot satisfy that is rejected
// and the seed is advanced.
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : d; };
const has = (f) => argv.indexOf(f) > -1;

const N = Number(arg('--size', 15));
const START = Number(arg('--seed', 828));
const MAX_INSIDER = Number(arg('--insider', 0.34));

/* ---------------------------------------------------------------- candidates */
if (has('--from')) {
  const { readLog, flat } = require('./log');
  const { msgs } = readLog(arg('--from'));
  const freq = new Map();
  for (const m of msgs) {
    // Links first, or the grid fills up with HTTPS and YOUTUBE; then apostrophes,
    // so "doesn't" is one token to reject rather than DOESN plus T.
    const t = flat(m.text).replace(/https?:\/\/\S+/g, ' ').replace(/[''’]/g, '').toUpperCase();
    for (const w of t.match(/[A-Z]{5,12}/g) || []) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const STOP = new Set(('ABOUT AGAIN AGAINST BECAUSE BEFORE BEING BETWEEN COULD DOING DURING EVERY FIRST '
    + 'FROM GOING HAVING MIGHT NEVER OTHER PEOPLE PLACE POINT REALLY RIGHT SHOULD SINCE STILL THERE THESE '
    + 'THING THINGS THINK THOSE THOUGH THROUGH TRYING UNDER UNTIL WHERE WHICH WHILE WOULD YOURE THEIR '
    + 'THATS DOESNT WASNT ISNT SOMETHING ANYTHING NOTHING ACTUALLY PROBABLY LITERALLY THATS DOESNT WASNT ARENT DIDNT WOULDNT COULDNT SHOULDNT CANT WONT YOUVE THEYRE WHATEVER SOMEONE ANYONE EVERYONE BECAUSE MYSELF YOURSELF ITSELF HIMSELF GONNA WANNA KINDA SORTA GOTTA LIKE JUST BASICALLY OBVIOUSLY EXACTLY SIMPLY TOTALLY DEFINITELY SERIOUSLY HONESTLY SAYING TALKING MAKING TRYING LOOKING COMING GIVING TAKING GETTING KNOWING WATCH STUFF THING').split(/\s+/));
  const out = [...freq.entries()]
    .filter(([w, n]) => n >= 3 && !STOP.has(w))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, Number(arg('--pick', 40)));
  console.log('# candidates from the week — edit this list, mark insider words with *, add clues after |');
  for (const [w, n] of out) console.log(`${w.padEnd(14)}|  (used ${n}×)`);
  process.exit(0);
}

const src = arg('--words');
if (!src) { console.error('usage: node crossword.js --words words.txt | --from "<log folder>"'); process.exit(1); }

const entries = fs.readFileSync(src, 'utf8').split('\n')
  .map((l) => l.split('|')[0].trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => ({ insider: l.startsWith('*'), word: l.replace(/^\*/, '').toUpperCase().replace(/[^A-Z]/g, '') }))
  .filter((e) => e.word.length >= 3);
if (entries.length < 6) { console.error('need at least six usable words'); process.exit(1); }

const insiderShare = entries.filter((e) => e.insider).length / entries.length;
if (insiderShare > MAX_INSIDER) {
  console.error(`${Math.round(insiderShare * 100)}% of the list is insider words; the cap is ${Math.round(MAX_INSIDER * 100)}%.`);
  console.error('Cut some, or mark fewer as insider. A puzzle only the room can solve is not a puzzle.');
  process.exit(1);
}

/* ------------------------------------------------------------------- build */
const mkRnd = (s) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const empty = () => Array.from({ length: N }, () => Array(N).fill(null));

function runs(grid) {
  const out = [];
  for (let r = 0; r < N; r++) {
    let run = '', c0 = 0;
    for (let c = 0; c <= N; c++) {
      const g = c < N ? grid[r][c] : null;
      if (g) { if (!run) c0 = c; run += g; } else { if (run.length > 1) out.push({ word: run, r, c: c0, dir: 'A' }); run = ''; }
    }
  }
  for (let c = 0; c < N; c++) {
    let run = '', r0 = 0;
    for (let r = 0; r <= N; r++) {
      const g = r < N ? grid[r][c] : null;
      if (g) { if (!run) r0 = r; run += g; } else { if (run.length > 1) out.push({ word: run, r: r0, c, dir: 'D' }); run = ''; }
    }
  }
  return out;
}

function tryPlace(grid, word, r, c, dir) {
  const dr = dir === 'D' ? 1 : 0, dc = dir === 'A' ? 1 : 0;
  const endR = r + dr * (word.length - 1), endC = c + dc * (word.length - 1);
  if (r < 0 || c < 0 || endR >= N || endC >= N) return null;
  const before = [r - dr, c - dc], after = [endR + dr, endC + dc];
  if (before[0] >= 0 && before[1] >= 0 && grid[before[0]][before[1]]) return null;
  if (after[0] < N && after[1] < N && grid[after[0]][after[1]]) return null;
  let crossings = 0;
  for (let i = 0; i < word.length; i++) {
    const cur = grid[r + dr * i][c + dc * i];
    if (cur && cur !== word[i]) return null;
    if (cur === word[i]) crossings++;
  }
  return crossings;
}

function build(seed) {
  const rnd = mkRnd(seed);
  // Longest first, but jittered, or every seed explores the same tree and the
  // search is deterministic no matter how many seeds you spend on it.
  const order = entries.map((e) => ({ e, k: e.word.length + rnd() * 3 }))
    .sort((a, b) => b.k - a.k).map((x) => x.e);
  const grid = empty();
  const placed = [];
  const first = order[0];
  const r0 = Math.floor(N / 2), c0 = Math.max(0, Math.floor((N - first.word.length) / 2));
  for (let i = 0; i < first.word.length; i++) grid[r0][c0 + i] = first.word[i];
  placed.push({ ...first, r: r0, c: c0, dir: 'A', crossings: 0 });

  for (const e of order.slice(1)) {
    const options = [];
    for (let i = 0; i < e.word.length; i++) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (grid[r][c] !== e.word[i]) continue;
        for (const dir of ['A', 'D']) {
          const rr = dir === 'D' ? r - i : r, cc = dir === 'A' ? c - i : c;
          const x = tryPlace(grid, e.word, rr, cc, dir);
          if (x) options.push({ r: rr, c: cc, dir, crossings: x });
        }
      }
    }
    if (!options.length) continue;
    const centre = (o) => Math.abs(o.r - N / 2) + Math.abs(o.c - N / 2);
    options.sort((a, b) => (b.crossings * 4 - centre(b) + rnd() * 2) - (a.crossings * 4 - centre(a) + rnd() * 2));
    for (const o of options.slice(0, 8)) {
      const snap = grid.map((row) => row.slice());
      const dr = o.dir === 'D' ? 1 : 0, dc = o.dir === 'A' ? 1 : 0;
      for (let i = 0; i < e.word.length; i++) grid[o.r + dr * i][o.c + dc * i] = e.word[i];
      const set = new Set([...placed.map((p) => p.word), e.word]);
      if (runs(grid).every((x) => set.has(x.word))) { placed.push({ ...e, ...o }); break; }
      for (let r = 0; r < N; r++) grid[r] = snap[r];
    }
  }
  return { grid, placed };
}

let best = null;
for (let s = START; s < START + 600; s++) {
  const { grid, placed } = build(s);
  const set = new Set(placed.map((p) => p.word));
  if (!runs(grid).every((x) => set.has(x.word))) continue;   // never ship an invalid grid
  // Insider words want two crossings, so a stranger can letter them in from the
  // ordinary words either side. Prefer builds that manage it; do not refuse to
  // produce anything when the word list makes it impossible.
  const thin = placed.filter((p) => p.insider && crossCount(grid, p) < 2).map((p) => p.word);
  const score = (placed.length * 10) - thin.length * 6;
  if (!best || score > best.score) best = { grid, placed, seed: s, thin, score };
  if (placed.length === entries.length && !thin.length) break;
}

function crossCount(grid, p) {
  const dr = p.dir === 'D' ? 1 : 0, dc = p.dir === 'A' ? 1 : 0;
  let n = 0;
  for (let i = 0; i < p.word.length; i++) {
    const r = p.r + dr * i, c = p.c + dc * i;
    const a = dr ? [r, c - 1] : [r - 1, c], b = dr ? [r, c + 1] : [r + 1, c];
    const filled = (x) => x[0] >= 0 && x[1] >= 0 && x[0] < N && x[1] < N && grid[x[0]][x[1]];
    if (filled(a) || filled(b)) n++;
  }
  return n;
}

if (!best) {
  console.error('no valid grid found. Try --size 17, or drop the longest word.');
  process.exit(1);
}

/* ------------------------------------------------------------------ output */
const { grid, placed, seed, thin } = best;
const num = Array.from({ length: N }, () => Array(N).fill(0));
let n = 0;
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  if (!grid[r][c]) continue;
  const startA = (c === 0 || !grid[r][c - 1]) && c + 1 < N && grid[r][c + 1];
  const startD = (r === 0 || !grid[r - 1][c]) && r + 1 < N && grid[r + 1][c];
  if (startA || startD) num[r][c] = ++n;
}
const slots = runs(grid).map((x) => ({ ...x, n: num[x.r][x.c], insider: !!placed.find((p) => p.word === x.word && p.insider) }))
  .sort((a, b) => a.n - b.n);

if (has('--json')) {
  console.log(JSON.stringify({ size: N, seed, grid, numbers: num, slots, unplaced: entries.filter((e) => !placed.find((p) => p.word === e.word)).map((e) => e.word) }, null, 1));
  process.exit(0);
}

console.log(`# ${placed.length} of ${entries.length} words placed, ${N}x${N}, seed ${seed}\n`);
for (let r = 0; r < N; r++) console.log('  ' + grid[r].map((g) => g || '.').join(' '));
const un = entries.filter((e) => !placed.find((p) => p.word === e.word));
if (un.length) console.log(`\n! not placed: ${un.map((e) => e.word).join(', ')}`);
for (const dir of ['A', 'D']) {
  console.log(`\n${dir === 'A' ? 'ACROSS' : 'DOWN'}`);
  for (const s of slots.filter((x) => x.dir === dir)) {
    console.log(`  ${String(s.n).padStart(3)}. ${s.word.padEnd(14)} (${s.word.length})  r${s.r} c${s.c}${s.insider ? '  [insider]' : ''}`);
  }
}
if (thin.length) {
  console.log(`\n! crossed only once: ${thin.join(', ')} — a solver who was not in the room`);
  console.log('  has one letter to go on. Give an easier clue, swap the word, or try another --seed.');
}
console.log('\nClues are yours to write. Keep them plain enough that a stranger can solve it.');
