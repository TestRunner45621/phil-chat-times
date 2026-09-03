// vocab.js — who says a word, how often, and where.
//
// For checking a hunch before writing it as a fact. "Quigley said 'recognize the
// distinction' twenty-three times" is a factoid; "Quigley says that a lot" is
// not, and this is the difference between them.
//
//     node tools/vocab.js "<log folder>" "recognize the distinction" cope vc
//     node tools/vocab.js "<log folder>" --top [n=60]     most-used words this week
//
// Multi-word phrases are matched loosely across whitespace. Matching is
// case-insensitive and counts each message once per term.
'use strict';
const { readLog, flat } = require('./log');

const dir = process.argv[2];
if (!dir) { console.error('usage: node vocab.js "<log folder>" <word|phrase> ... | --top [n]'); process.exit(1); }
const terms = process.argv.slice(3);
const { msgs } = readLog(dir);

if (!terms.length || terms[0] === '--top') {
  const n = Number(terms[1]) || 60;
  const STOP = new Set(('the a an and or but if is are was were be been being to of in on at for with '
    + 'that this it its he she they them his her their you your i im me my we us our not no yes so do does '
    + 'did done have has had just like about what which who when where why how can cant will would could '
    + 'should there here then than as by from up out one all any some more most much very really thing '
    + 'think know say said get got go going want need make made because also even still only').split(' '));
  const freq = new Map();
  for (const m of msgs) {
    for (const w of flat(m.text).toLowerCase().match(/[a-z][a-z']{2,}/g) || []) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .forEach(([w, c]) => console.log(String(c).padStart(5) + '  ' + w));
  process.exit(0);
}

for (const term of terms) {
  const re = new RegExp(term.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i');
  const hits = msgs.filter((m) => re.test(flat(m.text)));
  const by = new Map();
  for (const m of hits) by.set(m.name, (by.get(m.name) || 0) + 1);
  const who = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ');
  console.log(`\n=== "${term}" — ${hits.length} message${hits.length === 1 ? '' : 's'}`);
  console.log(`    ${who || '(nobody)'}\n`);
  for (const m of hits.slice(0, 12)) {
    console.log(`    ${m.day} ${m.time} ${m.name}: ${flat(m.text).slice(0, 200)}`);
  }
  if (hits.length > 12) console.log(`    … and ${hits.length - 12} more`);
}
console.log('');
