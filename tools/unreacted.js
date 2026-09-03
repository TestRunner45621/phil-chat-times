// unreacted.js — the diamonds nobody pressed a button at.
//
// Reactions are a filter, but a lazy one: they find the jokes and miss the
// arguments. A message that drew three separate replies and no reactions is one
// the room actually engaged with and never credited. Hunting only by reaction is
// why a paper comes out all gags.
//
//     node tools/unreacted.js "<log folder>" [mode]
//       engaged   (default) 3+ distinct people replied, zero reactions
//       long      long messages nobody reacted to
//       caps      unreacted shouting
//       questions questions that got no reply and no reaction
//       threads   the longest back-and-forths of the week
//       all
'use strict';
const { readLog, replyGraph, flat } = require('./log');

const dir = process.argv[2];
if (!dir) { console.error('usage: node unreacted.js "<log folder>" [mode]'); process.exit(1); }
const mode = process.argv[3] || 'engaged';

const { msgs } = readLog(dir);
replyGraph(msgs);

const show = (m, tag) => {
  console.log(`[${tag}] ${m.name} — ${m.day} ${m.dow} ${m.time}`);
  console.log(`    ${flat(m.text).slice(0, 420)}`);
  if (m.replyTo) console.log(`    ↩ ${m.replyTo}: "${flat(m.replyQuote).slice(0, 80)}"`);
  console.log('');
};

const cands = msgs.filter((m) => m.reacts === 0 && m.text.length > 14);

if (mode === 'engaged' || mode === 'all') {
  console.log('########## ENGAGED BUT UNREWARDED — 3+ distinct repliers, zero reactions ##########\n');
  cands.filter((m) => m.replies >= 3).sort((a, b) => b.replies - a.replies)
    .forEach((m) => show(m, m.replies + ' replies'));
}

if (mode === 'long' || mode === 'all') {
  console.log('\n########## LONGEST UNREACTED ##########\n');
  cands.filter((m) => m.text.length > 500).sort((a, b) => b.text.length - a.text.length)
    .slice(0, 40).forEach((m) => show(m, m.text.length + 'ch'));
}

if (mode === 'caps' || mode === 'all') {
  console.log('\n########## UNREACTED SHOUTING ##########\n');
  cands.filter((m) => {
    if (m.text.length < 18 || m.text.length > 220) return false;
    const letters = m.text.replace(/[^A-Za-z]/g, '');
    return letters.length > 10 && m.text.replace(/[^A-Z]/g, '').length / letters.length > 0.7;
  }).forEach((m) => show(m, 'CAPS'));
}

if (mode === 'questions' || mode === 'all') {
  console.log('\n########## QUESTIONS NOBODY ANSWERED ##########\n');
  cands.filter((m) => m.replies === 0 && /\?\s*$/.test(m.text) && m.text.length > 25)
    .forEach((m) => show(m, 'unanswered'));
}

if (mode === 'threads' || mode === 'all') {
  console.log('\n########## LONGEST BACK-AND-FORTHS ##########\n');
  const runs = [];
  let run = null;
  for (const m of msgs) {
    if (!m.replyTo || m.replyTo === m.name) continue;
    const pair = [m.name, m.replyTo].sort().join(' & ');
    if (run && run.pair === pair && run.day === m.day && m.mins - run.last <= 20) {
      run.n++; run.last = m.mins;
    } else {
      run = { pair, day: m.day, dow: m.dow, n: 1, start: m.mins, last: m.mins };
      runs.push(run);
    }
  }
  runs.sort((a, b) => b.n - a.n).slice(0, 15).forEach((r) => {
    const hh = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    console.log(`${String(r.n).padStart(3)} replies  ${r.pair} — ${r.day} ${r.dow} ${hh(r.start)}–${hh(r.last)}`);
  });
  console.log('');
}
