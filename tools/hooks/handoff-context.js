// handoff-context.js — SessionStart hook for "clear" and "compact" (.claude/settings.json). When an
// edition in this folder is mid-pipeline, puts its HANDOFF.md in front of the session, so /clear plus
// "do the next phase" is a whole handoff, and a session that has just been compacted re-reads the
// state it was working from. Prints nothing when no edition is running.
'use strict';
const fs = require('fs');
const { ownHandoff } = require('./own-handoff');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  try {
    const h = JSON.parse(input || '{}');
    const root = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
    const f = ownHandoff(h, root, /^STATUS:\s*(RUNNING|BLOCKED)/mi);
    if (!f) return;
    const best = { f, t: fs.readFileSync(f, 'utf8') };
    const why = h.source === 'compact'
      ? 'This session was just compacted. Re-read the state below before carrying on;'
      : 'A Phil Chat Times edition is in production in this folder.';
    process.stdout.write(`${why} Its handoff file is ${best.f}. To continue, do the phase it names as NEXT, ` +
      `following THE PIPELINE in Instructions/Style.txt, and update the file before you stop.\n\n${best.t}`);
  } catch (_) { /* never break a session start */ }
});
