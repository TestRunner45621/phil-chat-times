// review-snapshot-hook.js — SessionStart (startup) and SessionEnd hook (.claude/settings.json). Takes the before-REVIEW
// snapshot when a session starts on REVIEW, and the after snapshot when a session ends with the edition READY TO
// PUBLISH (tools/review-snapshot.js). pipeline.js does the same between sessions; this covers REVIEW run by hand and
// drivers started before the snapshots existed. Silent unless it saved something; never breaks a session.
'use strict';
const fs = require('fs');
const path = require('path');
const { ownHandoff } = require('./own-handoff');
const { snapshot } = require('../review-snapshot');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  try {
    const h = JSON.parse(input || '{}');
    const root = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
    const f = ownHandoff(h, root, /^STATUS:/m);
    if (!f) return;
    const t = fs.readFileSync(f, 'utf8');
    const status = ((t.match(/^STATUS:[ \t]*(.*)$/mi) || [])[1] || '').trim().toUpperCase();
    const next = ((t.match(/^NEXT:[ \t]*(.*)$/mi) || [])[1] || '').trim();
    let said = null;
    if (h.hook_event_name === 'SessionStart' && status === 'RUNNING' && /^REVIEW/i.test(next)) said = snapshot(path.dirname(f), 'before');
    if (h.hook_event_name === 'SessionEnd' && status === 'READY TO PUBLISH') said = snapshot(path.dirname(f), 'after');
    try { // proof the hook ran, and when; SessionEnd in headless runs is otherwise invisible
      fs.appendFileSync(path.join(path.dirname(f), 'pipeline', 'hooks.log'),
        `${new Date().toISOString()} ${h.hook_event_name} ${h.session_id || ''} STATUS=${status} NEXT=${next}${said ? ' | ' + said : ''}\n`);
    } catch (_) {}
    if (said && h.hook_event_name === 'SessionStart') process.stdout.write(said + ' The editor wants it kept; do not edit or delete it.\n');
  } catch (_) { /* a snapshot that fails must never break the session */ }
});
