// tiers.js — check a tier list you wrote. It does not write one.
//
// Placement is a judgment about what the week was like, and the moment it is
// computed from a number the room plays to the number instead of to the room.
// That has happened here. So nothing in this file ranks anybody: it checks that
// everyone who spoke is on the board, that nobody on the board is a ghost, that
// the names are the ones NAMES.txt says to print, and that the entries worth
// explaining have an explanation.
//
//     node tools/tiers.js "<log folder>" board.txt
//
// board.txt is tier headers and names, with a note after a pipe where one is
// funny, noteworthy or interesting. Most names want no note.
//
//     S
//     Quigley  | Lost the poll on Saturday, declared victory on Monday
//     Hugh
//     A
//     Stackhouse
//
// Exits non-zero if somebody who spoke is missing, since "everybody who spoke is
// placed" is the one rule the board has.
'use strict';
const fs = require('fs');
const path = require('path');
const { readLog, counts } = require('./log');

const dir = process.argv[2];
const boardFile = process.argv[3];
if (!dir || !boardFile) { console.error('usage: node tiers.js "<log folder>" board.txt'); process.exit(1); }

/* ------------------------------------------------------------ the board */
const board = [];
let tier = null;
for (const raw of fs.readFileSync(boardFile, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const head = /^([A-Z][+-]?):?$/.exec(line);
  if (head) { tier = head[1]; continue; }
  if (!tier) { console.error(`"${line}" appears before any tier header`); process.exit(1); }
  const [name, ...rest] = line.split('|');
  board.push({ tier, name: name.trim(), note: rest.join('|').trim() });
}
if (!board.length) { console.error('no entries found'); process.exit(1); }

/* ------------------------------------------------------------ the week */
const { msgs, handles } = readLog(dir);
const spoke = new Map(counts(msgs));
const placed = new Map(board.map((b) => [b.name, b]));

/* --------------------------------------------------------- print names */
let printName = new Map();
for (const p of [path.join(__dirname, '..', 'Instructions', 'NAMES.txt'), path.join(__dirname, '..', 'legend', 'NAMES.txt')]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^@(\S+?)\s*=\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const name = m[2].split(/\s+Char:|\s+\(|\.\s/)[0].trim().replace(/\.$/, '');
    if (!name) continue;
    // An entry may name alternates: "Anthony Quigley (or Quigley — never the
    // username)". Both are correct, so accept either and flag neither.
    const alts = [...m[2].matchAll(/\bor ([A-Z][\w'-]*(?: [A-Z][\w'-]*)?)/g)].map((x) => x[1]);
    printName.set('@' + m[1], { name, ok: new Set([name, ...alts]) });
  }
  break;
}

/* ------------------------------------------------------------- report */
const tiers = [...new Set(board.map((b) => b.tier))];
console.log(`# ${board.length} placed across ${tiers.length} tiers; ${spoke.size} people spoke this week\n`);
for (const t of tiers) {
  const row = board.filter((b) => b.tier === t);
  const noted = row.filter((b) => b.note).length;
  console.log(`  ${t.padEnd(3)} ${String(row.length).padStart(3)} placed, ${noted} with a note`);
}

let fail = false;

const dupes = board.map((b) => b.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dupes.length) { console.log(`\n!! in two tiers at once: ${[...new Set(dupes)].join(', ')}`); fail = true; }

const missing = [...spoke.entries()].filter(([n]) => !placed.has(n)).sort((a, b) => b[1] - a[1]);
if (missing.length) {
  console.log(`\n!! SPOKE BUT NOT PLACED — ${missing.length} of ${spoke.size}. Everybody who spoke goes on the board.`);
  for (const [n, c] of missing) console.log(`     ${String(c).padStart(5)}  ${n}`);
  fail = true;
}

const ghosts = board.filter((b) => !spoke.has(b.name));
if (ghosts.length) {
  console.log(`\n?  PLACED BUT SILENT — fine if deliberate (held in absentia, a bot), otherwise a typo:`);
  for (const g of ghosts) console.log(`     ${g.tier}  ${g.name}${g.note ? '  — ' + g.note : ''}`);
}

const wrongName = [];
for (const b of board) {
  const want = printName.get(handles.get(b.name));
  if (want && !want.ok.has(b.name)) wrongName.push(`${b.name} -> ${want.name}`);
}
if (wrongName.length) console.log(`\n!  NAMES.TXT SAYS PRINT: ${wrongName.join(', ')}`);

const loud = [...spoke.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .filter(([n]) => placed.has(n) && !placed.get(n).note);
if (loud.length) {
  console.log(`\n?  no note, and among the twenty busiest — worth a line if anything about them was funny:`);
  console.log(`     ${loud.map(([n, c]) => `${n} (${c})`).join(', ')}`);
}

const notes = board.filter((b) => b.note).length;
console.log(`\n${notes} of ${board.length} entries carry an explanation. Most should not; the ones that do are the page.`);
if (fail) { console.log('\nFAILED'); process.exit(1); }
console.log('OK');
