/* Find the diamonds nobody pressed a button at.
 *
 * Reactions are a filter, but a lazy one: only 7.4% of messages get any,
 * and the room replies far more often than it reacts. A message that drew
 * three separate replies and zero reactions is a message the room actually
 * engaged with — it just never got credited. That is what this finds.
 *
 * Discord's reply quotes carry the first ~78 chars of the parent message,
 * so we can rebuild a rough reply graph from the transcript alone.
 *
 *   node unreacted.js "<log folder>" [mode]
 *      mode: engaged (default) | long | caps | questions | all
 */
const fs = require('fs');
const path = require('path');

const work = path.join(process.argv[2], 'working');
const mode = process.argv[3] || 'engaged';
const files = fs.readdirSync(work).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();
const HEAD = /^### \[([^\]]+)\] (.+?) (@\S+) · msg `(\d+)`/;

const msgs = [];
const quotes = new Map(); // "name|prefix" -> Set of repliers

for (const f of files) {
  for (const b of fs.readFileSync(path.join(work, f), 'utf8').split(/\n---\n/)) {
    const lines = b.trim().split('\n');
    const m = HEAD.exec(lines[0] || '');
    if (!m) continue;
    const [, when, name, handle] = m;
    const body = lines.slice(1).filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('↩ ') && !t.startsWith('⭐ ') &&
             !t.startsWith('🖼 ') && !t.startsWith('📎 ') && !t.startsWith('🔗 ');
    }).join(' ').trim();
    const reacted = /^⭐/m.test(b);
    const rq = /^↩ \*replying to (.+?): "(.*?)…?"\*$/m.exec(b);
    if (rq) {
      const k = rq[1] + '|' + rq[2].slice(0, 40);
      if (!quotes.has(k)) quotes.set(k, new Set());
      quotes.get(k).add(name);
    }
    msgs.push({ f, when, name, body, reacted, hasImg: /^🖼/m.test(b) });
  }
}

// count distinct repliers per message
for (const x of msgs) {
  const k = x.name + '|' + x.body.slice(0, 40);
  const s = quotes.get(k);
  x.replies = s ? s.size : 0;
  // don't count self-replies as engagement
  if (s && s.has(x.name)) x.replies = Math.max(0, x.replies - 1);
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const out = (x, tag) =>
  console.log(`[${tag}] ${x.name.slice(0, 22)} — ${x.when.replace(/,.*ET/, '')} (${x.f})\n    ${clean(x.body).slice(0, 420)}\n`);

const cands = msgs.filter((x) => !x.reacted && x.body.length > 14);

if (mode === 'engaged' || mode === 'all') {
  console.log('########## ENGAGED BUT UNREWARDED — 3+ distinct people replied, zero reactions ##########\n');
  cands.filter((x) => x.replies >= 3).sort((a, b) => b.replies - a.replies)
    .forEach((x) => out(x, x.replies + ' replies'));
}
if (mode === 'long' || mode === 'all') {
  console.log('\n########## LONGEST UNREACTED MESSAGES ##########\n');
  cands.filter((x) => x.body.length > 500).sort((a, b) => b.body.length - a.body.length)
    .slice(0, 40).forEach((x) => out(x, x.body.length + 'ch'));
}
if (mode === 'caps' || mode === 'all') {
  console.log('\n########## UNREACTED SHOUTING ##########\n');
  cands.filter((x) => x.body.length > 18 && x.body.length < 220 &&
    x.body.replace(/[^A-Z]/g, '').length / x.body.replace(/[^A-Za-z]/g, '').length > 0.7)
    .forEach((x) => out(x, 'CAPS'));
}
if (mode === 'questions' || mode === 'all') {
  console.log('\n########## UNREACTED QUESTIONS NOBODY ANSWERED ##########\n');
  cands.filter((x) => x.replies === 0 && /\?\s*$/.test(x.body) &&
    x.body.length > 25 && x.body.length < 190 && !/^https?:/.test(x.body))
    .forEach((x) => out(x, 'unanswered'));
}
