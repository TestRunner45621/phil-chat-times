// reacted.js — the room's own highlight reel.
//
// Only a few per cent of messages draw a reaction, so this set is pre-filtered
// by the readership. It is where lead-hunting starts, not where it ends: read
// the surrounding thread before believing any of it.
//
//     node tools/reacted.js "<log folder>" [minReactions=2] [--day MM-DD]
//
// Sorted by total reactions. Counts are SUMMED, so ten emotes at ×2 outranks a
// single emote at ×14 — which is the right way round and the way the paper has
// got wrong before.
'use strict';
const { readLog, flat } = require('./log');

const dir = process.argv[2];
if (!dir) { console.error('usage: node reacted.js "<log folder>" [min] [--day MM-DD]'); process.exit(1); }
const min = Number(process.argv[3]) || 2;
const dayArg = (process.argv.indexOf('--day') > -1) ? process.argv[process.argv.indexOf('--day') + 1] : null;

const { msgs } = readLog(dir);
let hits = msgs.filter((m) => m.reacts >= min);
if (dayArg) hits = hits.filter((m) => m.day === dayArg);
hits.sort((a, b) => b.reacts - a.reacts || a.day.localeCompare(b.day) || a.mins - b.mins);

const emo = (m) => Object.entries(m.reactions).map(([e, n]) => e + '×' + n).join(' ');

console.log(`# ${hits.length} messages at ${min}+ reactions, of ${msgs.length}\n`);
for (const m of hits) {
  const img = m.images.length ? ` [${m.images.length} image${m.images.length > 1 ? 's' : ''}]` : '';
  console.log(`${String(m.reacts).padStart(3)} | ${m.day} ${m.dow} ${m.time} ${m.name}${img}`);
  console.log(`    ${flat(m.text).slice(0, 400) || '(image only)'}`);
  if (m.replyTo) console.log(`    ↩ ${m.replyTo}: "${flat(m.replyQuote).slice(0, 90)}"`);
  console.log(`    ${emo(m)}\n`);
}
