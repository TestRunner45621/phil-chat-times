/* Society stats for the after-publication revision page: who replies to whom, who
 * mentions whom, who gets reacted to, from the working/ day files.
 *   node society.js "<working dir>" > society.json
 */
const fs = require('fs');
const path = require('path');
const work = process.argv[2];
const files = fs.readdirSync(work).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();

const LINE = /^(\d\d):(\d\d) ([^:]+?): (.*)$/;
const msgs = [];
const alias = new Map(); // handle (no @) -> name, plus lowercase names
for (const f of files) {
  const day = f.slice(0, 5);
  const hl = /^Handles: (.*)$/m.exec(fs.readFileSync(path.join(work, f), "utf8"));
  if (hl) for (const p of hl[1].split(/,s*/)) { const q = /^(.+?)=@(.+)$/.exec(p.trim()); if (q) alias.set(q[2].toLowerCase(), q[1].trim()); }
  for (const raw of fs.readFileSync(path.join(work, f), 'utf8').split('\n')) {
    const m = LINE.exec(raw);
    if (!m) continue;
    let text = m[4];
    let reacts = {};
    const rm = /\{([^{}]*)\}\s*(✎=edited)?\s*$/.exec(text);
    if (rm && /×\d+/.test(rm[1])) {
      for (const p of rm[1].split(/,\s*|\s+(?=[^\s×]+×\d+)/)) {
        const q = /^(.+?)×(\d+)$/.exec(p.trim());
        if (q) reacts[q[1]] = (reacts[q[1]] || 0) + +q[2];
      }
      text = text.slice(0, rm.index);
    }
    let replyTo = null;
    const r = /↩\(([^:()]+?): "/.exec(text);
    if (r) { replyTo = r[1].trim(); text = text.slice(0, r.index); }
    const mentions = [...text.matchAll(/@([A-Za-z][\w.'\\-]*(?: [A-Z][\w']*)?)/g)].map((x) => x[1]);
    msgs.push({ day, h: +m[1], mi: +m[2], name: m[3].trim(), text: text.trim(), reacts, replyTo, mentions });
  }
}

const count = new Map();
for (const x of msgs) count.set(x.name, (count.get(x.name) || 0) + 1);
const people = [...count.entries()].sort((a, b) => b[1] - a[1]);
const names = new Set(count.keys());

// reply graph
const edge = new Map(); // "a>b" -> n
const out = new Map(), inn = new Map();
let replies = 0, selfReplies = 0;
for (const x of msgs) {
  if (!x.replyTo || !names.has(x.replyTo)) continue;
  if (x.replyTo === x.name) { selfReplies++; continue; }
  replies++;
  const k = x.name + '>' + x.replyTo;
  edge.set(k, (edge.get(k) || 0) + 1);
  out.set(x.name, (out.get(x.name) || 0) + 1);
  inn.set(x.replyTo, (inn.get(x.replyTo) || 0) + 1);
}
const pairs = new Map(); // unordered
for (const [k, n] of edge) {
  const [a, b] = k.split('>');
  const key = [a, b].sort().join(' & ');
  const p = pairs.get(key) || { a: [a, b].sort()[0], b: [a, b].sort()[1], n: 0, ab: 0, ba: 0 };
  p.n += n;
  if (a === p.a) p.ab += n; else p.ba += n;
  pairs.set(key, p);
}
const topPairs = [...pairs.values()].sort((a, b) => b.n - a.n).slice(0, 40);

