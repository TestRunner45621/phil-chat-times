/* Count the week directly off the export rather than taking anything on trust.
 *   node stats.js "<path to log folder>"
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const work = path.join(dir, 'working');
const files = fs.readdirSync(work).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();

const HEAD = /^### \[(\w{3}) (\w{3}) (\d+), (\d+):(\d+) (AM|PM) ET\] (.+?) (@\S+) · msg `(\d+)`/;

const byPerson = new Map();
const byDay = new Map();
const byHour = new Array(24).fill(0);
const emoji = new Map();
const reactedBy = new Map();
let msgs = 0, images = 0, reactions = 0, edited = 0, reactedMsgs = 0;

for (const f of files) {
  const blocks = fs.readFileSync(path.join(work, f), 'utf8').split(/\n---\n/);
  for (const b of blocks) {
    const m = HEAD.exec(b.trim());
    if (!m) continue;
    msgs++;
    const [, , , , hh, , ap, name, handle] = m;
    let h = +hh % 12; if (ap === 'PM') h += 12;
    byHour[h]++;
    byDay.set(f, (byDay.get(f) || 0) + 1);
    const key = `${name} ${handle}`;
    if (!byPerson.has(key)) byPerson.set(key, { n: 0, r: 0, landed: 0 });
    byPerson.get(key).n++;
    if (/✏️ edited/.test(b)) edited++;
    images += (b.match(/🖼 \*\*Attached image:\*\*/g) || []).length;
    const rx = /^⭐ \*\*Reactions:\*\* (.*)$/m.exec(b);
    if (rx) {
      reactedMsgs++;
      byPerson.get(key).landed++;
      for (const e of rx[1].matchAll(/(\S+) ×(\d+)/g)) {
        const n = +e[2];
        reactions += n;
        byPerson.get(key).r += n;
        emoji.set(e[1], (emoji.get(e[1]) || 0) + n);
      }
    }
  }
}

const rank = [...byPerson].sort((a, b) => b[1].n - a[1].n);
console.log(`MESSAGES ${msgs} · IMAGES ${images} · REACTIONS ${reactions} · REACTED MSGS ${reactedMsgs} (${(100*reactedMsgs/msgs).toFixed(1)}%) · EDITED ${edited} · PEOPLE ${byPerson.size}`);
console.log('\n=== BY DAY ===');
for (const [d, n] of byDay) console.log(`${d}  ${n}`);
console.log('\n=== BY HOUR (ET) ===');
byHour.forEach((n, i) => console.log(`${String(i).padStart(2,'0')}  ${n}`));
console.log('\n=== TOP 30 POSTERS  (msgs / reactions recd / msgs that landed / hit rate) ===');
for (const [k, v] of rank.slice(0, 30))
  console.log(`${k.padEnd(46)} ${String(v.n).padStart(5)}  ${String(v.r).padStart(4)}  ${String(v.landed).padStart(4)}  ${(100*v.landed/v.n).toFixed(1)}%`);
console.log('\n=== TOP 25 EMOJI ===');
for (const [e, n] of [...emoji].sort((a,b)=>b[1]-a[1]).slice(0,25)) console.log(`${e.padEnd(28)} ${n}`);
console.log(`\ndistinct emoji: ${emoji.size}`);
const tail = [...byPerson.values()];
console.log(`\n=== LONG TAIL ===\n>1000: ${tail.filter(v=>v.n>1000).length} · 100-999: ${tail.filter(v=>v.n>=100&&v.n<1000).length} · 10-99: ${tail.filter(v=>v.n>=10&&v.n<100).length} · <10: ${tail.filter(v=>v.n<10).length} · exactly 1: ${tail.filter(v=>v.n===1).length} · zero reactions all week: ${tail.filter(v=>v.landed===0).length}`);
