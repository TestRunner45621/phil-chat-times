/* Effort metrics, per the readership's own commissions:
 *   - average message length (Ape/Stackhouse asked for it by name)
 *   - replies received  (My Name: "make the ai capture reply rates")
 * Reaction counts alone reward the kekw farmers over the people
 * actually writing; these two are the corrective.
 *
 *   node effort.js "<path to log folder>"
 */
const fs = require('fs');
const path = require('path');

const work = path.join(process.argv[2], 'working');
const files = fs.readdirSync(work).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();
const HEAD = /^### \[[^\]]+\] (.+?) (@\S+) · msg `(\d+)`/;

const P = new Map();           // handle -> stats
const nameToHandle = new Map();
const repliedTo = new Map();   // display name -> count of replies received
const get = (h, n) => {
  if (!P.has(h)) P.set(h, { name: n, msgs: 0, chars: 0, reacts: 0, landed: 0, repliesMade: 0, longest: 0 });
  return P.get(h);
};

for (const f of files) {
  for (const b of fs.readFileSync(path.join(work, f), 'utf8').split(/\n---\n/)) {
    const lines = b.trim().split('\n');
    const m = HEAD.exec(lines[0] || '');
    if (!m) continue;
    const [, name, handle] = m;
    nameToHandle.set(name, handle);
    const p = get(handle, name);
    p.msgs++;

    // body = everything that isn't the heading, the reply-quote, reactions,
    // attachments or bare link echoes
    const body = lines.slice(1).filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('↩ ') && !t.startsWith('⭐ ') &&
             !t.startsWith('🖼 ') && !t.startsWith('📎 ') && !t.startsWith('🔗 ');
    }).join('\n');
    p.chars += body.length;
    if (body.length > p.longest) p.longest = body.length;

    const rq = /^↩ \*replying to (.+?): "/m.exec(b);
    if (rq) {
      p.repliesMade++;
      repliedTo.set(rq[1], (repliedTo.get(rq[1]) || 0) + 1);
    }
    const rx = /^⭐ \*\*Reactions:\*\* (.*)$/m.exec(b);
    if (rx) {
      p.landed++;
      p.reacts += [...rx[1].matchAll(/×(\d+)/g)].reduce((a, x) => a + +x[1], 0);
    }
  }
}

const rows = [...P].filter(([, v]) => v.msgs >= (+process.argv[3]||90)).map(([h, v]) => ({
  handle: h, name: v.name, msgs: v.msgs, chars: v.chars,
  avg: v.chars / v.msgs, reacts: v.reacts,
  hit: (100 * v.landed) / v.msgs,
  got: repliedTo.get(v.name) || 0,
  gotPer: (100 * (repliedTo.get(v.name) || 0)) / v.msgs,
  longest: v.longest,
}));

const show = (title, key, fmt) => {
  console.log(`\n=== ${title} ===`);
  for (const r of [...rows].sort((a, b) => b[key] - a[key]).slice(0, 22))
    console.log(`${r.name.slice(0, 34).padEnd(35)} ${fmt(r)}`);
};

show('AVERAGE MESSAGE LENGTH (chars) — min 40 msgs', 'avg',
  (r) => `${r.avg.toFixed(0).padStart(5)}  (${r.msgs} msgs, ${(r.chars / 1000).toFixed(0)}k chars total)`);
show('TOTAL VOLUME WRITTEN (chars)', 'chars',
  (r) => `${(r.chars / 1000).toFixed(1).padStart(7)}k  avg ${r.avg.toFixed(0)}`);
show('REPLIES RECEIVED', 'got',
  (r) => `${String(r.got).padStart(4)}  (${r.gotPer.toFixed(1)}% of their msgs drew a reply)`);
show('REPLY RATE — replies received per 100 messages sent', 'gotPer',
  (r) => `${r.gotPer.toFixed(1).padStart(5)}%  (${r.got} replies on ${r.msgs} msgs)`);
show('LONGEST SINGLE MESSAGE (chars)', 'longest',
  (r) => `${String(r.longest).padStart(5)}`);

console.log('\n=== COMPOSITE: the effort table ===');
console.log('rank by (avg length percentile + reply-rate percentile), reactions ignored');
const pct = (k) => {
  const s = [...rows].sort((a, b) => a[k] - b[k]);
  const map = new Map();
  s.forEach((r, i) => map.set(r.handle, (100 * i) / (s.length - 1)));
  return map;
};
const pa = pct('avg'), pr = pct('gotPer'), ph = pct('hit');
const comp = rows.map((r) => ({ ...r, score: (pa.get(r.handle) + pr.get(r.handle)) / 2, hp: ph.get(r.handle) }));
for (const r of comp.sort((a, b) => b.score - a.score).slice(0, 22))
  console.log(`${r.name.slice(0, 30).padEnd(31)} effort ${r.score.toFixed(0).padStart(3)}  | avg ${r.avg.toFixed(0).padStart(4)}ch  reply ${r.gotPer.toFixed(1).padStart(5)}%  | react-pctile ${r.hp.toFixed(0)}`);
