// log.js — the one place the compact day files are parsed.
//
// split.js writes working/MM-DD.md as one line per message:
//     HH:MM Name: text ↩(Name: "quoted") [img: file (TYPE)] {KEKW×2} ✎
// Every reading tool imports this instead of re-inventing that regex, which is
// how the older tools ended up silently returning nothing when the log format
// changed under them.
//
//     const { readLog, flat } = require('./log');
//     const { msgs, handles, days } = readLog('<path to log folder>');
//
// A message is:
//     { day:'08-24', dow:'Mon', time:'09:32', mins:572,
//       name:'Lizzy', handle:'@nyabeille', text:'…',
//       replyTo:'Jere'|null, replyQuote:'…',
//       images:['1541…jpg'], reactions:{KEKW:4,dead:5}, reacts:9,
//       edited:false, line:'<the raw line>' }
'use strict';
const fs = require('fs');
const path = require('path');

const LINE = /^(\d\d):(\d\d) ([^:]{1,40}?): ([\s\S]*)$/;
const DAYHEAD = /^## (\d\d-\d\d) (\w{3}) /;

/* Messages carry ⏎ where the author pressed return. Flatten for one-line output. */
const flat = (s) => String(s).replace(/⏎/g, ' / ').replace(/\s+/g, ' ').trim();

/* The 8.28 log onwards is compact. Everything before it is the older per-message
 * form Oracle Bot emitted, in UTC, under display names:
 *     ### [2026-08-24 06:52 UTC] lizzie !?! @nyabeille · msg `1541…`
 *     ↩ *replying to lizzie !?!: "is anyone alive"*
 *     Yes and no.
 *     ⭐ **Reactions:** :KEKW: ×2
 * Both are read here so the finders work on any log in the archive. Note the
 * times in an old log are UTC and the names are display names, not print names. */
const VERBOSE = /^### \[([^\]]+)\] (.+?) (@\S+) · msg/m;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/* Two timestamp forms have been used in the archive:
 *   [Fri Aug 14, 12:02 AM ET]   day files split for reading (Eastern)
 *   [2026-08-24 06:52 UTC]      the raw export heading */
function parseStamp(s) {
  let m = /^(\w{3}) (\w{3}) (\d{1,2}), (\d{1,2}):(\d\d) (AM|PM) ET$/.exec(s.trim());
  if (m) {
    let h = Number(m[4]) % 12;
    if (m[6] === 'PM') h += 12;
    return { day: pad(MON[m[2]]) + '-' + pad(Number(m[3])), dow: m[1], hh: h, mm: Number(m[5]), tz: 'ET' };
  }
  m = /^([\d]{4})-(\d\d)-(\d\d) (\d\d):(\d\d) UTC$/.exec(s.trim());
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return { day: m[2] + '-' + m[3], dow: DOW[d.getUTCDay()], hh: Number(m[4]), mm: Number(m[5]), tz: 'UTC' };
  }
  return null;
}

