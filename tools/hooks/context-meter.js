// context-meter.js — PostToolUse hook (.claude/settings.json). Reads how much context the session is
// carrying from the tail of its transcript and, past the ceiling, tells it to hand off (THE PIPELINE
// in Style.txt). Silent unless an edition in this folder has a HANDOFF.md at STATUS: RUNNING.
// Ceiling: PCT_CONTEXT_CEILING (tokens), default 400000; it says so again every further 100k.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ownHandoff } = require('./own-handoff');

const CEILING = Number(process.env.PCT_CONTEXT_CEILING) || 400000;
const STEP = 100000;

// The latest context size: the last assistant message's usage. Lines carrying page renders run to a
// megabyte, so read the tail in growing steps until one turns up.
function contextSize(transcript) {
  const size = fs.statSync(transcript).size;
  const fd = fs.openSync(transcript, 'r');
  try {
    for (const want of [512e3, 4e6, 16e6]) {
      const len = Math.min(size, want);
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, size - len);
      const lines = b.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
        if (!lines[i].includes('"usage"')) continue;
        let o; try { o = JSON.parse(lines[i]); } catch (_) { continue; }
        const u = o.type === 'assistant' && o.message && o.message.usage;
        if (u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
      if (len === size) break;
    }
  } finally { fs.closeSync(fd); }
  return 0;
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  try {
    const h = JSON.parse(input);
    const root = process.env.CLAUDE_PROJECT_DIR || h.cwd;
    const handoff = ownHandoff(h, root, /^STATUS:\s*RUNNING/mi);
    if (!handoff || !h.transcript_path || !fs.existsSync(h.transcript_path)) return;
    // Proof of the effort each session ran at (the editor wants xhigh; the init event does not say).
    if (h.effort && h.effort.level) {
      const log = path.join(path.dirname(handoff), 'pipeline', 'effort.log');
      const seen = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      if (!seen.includes(h.session_id)) {
        fs.mkdirSync(path.dirname(log), { recursive: true });
        fs.appendFileSync(log, `${new Date().toISOString()} ${h.session_id} effort=${h.effort.level}\n`);
      }
    }
    const ctx = contextSize(h.transcript_path);
    if (ctx < CEILING) return;
    const level = CEILING + Math.floor((ctx - CEILING) / STEP) * STEP;
    const state = path.join(os.tmpdir(), `pct-context-meter-${h.session_id}.json`);
    let told = 0;
    try { told = JSON.parse(fs.readFileSync(state, 'utf8')).level; } catch (_) {}
    if (level <= told) return;
    fs.writeFileSync(state, JSON.stringify({ level }));
    const k = (n) => Math.round(n / 1000) + 'k';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `CONTEXT METER: this session is carrying about ${k(ctx)} tokens of context; the pipeline hands off at ${k(CEILING)}. ` +
          `Wrap up now. Finish the item in hand, save everything to disk, and bring ${handoff} up to date: what is done, ` +
          `exactly where you stopped, and what the next session must read. Leave NEXT on this phase if it is unfinished, ` +
          `then end the session. The next one starts with a clean context and your notes.`,
      },
    }));
  } catch (_) { /* a meter that breaks must never break the session */ }
});
