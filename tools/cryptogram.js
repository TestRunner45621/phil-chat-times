// cryptogram.js — a line from the week under a letter-substitution cipher.
//
// The one puzzle here a stranger can solve with no knowledge of the room at all:
// it is broken by English letter frequency, and the payoff is the sentence. Good
// back-page filler, cheap to set, and it prints as plain text.
//
//     node tools/cryptogram.js "<log folder>" [--seed 828] [--min 5]
//     node tools/cryptogram.js --text "any sentence you like" [--seed 828]
//
// The cipher is a derangement: no letter ever stands for itself, which is the
// convention and also stops the puzzle giving itself away.
'use strict';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
let seed = Number(arg('--seed', 828));
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

let quote = arg('--text', null);
let credit = '';

if (!quote) {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) {
    console.error('usage: node cryptogram.js "<log folder>" [--seed N] [--min N] | --text "…"');
    process.exit(1);
  }
  const { readLog, flat } = require('./log');
  const min = Number(arg('--min', 5));
  const { msgs } = readLog(dir);
  // Style.txt: a raw :KEKW: token never appears in the paper, so strip emote
  // tokens before judging whether a line is usable.
  const clean = (s) => flat(s).replace(/:[A-Za-z0-9_]{2,}:/g, ' ').replace(/\s+/g, ' ').trim();
  const pool = msgs.filter((m) => {
    const t = clean(m.text);
    return m.reacts >= min && !m.images.length && !/https?:\/\//.test(t)
      && t.length >= 40 && t.length <= 120 && /^[\x20-\x7E]+$/.test(t);
  });
  if (!pool.length) { console.error('no suitable line; lower --min'); process.exit(1); }
  const pick = pool[Math.floor(rnd() * pool.length)];
  quote = clean(pick.text);
  credit = `${pick.name}, ${pick.dow} ${pick.day}`;
}

/* Derangement of the alphabet: shuffle, then repair any fixed points. */
const key = A.slice();
for (let i = key.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [key[i], key[j]] = [key[j], key[i]];
}
for (let i = 0; i < 26; i++) {
  if (key[i] === A[i]) {
    const j = (i + 1) % 26;
    [key[i], key[j]] = [key[j], key[i]];
  }
}
const map = Object.fromEntries(A.map((c, i) => [c, key[i]]));

const cipher = quote.toUpperCase().replace(/[A-Z]/g, (c) => map[c]);
const freq = {};
for (const c of cipher.replace(/[^A-Z]/g, '')) freq[c] = (freq[c] || 0) + 1;
const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6);

console.log('CRYPTOGRAM\n');
console.log('  ' + cipher + '\n');
if (credit) console.log(`  — a Phil Chat regular, ${credit}\n`);
console.log('  Most frequent letters: ' + top.map(([c, n]) => `${c} (${n})`).join(', '));
console.log('  Each letter stands for another, the same one throughout, and never itself.\n');
console.log('SOLUTION');
console.log('  ' + quote);
if (credit) console.log('  — ' + credit);
console.log('\nKEY (plain -> cipher)');
console.log('  ' + A.join(' '));
console.log('  ' + key.join(' '));