// mentions graph
const ment = new Map();
for (const x of msgs) for (const mm of x.mentions) {
  const low = mm.toLowerCase();
  let t = [...names].find((nm) => nm.toLowerCase() === low) || alias.get(low) || ({ supervillainy: "Quigley", hpaigecr: "HPCR", lizzie: "Lizzy", will: "Willow" })[low];
  if (t && !names.has(t)) t = null;
  if (!t || t === x.name) continue;
  const k = x.name + '>' + t;
  ment.set(k, (ment.get(k) || 0) + 1);
}
const topMentions = [...ment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

// per person
const per = people.map(([name, n]) => {
  const outs = [...edge.entries()].filter(([k]) => k.startsWith(name + '>')).map(([k, v]) => [k.split('>')[1], v]).sort((a, b) => b[1] - a[1]);
  const ins = [...edge.entries()].filter(([k]) => k.endsWith('>' + name)).map(([k, v]) => [k.split('>')[0], v]).sort((a, b) => b[1] - a[1]);
  let reacts = 0, reacted = 0; const emo = {};
  let best = null;
  for (const x of msgs) if (x.name === name) {
    const tot = Object.values(x.reacts).reduce((a, b) => a + b, 0);
    if (tot) { reacted++; reacts += tot; for (const [e, c] of Object.entries(x.reacts)) emo[e] = (emo[e] || 0) + c; }
    if (!best || tot > best.tot) best = { tot, text: x.text.slice(0, 140), day: x.day, h: x.h, mi: x.mi };
  }
  return {
    name, msgs: n, repliesMade: out.get(name) || 0, repliesGot: inn.get(name) || 0,
    distinctOut: outs.length, distinctIn: ins.length,
    topOut: outs.slice(0, 3), topIn: ins.slice(0, 3),
    reacts, reacted, hit: n ? +(100 * reacted / n).toFixed(1) : 0, perMsg: n ? +(reacts / n).toFixed(2) : 0,
    topEmo: Object.entries(emo).sort((a, b) => b[1] - a[1]).slice(0, 3), best,
  };
});

// emotes overall
const emoAll = {};
let reactTotal = 0;
for (const x of msgs) for (const [e, c] of Object.entries(x.reacts)) { emoAll[e] = (emoAll[e] || 0) + c; reactTotal += c; }

// unanswered: people with most messages and fewest replies received per 100
const wall = per.filter((p) => p.msgs >= 60).map((p) => ({ name: p.name, msgs: p.msgs, got: p.repliesGot, rate: +(100 * p.repliesGot / p.msgs).toFixed(1) })).sort((a, b) => a.rate - b.rate);
const hosts = per.filter((p) => p.msgs >= 60).map((p) => ({ name: p.name, msgs: p.msgs, made: p.repliesMade, rate: +(100 * p.repliesMade / p.msgs).toFixed(1) })).sort((a, b) => b.rate - a.rate);
const belles = per.filter((p) => p.msgs >= 60).map((p) => ({ name: p.name, msgs: p.msgs, got: p.repliesGot, rate: +(100 * p.repliesGot / p.msgs).toFixed(1) })).sort((a, b) => b.rate - a.rate);

// longest back-and-forth: consecutive replies alternating between two people within the same day, gap <= 20 min
let bestRun = null;
const byDay = {};
for (const x of msgs) (byDay[x.day] = byDay[x.day] || []).push(x);
for (const day of Object.keys(byDay)) {
  const arr = byDay[day];
  let run = null;
  for (const x of arr) {
    const t = x.h * 60 + x.mi;
    if (x.replyTo && names.has(x.replyTo) && x.replyTo !== x.name) {
      const pair = [x.name, x.replyTo].sort().join(' & ');
      if (run && run.pair === pair && t - run.last <= 20) { run.n++; run.last = t; }
      else run = { pair, n: 1, start: t, last: t, day };
      if (!bestRun || run.n > bestRun.n) bestRun = { ...run };
    }
  }
}

// mutual: pairs where both directions >= 10
const mutual = [...pairs.values()].filter((p) => p.ab >= 10 && p.ba >= 10).sort((a, b) => b.n - a.n);
// one-way: pairs with the most lopsided ratio, n>=15
const oneWay = [...pairs.values()].filter((p) => p.n >= 15).map((p) => ({ ...p, ratio: Math.max(p.ab, p.ba) / Math.max(1, Math.min(p.ab, p.ba)) })).sort((a, b) => b.ratio - a.ratio).slice(0, 8);

console.log(JSON.stringify({
  totals: { msgs: msgs.length, speakers: people.length, replies, selfReplies, reactTotal, mentions: [...ment.values()].reduce((a, b) => a + b, 0) },
  people: per.slice(0, 40), topPairs, mutual, oneWay, topMentions, emoAll: Object.entries(emoAll).sort((a, b) => b[1] - a[1]).slice(0, 15),
  wall: wall.slice(0, 8), hosts: hosts.slice(0, 8), belles: belles.slice(0, 8), bestRun,
}, null, 1));
