// day.js — one day, in sequence, with everyone in it.
//
// The finders above pull messages out of context. This puts them back. Run it
// over the hour a story happened in and read what the room was actually doing
// either side of the line you liked.
//
//     node tools/day.js "<log folder>" <MM-DD> [--from HH:MM] [--to HH:MM]
//                                              [--who Name] [--min chars]
'use strict';
const { readLog, flat } = require('./log');

const dir = process.argv[2];
const day = process.argv[3];
if (!dir || !day) {
  console.error('usage: node day.js "<log folder>" <MM-DD> [--from HH:MM] [--to HH:MM] [--who Name] [--min N]');
  process.exit(1);
}
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const toMins = (t) => (t ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1] || 0) : null);
const from = toMins(arg('--from'));
const to = toMins(arg('--to'));
const who = arg('--who');
const min = Number(arg('--min')) || 0;

const { msgs } = readLog(dir);
let rows = msgs.filter((m) => m.day === day);
if (!rows.length) { console.error(`no messages for ${day}`); process.exit(1); }
const dow = rows[0].dow;
if (from !== null) rows = rows.filter((m) => m.mins >= from);
if (to !== null) rows = rows.filter((m) => m.mins <= to);
if (who) rows = rows.filter((m) => m.name.toLowerCase().startsWith(who.toLowerCase()));
if (min) rows = rows.filter((m) => flat(m.text).length >= min);

console.log(`# ${day} ${dow} — ${rows.length} messages\n`);
let hour = -1;
for (const m of rows) {
  const h = Math.floor(m.mins / 60);
  if (h !== hour) { hour = h; console.log(`\n---- ${String(h).padStart(2, '0')}:00 ----\n`); }
  const r = m.reacts ? `  {${Object.entries(m.reactions).map(([e, n]) => e + '×' + n).join(' ')}}` : '';
  const img = m.images.length ? ` [img]` : '';
  const rep = m.replyTo ? ` ↩${m.replyTo}` : '';
  console.log(`${m.time} ${m.name}${rep}: ${flat(m.text)}${img}${r}`);
}