function readVerbose(raw, msgs, handles) {
  for (const block of raw.split(/\n---\n/)) {
    const h = VERBOSE.exec(block);
    if (!h) continue;
    const stamp = parseStamp(h[1]);
    if (!stamp) continue;
    const name = h[2];
    const handle = h[3];
    handles.set(name.trim(), handle);

    const reactions = {};
    const rx = /^⭐ \*\*Reactions:\*\* (.*)$/m.exec(block);
    if (rx) {
      for (const t of rx[1].matchAll(/(\S+)\s*×\s*(\d+)/g)) {
        const key = t[1].replace(/^:|:$/g, '');
        reactions[key] = (reactions[key] || 0) + Number(t[2]);
      }
    }
    const rp = /^↩ \*replying to (.+?): "([\s\S]*?)…?"\*$/m.exec(block);
    const images = [...block.matchAll(/`images\/([^`]+)`/g)].map((m) => m[1]);

    const text = block.split('\n').filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('###') && !t.startsWith('↩ ') && !t.startsWith('⭐ ')
        && !t.startsWith('🖼 ') && !t.startsWith('📎 ') && !t.startsWith('🔗 ');
    }).join(' ⏎ ').trim();

    msgs.push({
      day: stamp.day, dow: stamp.dow,
      time: pad(stamp.hh) + ':' + pad(stamp.mm),
      mins: stamp.hh * 60 + stamp.mm,
      name: name.trim(), handle,
      text, replyTo: rp ? rp[1].trim() : null, replyQuote: rp ? rp[2] : '',
      images, reactions,
      reacts: Object.values(reactions).reduce((a, b) => a + b, 0),
      edited: /✏️/.test(block), tz: stamp.tz, line: '',
    });
  }
}

function readLog(logDir) {
  if (!logDir) throw new Error('usage: readLog("<path to log folder>")');
  const wd = path.join(logDir, 'working');
  const files = fs.readdirSync(wd).filter((f) => /^\d\d-\d\d\.md$/.test(f)).sort();
  const handles = new Map();
  const msgs = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(wd, file), 'utf8');
    const day = file.slice(0, 5);
    let dow = '';

    if (VERBOSE.test(raw)) { readVerbose(raw, msgs, handles); continue; }

    const hl = /^Handles: (.*)$/m.exec(raw);
    if (hl) {
      for (const pair of hl[1].split(/,\s*/)) {
        const m = /^(.+?)=(@\S+)$/.exec(pair.trim());
        if (m) handles.set(m[1].trim(), m[2]);
      }
    }

    for (const rawLine of raw.split('\n')) {
      const dh = DAYHEAD.exec(rawLine);
      if (dh) { dow = dh[2]; continue; }
      const m = LINE.exec(rawLine);
      if (!m) continue;

      let text = m[4];

      // Strip the trailing furniture in the order split.js emits it.
      let edited = false;
      text = text.replace(/\s*✎\s*$/, () => { edited = true; return ''; });

      const reactions = {};
      text = text.replace(/\s*\{([^{}]*×\d+[^{}]*)\}\s*$/, (_, body) => {
        for (const tok of body.trim().split(/\s+/)) {
          const r = /^(.+)×(\d+)$/.exec(tok);
          if (r) reactions[r[1]] = (reactions[r[1]] || 0) + Number(r[2]);
        }
        return '';
      });

      const images = [];
      text = text.replace(/\s*\[img: ([^\]]+?)(?: \([A-Z]+\))?\]/g, (_, f) => {
        images.push(f);
        return '';
      });

      let replyTo = null;
      let replyQuote = '';
      text = text.replace(/\s*↩\(([^:()]{1,40}): "([\s\S]*?)"\)/, (_, who, q) => {
        replyTo = who.trim();
        replyQuote = q;
        return '';
      });
      if (replyTo === null) text = text.replace(/\s*↩\([^)]*\)\s*/, ' ');

      msgs.push({
        day, dow,
        time: m[1] + ':' + m[2],
        mins: Number(m[1]) * 60 + Number(m[2]),
        name: m[3].trim(),
        handle: '',
        text: text.trim(),
        replyTo, replyQuote,
        images, reactions,
        reacts: Object.values(reactions).reduce((a, b) => a + b, 0),
        edited, tz: 'ET',
        line: rawLine,
      });
    }
  }

  for (const x of msgs) x.handle = handles.get(x.name) || '';
  return { msgs, handles, days: files.map((f) => f.slice(0, 5)) };
}

/* Rough reply graph. Discord quotes ~78 characters of the parent, so a message
 * is keyed by author + the head of its text and matched against that quote. */
function replyGraph(msgs) {
  const KEY = (name, text) => name + '|' + flat(text).slice(0, 40).toLowerCase();
  const repliers = new Map();
  for (const x of msgs) {
    if (!x.replyTo) continue;
    const k = KEY(x.replyTo, x.replyQuote);
    if (!repliers.has(k)) repliers.set(k, new Set());
    repliers.get(k).add(x.name);
  }
  for (const x of msgs) {
    const s = repliers.get(KEY(x.name, x.text));
    x.replies = s ? s.size - (s.has(x.name) ? 1 : 0) : 0;
  }
  return msgs;
}

const counts = (msgs) => {
  const c = new Map();
  for (const x of msgs) c.set(x.name, (c.get(x.name) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};

module.exports = { readLog, replyGraph, counts, flat };
