// person.js — one account, end to end, with reply context.
//
// Reading a person straight through is the method that finds what reaction-
// hunting cannot: the position held all week, the line that lands only because
// of what it answers, the sincere thing filed at four in the morning.
//
//     node tools/person.js "<log folder>" <Name> [minLength=0]
//     node tools/person.js "<log folder>" TAIL [maxMessages=60]   every quiet account
//
// Names are matched case-insensitively on any prefix, so "sizz" finds Sizzurp.
'use strict';
const { readLog, counts, flat } = require('./log');

const dir = process.argv[2];
const who = process.argv[3];
if (!dir || !who) { console.error('usage: node person.js "<log folder>" <Name|TAIL> [minLen]'); process.exit(1); }

const { msgs, handles } = readLog(dir);

if (who.toUpperCase() === 'TAIL') {
  const max = Number(process.argv[4]) || 60;
  const quiet = counts(msgs).filter(([, n]) => n <= max);
  console.log(`# ${quiet.length} accounts at ${max} messages or fewer\n`);
  for (const [name, n] of quiet) {
    console.log(`--- ${name} ${handles.get(name) || ''} — ${n} message${n > 1 ? 's' : ''}`);
    for (const m of msgs.filter((x) => x.name === name)) {
      const r = m.reacts ? `  {${m.reacts}}` : '';
      console.log(`    ${m.day} ${m.time}  ${flat(m.text).slice(0, 220) || '(image)'}${r}`);
    }
    console.log('');
  }
  process.exit(0);
}

const minLen = Number(process.argv[4]) || 0;
const target = msgs.map((m) => m.name).find((n) => n.toLowerCase().startsWith(who.toLowerCase()));
if (!target) { console.error(`no account starting "${who}"`); process.exit(1); }

const mine = msgs.filter((m) => m.name === target && flat(m.text).length >= minLen);
const got = msgs.filter((m) => m.replyTo === target).length;
const made = mine.filter((m) => m.replyTo).length;
const reacts = mine.reduce((a, m) => a + m.reacts, 0);

console.log(`# ${target} ${handles.get(target) || ''}`);
console.log(`# ${mine.length} shown of ${msgs.filter((m) => m.name === target).length}; replies made ${made}, replies received ${got}, reactions ${reacts}\n`);

let day = '';
for (const m of mine) {
  if (m.day !== day) { day = m.day; console.log(`\n===== ${m.day} ${m.dow} =====\n`); }
  if (m.replyTo) console.log(`  ↩ ${m.replyTo}: "${flat(m.replyQuote).slice(0, 90)}"`);
  const r = m.reacts ? `   {${Object.entries(m.reactions).map(([e, n]) => e + '×' + n).join(' ')}}` : '';
  const img = m.images.length ? ` [img ${m.images.join(', ')}]` : '';
  console.log(`${m.time}  ${flat(m.text)}${img}${r}\n`);
}
