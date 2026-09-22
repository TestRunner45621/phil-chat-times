// stats2.js — chartable counts from the compact day files. Usage: node tools/stats2.js "<log folder>"
'use strict';
const fs = require('fs');
const path = require('path');
const logDir = process.argv[2];
const wd = path.join(logDir, 'working');
const days = fs.readdirSync(wd).filter(f => /^\d\d-\d\d\.md$/.test(f)).sort();
const msgs = [];
for (const d of days) {
  const lines = fs.readFileSync(path.join(wd, d), 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^(\d\d):(\d\d) ([^:]+?): (.*)$/);
    if (!m) continue;
    let text = m[4];
    // strip reply context, image tags, reactions, edit mark
    text = text.replace(/ ↩\([^)]*"\)$/, '').replace(/ ↩\(.*?"\)/g, '').replace(/\[img: [^\]]+\]/g, '').replace(/\{[^}]*\}\s*✎?$/, '').replace(/ ✎$/, '');
    msgs.push({ day: d.slice(0, 5), hm: m[1] + ':' + m[2], name: m[3], text });
  }
}
console.log('messages parsed:', msgs.length);
let out = `# Stats 2 — computed from working/*.md (${msgs.length} messages)\n\n`;

// --- philosopher mentions
const PHIL = ['Plato', 'Socrates', 'Aristotle', 'Kant', 'Hegel', 'Nietzsche', 'Deleuze', 'Heidegger', 'Wittgenstein', 'Hume', 'Descartes', 'Spinoza', 'Leibniz', 'Kierkegaard', 'Marx', 'Foucault', 'Dewey', 'Rorty', 'Peirce', 'James', 'Russell', 'Frege', 'Quine', 'Sellars', 'Dennett', 'Chalmers', 'Nagel', 'Rand', 'Sartre', 'Camus', 'Arendt', 'Rawls', 'Nozick', 'Singer', 'Parfit', 'Mill', 'Bentham', 'Hobbes', 'Locke', 'Rousseau', 'Schopenhauer', 'Husserl', 'Merleau-Ponty', 'Derrida', 'Lacan', 'Zizek', 'Land', 'Laruelle', 'Badiou', 'Bataille', 'Dworkin', 'Beauvoir', 'Cixous', 'Butler', 'Stirner', 'Aquinas', 'Augustine', 'Plantinga', 'Swinburne', 'Oppy', 'Gettier', 'Moore', 'Ramsey', 'Popper', 'Kuhn', 'Berlin', 'Watts', 'Emerson', 'Thoreau', 'Laozi', 'Confucius', 'Epicurus', 'Zeno', 'Pythagoras', 'Fisher', 'Iamblichus', 'Porphyry', 'Freud', 'Jung', 'Weber', 'Harris', 'Huemer', 'Tolle', 'Schmid', 'Anderson', 'Fodor'];
const philCount = {}, philWho = {};
for (const m of msgs) for (const p of PHIL) {
  const re = new RegExp('\\b' + p.replace('-', '[- ]') + '(s|ian|ean|ist|ists|ism|isms|\'s)?\\b', 'gi');
  const hits = (m.text.match(re) || []).length;
  if (hits) { philCount[p] = (philCount[p] || 0) + hits; (philWho[p] ||= {})[m.name] = ((philWho[p] || {})[m.name] || 0) + hits; }
}
out += `## Philosopher of the week — mentions (name + derived forms, e.g. Kantian)\n`;
for (const [p, c] of Object.entries(philCount).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const who = Object.entries(philWho[p]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, k]) => `${n} ${k}`).join(', ');
  out += `- ${p}: ${c}  (${who})\n`;
}

