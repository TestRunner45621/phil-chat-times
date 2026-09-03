// fake.js — "spot the forgery": real lines from the week and one invented.
//
// The paper is a bit, not a wire service, so a game may invent a line where the
// copy may not. Keep the invention inside the game: a fabricated quote must
// never leave this page and turn up in a story.
//
// Two passes, because a script cannot forge anybody's voice and should not try.
// The first hands you the evidence, the second sets the round once you have
// written the fake.
//
//     node tools/fake.js "<log folder>" --who Quigley [--real 3] [--forge]
//     node tools/fake.js --set round.txt [--seed 828]
//
// round.txt is one quote per line, a * on the invented one:
//
//     Quigley: I recognize the distinction that you are wrong.
//     Quigley: Usefulness is a separate distinction
//     *Quigley: The distinction recognises itself, which is how I know it holds.
'use strict';
const fs = require('fs');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.indexOf(f) > -1;
let seed = Number(arg('--seed', 828));
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = (a) => a.map((x) => ({ x, k: rnd() })).sort((p, q) => p.k - q.k).map((p) => p.x);

/* ------------------------------------------------------- set the round */
if (has('--set')) {
  const lines = fs.readFileSync(arg('--set'), 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ fake: l.startsWith('*'), text: l.replace(/^\*/, '').trim() }));
  if (lines.filter((l) => l.fake).length !== 1) {
    console.error('mark exactly one line with a leading * as the invented one');
    process.exit(1);
  }
  const order = shuffle(lines);
  console.log('SPOT THE FORGERY\n');
  console.log('One of these was never typed by anybody. Which?\n');
  order.forEach((l, i) => console.log(`  ${String.fromCharCode(65 + i)}. ${l.text}\n`));
  console.log(`ANSWER: ${String.fromCharCode(65 + order.findIndex((l) => l.fake))} — invented.`);
  console.log('The rest are verbatim. Say so in the answer, or the joke does not land.');
  process.exit(0);
}

/* ------------------------------------------------- gather the evidence */
const { readLog, flat } = require('./log');
const dir = process.argv[2];
const who = arg('--who');
if (!dir || dir.startsWith('--') || !who) {
  console.error('usage: node fake.js "<log folder>" --who <Name> [--real 3] [--forge] | --set round.txt');
  process.exit(1);
}
const wantReal = Number(arg('--real', 3));

const { msgs } = readLog(dir);
const target = [...new Set(msgs.map((m) => m.name))].find((n) => n.toLowerCase().startsWith(who.toLowerCase()));
if (!target) { console.error(`no account starting "${who}"`); process.exit(1); }

const clean = (s) => flat(s).replace(/:[A-Za-z0-9_]{2,}:/g, ' ').replace(/\s+/g, ' ').trim();
const mine = msgs.filter((m) => m.name === target && !m.images.length)
  .map((m) => ({ ...m, q: clean(m.text) }))
  .filter((m) => m.q.length >= 20 && m.q.length <= 160 && !/https?:\/\//.test(m.q));
if (mine.length < 8) { console.error(`only ${mine.length} usable lines from ${target}`); process.exit(1); }

/* Voice tells: the things that make a forgery read right. */
const lens = mine.map((m) => m.q.length).sort((a, b) => a - b);
const median = lens[Math.floor(lens.length / 2)];
const capStart = mine.filter((m) => /^[A-Z]/.test(m.q)).length / mine.length;
const endStop = mine.filter((m) => /[.!?]$/.test(m.q)).length / mine.length;
const comma = mine.filter((m) => /,/.test(m.q)).length / mine.length;

/* Words this person uses far more than the room does. */
const tally = (list) => {
  const c = new Map(); let n = 0;
  for (const m of list) for (const w of m.q.toLowerCase().match(/[a-z']{3,}/g) || []) { c.set(w, (c.get(w) || 0) + 1); n++; }
  return { c, n };
};
const A = tally(mine);
const B = tally(msgs.map((m) => ({ q: clean(m.text) })));
const lift = [...A.c.entries()].filter(([, n]) => n >= 3)
  .map(([w, n]) => [w, (n / A.n) / (((B.c.get(w) || 1)) / B.n)])
  .sort((a, b) => b[1] - a[1]).slice(0, 14).map(([w]) => w);

console.log(`FORGING ${target}\n`);
console.log(`Lines available: ${mine.length}. Median length ${median} characters.`);
console.log(`Starts with a capital ${Math.round(capStart * 100)}% of the time; ends on a full stop ${Math.round(endStop * 100)}%; uses a comma ${Math.round(comma * 100)}%.`);
console.log(`Words they reach for more than the room does: ${lift.join(', ')}\n`);

console.log(`--- ${wantReal} real lines for the round (verify each in context before printing)\n`);
const picked = shuffle(mine.slice()).slice(0, wantReal);
for (const m of picked) console.log(`${target}: ${m.q}\n   (${m.day} ${m.dow} ${m.time}${m.reacts ? ', ' + m.reacts + ' reactions' : ''})\n`);

if (has('--forge')) {
  // Bigram scramble of their own words: not a usable quote, a prompt for one.
  const chain = new Map();
  for (const m of mine) {
    const w = ['', ...m.q.split(/\s+/), ''];
    for (let i = 0; i < w.length - 1; i++) {
      if (!chain.has(w[i])) chain.set(w[i], []);
      chain.get(w[i]).push(w[i + 1]);
    }
  }
  console.log('--- scrambled from their own words. Not printable. A starting point only.\n');
  for (let k = 0; k < 3; k++) {
    let w = '', out = [];
    while (out.length < 26) {
      const next = chain.get(w);
      if (!next) break;
      w = next[Math.floor(rnd() * next.length)];
      if (w === '') break;
      out.push(w);
    }
    console.log('   ' + out.join(' '));
  }
  console.log('');
}

console.log('--- now write the fake yourself, in their voice, at about the median length.');
console.log('Put it in a file with the real ones, mark it with a leading *, then:');
console.log('    node tools/fake.js --set round.txt');
console.log('\nThe invention stays in the game. It never becomes a quote in a story.');
