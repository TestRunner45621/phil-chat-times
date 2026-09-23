// own-handoff.js — which HANDOFF.md a hook's session belongs to. Shared by context-meter.js and
// handoff-context.js. Two editions can be in production in this folder at once (a test beside a real
// issue), and "the newest HANDOFF.md" then names the other one's file half the time. In order:
//   1. PCT_HANDOFF, which pipeline.js sets on every session it starts;
//   2. the "Handoff file:" line of pipeline.js's prompt, read from the head of the session's transcript
//      (covers sessions started by an older pipeline.js that did not set the variable);
//   3. the newest HANDOFF.md whose STATUS matches, for sessions opened by hand ("do the next phase").
'use strict';
const fs = require('fs');
const path = require('path');

function fromTranscript(transcript) {
  if (!transcript || !fs.existsSync(transcript)) return null;
  const fd = fs.openSync(transcript, 'r');
  try {
    const len = Math.min(fs.statSync(transcript).size, 256e3);
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, 0);
    const m = b.toString('utf8').match(/Handoff file: ((?:[^"\\]|\\\\)+?HANDOFF\.md)/);
    if (!m) return null;
    const f = JSON.parse(`"${m[1]}"`); // the transcript is JSON, so the path's backslashes are doubled
    return fs.existsSync(f) ? f : null;
  } catch (_) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function newest(root, statusRe) {
  let best = null;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(root, d.name, 'HANDOFF.md');
    if (!fs.existsSync(f)) continue;
    if (!statusRe.test(fs.readFileSync(f, 'utf8'))) continue;
    const m = fs.statSync(f).mtimeMs;
    if (!best || m > best.m) best = { f, m };
  }
  return best && best.f;
}

// The session's own handoff file if its STATUS matches statusRe, else null. A session that belongs to
// an edition is never pointed at a different one, even when its own has stopped matching.
function ownHandoff(hookInput, root, statusRe) {
  const own = (process.env.PCT_HANDOFF && fs.existsSync(process.env.PCT_HANDOFF) && process.env.PCT_HANDOFF)
    || fromTranscript(hookInput.transcript_path);
  if (own) return statusRe.test(fs.readFileSync(own, 'utf8')) ? own : null;
  return newest(root, statusRe);
}

module.exports = { ownHandoff };