// --- phrase counts by person
function countBy(re, label) {
  const by = {}; let total = 0; const ex = [];
  for (const m of msgs) { const k = (m.text.match(re) || []).length; if (k) { by[m.name] = (by[m.name] || 0) + k; total += k; if (ex.length < 12) ex.push(`${m.day} ${m.hm} ${m.name}: ${m.text.slice(0, 110)}`); } }
  out += `\n## "${label}" — ${total} uses\n`;
  for (const [n, c] of Object.entries(by).sort((a, b) => b[1] - a[1])) out += `- ${n}: ${c}\n`;
  out += ex.map(e => `  · ${e}`).join('\n') + '\n';
}
countBy(/recogni[sz]e[sd]? (the |this |that |a |which |what |the correct )?distinction|recognition of the distinction|recogni[sz]ing the distinction/gi, 'recognize the distinction');
countBy(/community of inquir/gi, 'community of inquirers');
countBy(/\bwarrant(ed|s)?\b/gi, 'warrant');
countBy(/\bepistemic\b/gi, 'epistemic');
countBy(/\bslop\b/gi, 'slop');
countBy(/\bretard(ed|s)?\b/gi, 'retard(ed)');
countBy(/\bbased\b/gi, 'based');
countBy(/\bgoon(er|ing|ed|s)?\b/gi, 'goon');
countBy(/\bclaude\b/gi, 'claude');
countBy(/\bgrok\b/gi, 'grok');
countBy(/\bchatgpt\b|\bgpt\b/gi, 'chatgpt');
countBy(/\bkady\b/gi, 'kady');
countBy(/\bmessiah\b|\bprophet\b|\bparchment\b/gi, 'messiah/prophet/parchment');
countBy(/\bvc\b/gi, 'vc');
countBy(/\bdebate\b/gi, 'debate');
countBy(/\bedit(or|ors)\b/gi, 'editor(s)');

// --- Quigley nicknames
const nick = {};
for (const m of msgs) for (const w of (m.text.match(/\bquig[a-z]*\b|\bsupervillainy\b|\bsuper\b|\btony\b|\banthony\b|\bthe quigster\b/gi) || [])) nick[w.toLowerCase()] = (nick[w.toLowerCase()] || 0) + 1;
out += `\n## Names for Quigley (all speakers)\n` + Object.entries(nick).sort((a, b) => b[1] - a[1]).map(([w, c]) => `- ${w}: ${c}`).join('\n') + '\n';

// --- Quigley's own most used words (function-word stripped)
const STOP = new Set('the a an and or but of to in on at for with is are was were be been it that this i you he she they we my your his her their its not no yes so if as by from do does did have has had can could would should just like what which who how why when where there here then than too very also about into out up down more most some any all not what'.split(' '));
const qw = {}; let qn = 0;
for (const m of msgs) if (m.name === 'Quigley') { qn++; for (const w of (m.text.toLowerCase().match(/[a-z']+/g) || [])) if (w.length > 3 && !STOP.has(w)) qw[w] = (qw[w] || 0) + 1; }
out += `\n## Quigley's vocabulary (${qn} messages)\n` + Object.entries(qw).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, c]) => `${w} ${c}`).join(', ') + '\n';

// --- who replies to Quigley most / Quigley replies to
// (reply pairs already in stats.md)

// --- first and last message of the week per person (for absences)
const first = {}, last = {}, cnt = {};
for (const m of msgs) { const k = m.name; if (!first[k]) first[k] = `${m.day} ${m.hm}`; last[k] = `${m.day} ${m.hm}`; cnt[k] = (cnt[k] || 0) + 1; }
out += `\n## First and last seen (people with 30+ messages)\n`;
for (const [n, c] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) if (c >= 30) out += `- ${n} (${c}): ${first[n]} → ${last[n]}\n`;

// --- longest silence per top person (largest gap between consecutive messages, in hours)
out += `\n## Message length: average characters per message (people with 100+ messages)\n`;
const len = {};
for (const m of msgs) { (len[m.name] ||= []).push(m.text.length); }
for (const [n, arr] of Object.entries(len).sort((a, b) => b[1].length - a[1].length)) if (arr.length >= 100) out += `- ${n}: ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(0)} chars avg, longest ${Math.max(...arr)}\n`;

// --- "editors" requests list
out += `\n## Every message addressed to the editors / the paper\n`;
for (const m of msgs) if (/\beditors?\b|phil ?chat ?times|\bthe times\b|newspaper|the paper\b/i.test(m.text)) out += `- ${m.day} ${m.hm} ${m.name}: ${m.text.slice(0, 220)}\n`;

fs.writeFileSync(path.join(wd, 'index', 'stats2.md'), out);
console.log('written', path.join(wd, 'index', 'stats2.md'), out.length, 'bytes');
