// pipeline.js — makes an edition as a chain of fresh sessions, one phase each (THE PIPELINE in
// Style.txt). Every phase is its own `claude -p` run, so no session carries the one before it:
// HANDOFF.md in the edition folder is the only thing that passes between them.
//
//   node tools/pipeline.js "<edition folder>" --log "<log folder>" [--days 09-15,09-16] [--note "…"]
//        first run: writes the edition's HANDOFF.md with the read batches, then runs
//   node tools/pipeline.js "<edition folder>"            resume from HANDOFF.md
//   node tools/pipeline.js "<edition folder>" --status   where it stands, and the run log
//   --model <m> --effort <e>   default: Opus 5.5 (1M) at xhigh, pinned; override only for testing
//   --once                     run one session and stop
//
// It stops at READY TO PUBLISH or BLOCKED and never publishes: committing and pushing wait for the
// editor. A run that fails (a usage limit, a crash) is retried every 20 minutes, or at the reset time
// when the error gives one, for up to 48 hours. Two runs in a row that end without touching
// HANDOFF.md, or six sessions on one phase, stop it as BLOCKED rather than spend usage going round.
// Sessions start in the PCT WORKING FOLDER so its .claude/settings.json hooks load: the context
// meter (hand off at ~400k) and the handoff loader (after /clear or a compaction).
'use strict';
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RETRY_MIN = 20;
const HANG_MIN = 20; // no output from a session for this long and it is stopped and replaced
const GIVE_UP_HOURS = 48;
const MAX_STALLS = 2;
const MAX_SAME_PHASE = 6;
const READ_BUDGET = 320000; // estimated cost per read session (see cost() below); plus ~40k fixed, under the 400k meter

// ---------------------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const value = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const statusOnly = flag('--status');
const once = flag('--once');
const logArg = value('--log');
const daysArg = value('--days');
const note = value('--note');
// Every session is Opus 5.5 at extra-high effort, whatever settings.json says: the editor's order,
// because the visuals came out poorly even at high. The 1M window lets a session run to the meter.
const MODEL = 'claude-opus-5-5[1m]';
const EFFORT = 'xhigh';
const model = value('--model') || MODEL;
const effort = value('--effort') || EFFORT;
const editionArg = argv[0];
if (!editionArg) {
  console.error('usage: node tools/pipeline.js "<edition folder>" [--log "<log folder>"] [--days MM-DD,...] [--note "..."] [--status] [--once]');
  process.exit(1);
}
const inRoot = (p) => (path.isAbsolute(p) || fs.existsSync(p) ? path.resolve(p) : path.join(ROOT, p));
const EDITION = inRoot(editionArg);
const HANDOFF = path.join(EDITION, 'HANDOFF.md');
const RUNS = path.join(EDITION, 'pipeline');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// ---------------------------------------------------------------------------- HANDOFF.md
const readHandoff = () => {
  const text = fs.readFileSync(HANDOFF, 'utf8');
  const field = (k) => ((text.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'mi')) || [])[1] || '').trim();
  return { text, status: field('STATUS').toUpperCase(), next: field('NEXT'), hash: crypto.createHash('sha1').update(text).digest('hex') };
};
const setField = (k, v) => {
  const t = fs.readFileSync(HANDOFF, 'utf8');
  fs.writeFileSync(HANDOFF, t.replace(new RegExp(`^${k}:.*$`, 'mi'), `${k}: ${v}`));
};
const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }).replace(',', '') + ' ET';
const say = (s) => {
  const line = `[${stamp()}] ${s}`;
  console.log(line);
  fs.mkdirSync(RUNS, { recursive: true });
  fs.appendFileSync(path.join(RUNS, 'pipeline.log'), line + '\n');
};
const block = (why) => {
  setField('STATUS', 'BLOCKED');
  fs.appendFileSync(HANDOFF, `\n- ${stamp()} pipeline.js stopped: ${why}\n`);
  say(`BLOCKED — ${why}`);
  process.exit(3);
};

// First run: split the log if nobody has, batch the days by size, write HANDOFF.md.
function initialise() {
  if (!logArg) { console.error(`${rel(HANDOFF)} does not exist yet. Start with --log "<log folder>".`); process.exit(1); }
  const LOG = inRoot(logArg);
  if (!fs.existsSync(path.join(LOG, 'debate-log.md'))) { console.error(`no debate-log.md in ${LOG}`); process.exit(1); }
  const working = path.join(LOG, 'working');
  if (!fs.existsSync(working) || !fs.readdirSync(working).some((f) => /^\d\d-\d\d\.md$/.test(f))) {
    console.log('splitting the log into day files…');
    execFileSync(process.execPath, [path.join(__dirname, 'split.js'), LOG], { stdio: 'inherit' });
  }
  const { readLog } = require('./log');
  const pictures = {};
  for (const m of readLog(LOG).msgs) pictures[m.day] = (pictures[m.day] || 0) + (m.images || []).length;
  let days = fs.readdirSync(working).filter((f) => /^\d\d-\d\d\.md$/.test(f)).map((f) => f.slice(0, 5)).sort();
  if (daysArg) {
    const want = daysArg.split(',').map((d) => d.trim());
    days = days.filter((d) => want.includes(d));
    if (!days.length) { console.error(`none of ${daysArg} is a day file in ${rel(working)}`); process.exit(1); }
  }
  // What a day costs a read session, measured on the 22 Sep test (163 KB, 58 pictures -> 263k peak):
  // the text runs ~2 bytes a token and the tool output and notes about match it again, so ~1.05 tokens
  // a byte; pictures ~1,000 each between the sheets and the ones opened full size.
  const cost = (d) => Math.round(fs.statSync(path.join(working, d + '.md')).size * 1.05 + (pictures[d] || 0) * 1000);
  const batches = [];
  for (const d of days) {
    const last = batches[batches.length - 1];
    if (last && last.tokens + cost(d) <= READ_BUDGET) { last.days.push(d); last.tokens += cost(d); }
    else batches.push({ days: [d], tokens: cost(d) });
  }
  const n = batches.length;
  const reads = batches.map((b, i) =>
    `- [ ] READ ${i + 1}/${n} — ${b.days.join(', ')} (about ${Math.round(b.tokens / 1000)}k tokens of log and pictures)`);
  fs.mkdirSync(path.join(EDITION, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(EDITION, 'parts'), { recursive: true });
  fs.writeFileSync(HANDOFF, `# HANDOFF — ${path.basename(EDITION)}

STATUS: RUNNING
NEXT: READ 1/${n}
EDITION: ${rel(EDITION)}
LOG: ${rel(LOG)}
DAYS: ${days.join(', ')}
STARTED: ${stamp()}

The pipeline's memory. Every session reads this first and updates it last (THE PIPELINE in
Instructions/Style.txt). STATUS is RUNNING, BLOCKED (with the question below) or READY TO PUBLISH.
NEXT names exactly one phase. The notes carry the material; this file carries the state.

## Editor's notes

${note ? note : '(none)'}

## Phases

${reads.join('\n')}
- [ ] PLAN — stories, flatplan, the issue's design (parts/00-head.html), the BUILD batches
- [ ] BUILD — batches written in here by PLAN
- [ ] REVIEW — a fresh session that built nothing checks the whole issue and fixes it
- [ ] PUBLISH — the editor's call. No session commits, pushes or copies out of the folder unasked.

## For the next session

Nothing yet. READ 1/${n} starts from the day files in ${rel(working)}.

## Session log

- ${stamp()} pipeline.js wrote this file.
`);
  say(`initialised ${rel(HANDOFF)}: ${days.length} day(s) in ${n} read session(s)`);
}

// ---------------------------------------------------------------------------- one session
const PROMPT = () => `You are one session of the Phil Chat Times production pipeline, running unattended: nobody is at the keyboard and nobody can answer a question.

Working folder: ${ROOT}
Edition folder: ${EDITION}
Handoff file: ${HANDOFF}

1. Read Instructions/Style.txt in full, then Instructions/NAMES.txt, then the handoff file. THE PIPELINE in Style.txt says what each phase does and reads.
2. Do the phase the handoff file names as NEXT, and only that phase. Do not start the next one, even if there is room.
3. Save your work to disk as you go, so an interruption loses nothing.
4. Before you end, update the handoff file: tick the phase if it is finished, set NEXT, write what the next session needs under "For the next session" (where things are, what you decided and why, anything half done), and add one line to the Session log.
5. If the context meter tells you to wrap up, stop at a clean point, record exactly where you stopped, leave NEXT on the unfinished phase, and end.
6. Never commit, push, publish, or copy anything out of the working folder. If REVIEW finishes, set STATUS: READY TO PUBLISH and stop there.
7. If something only the editor can settle would be ruined by a wrong guess, set STATUS: BLOCKED, write the question under "For the next session", and end. Otherwise decide, write down the decision and the reason, and carry on.`;

function runSession(n, phase) {
  return new Promise((resolve) => {
    const slug = phase.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'phase';
    const file = path.join(RUNS, `${String(n).padStart(2, '0')}-${slug}.jsonl`);
    const args = ['-p', PROMPT(), '--permission-mode', 'auto', '--permission-prompts', 'none',
      '--output-format', 'stream-json', '--verbose',
      '--strict-mcp-config', // no connectors or MCP servers: the working folder is the whole world
      '--disallowedTools', 'Agent', 'Workflow', 'WebSearch', 'WebFetch',
      '--name', `PCT ${path.basename(EDITION)} · ${phase}`];
    args.push('--model', model, '--effort', effort);
    const env = { ...process.env };
    delete env.CLAUDECODE; // started from inside a Claude session is still a fresh session
    env.PCT_HANDOFF = HANDOFF; // the hooks' pointer to this edition when another is running beside it
    const child = spawn('claude', args, { cwd: ROOT, env, windowsHide: true });
    const out = fs.createWriteStream(file);
    let buf = '', peak = 0, turns = 0, result = null, errText = '', aborted = null, hung = false;
    // A session streams something every few seconds, even while it thinks. Silence this long means it is stuck (one hung
    // on a tool call for 25 minutes on 23 Sep, at 0% CPU), and nothing else would ever end it.
    let lastData = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > HANG_MIN * 60e3) { hung = true; clearInterval(watchdog); child.kill(); }
    }, 60e3);
    const short = (s, n = 70) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
    child.stdout.on('data', (d) => {
      lastData = Date.now();
      out.write(d);
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let o; try { o = JSON.parse(line); } catch (_) { continue; }
        // Without auto mode every write needs an approval nobody is there to give, and the session
        // spends its usage being refused. Some models fall back to default mode silently.
        if (o.type === 'system' && o.subtype === 'init' && o.permissionMode !== 'auto') {
          aborted = `the session started in "${o.permissionMode}" permission mode, not auto (model ${o.model}); ` +
            'every write would be refused. Use a model that supports auto mode.';
          child.kill();
          continue;
        }
        if (o.type === 'system' && o.subtype === 'init' && o.model !== model && model === MODEL) {
          aborted = `the session started on ${o.model}, not ${MODEL}. Every pipeline session is Opus 5.5.`;
          child.kill();
          continue;
        }
        if (o.type === 'assistant' && o.message) {
          const u = o.message.usage || {};
          const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          if (ctx) { turns++; peak = Math.max(peak, ctx); }
          for (const b of o.message.content || []) {
            if (b.type !== 'tool_use') continue;
            const inp = b.input || {};
            const what = inp.file_path ? rel(inp.file_path) : inp.command || inp.pattern || inp.description || '';
            console.log(`    ${phase} · ${b.name} ${short(what)}  (${Math.round(ctx / 1000)}k)`);
          }
        } else if (o.type === 'result') {
          result = o;
        }
      }
    });
    child.stderr.on('data', (d) => { errText += d.toString('utf8'); });
    child.on('error', (e) => { errText += e.message; });
    child.on('close', (code) => {
      clearInterval(watchdog);
      out.end();
      const text = result ? String(result.result || '') : '';
      const failed = code !== 0 || !result || result.is_error === true || /^error/.test(result.subtype || '');
      resolve({ code, failed, aborted, hung, text: text || errText, peak, turns, cost: result && result.total_cost_usd, file });
    });
  });
}

// When the error says when the limit lifts, wait for that; otherwise the fixed retry.
function waitFor(text) {
  const epoch = (String(text).match(/\b(1[7-9]\d{8})\b/) || [])[1];
  if (epoch) {
    const ms = Number(epoch) * 1000 - Date.now() + 120000;
    if (ms > 0 && ms < 24 * 3600e3) return ms;
  }
  return RETRY_MIN * 60e3;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The issue before REVIEW and after it, kept so the editor can have REVIEW's changes reverted (tools/review-snapshot.js).
const { snapshot } = require('./review-snapshot');
const snap = (which) => {
  try { const s = snapshot(EDITION, which); if (s) say(s); } catch (e) { say(`review snapshot (${which}) failed: ${e.message}`); }
};

// ---------------------------------------------------------------------------- main
(async () => {
  if (!fs.existsSync(HANDOFF)) {
    if (statusOnly) { console.log(`no ${rel(HANDOFF)} yet`); return; }
    initialise();
  }
  if (statusOnly) {
    const h = readHandoff();
    console.log(`STATUS: ${h.status}\nNEXT: ${h.next}\n`);
    const logFile = path.join(RUNS, 'pipeline.log');
    if (fs.existsSync(logFile)) console.log(fs.readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n'));
    return;
  }
  fs.mkdirSync(RUNS, { recursive: true });
  let n = fs.readdirSync(RUNS).filter((f) => /^\d+-.*\.jsonl$/.test(f)).length;
  let stalls = 0, samePhase = 0, lastPhase = null, failingSince = null, filtered = 0;

  for (;;) {
    const h = readHandoff();
    if (h.status === 'READY TO PUBLISH') { snap('after'); say('READY TO PUBLISH. Stopping before any commit; publishing is the editor\'s call.'); return; }
    if (h.status === 'BLOCKED') { say(`BLOCKED — see "For the next session" in ${rel(HANDOFF)}. Fix it, set STATUS: RUNNING, and run this again.`); process.exit(3); }
    if (h.status !== 'RUNNING') block(`unknown STATUS "${h.status}"`);
    if (!h.next) block('NEXT is empty');
    if (/^PUBLISH/i.test(h.next)) { setField('STATUS', 'READY TO PUBLISH'); continue; }

    samePhase = h.next === lastPhase ? samePhase + 1 : 1;
    lastPhase = h.next;
    if (samePhase > MAX_SAME_PHASE) block(`${MAX_SAME_PHASE} sessions in a row on ${h.next}`);

    if (/^REVIEW/i.test(h.next)) snap('before');
    n++;
    say(`▶ session ${n}: ${h.next} (fresh context)`);
    const r = await runSession(n, h.next);
    if (r.aborted) block(r.aborted);
    const after = readHandoff();
    say(`■ session ${n}: ${h.next} ${r.failed ? 'FAILED' : 'ended'} · ${r.turns} turns · peak context ${Math.round(r.peak / 1000)}k` +
      (r.cost ? ` · ~$${r.cost.toFixed(2)} at API prices` : '') + ` · NEXT now: ${after.next}` +
      (r.failed ? `\n    ${String(r.text).replace(/\s+/g, ' ').slice(0, 300)}` : ''));

    if (r.hung) {
      // Not a usage limit: start a fresh session at once. It still counts toward MAX_SAME_PHASE, so a phase that hangs
      // every time ends BLOCKED rather than looping.
      fs.appendFileSync(HANDOFF, `\n- ${stamp()} pipeline.js stopped session ${n} (${h.next}): no output for ${HANG_MIN} minutes, ` +
        'hung on a tool call. Its files are on disk, but this file may not have its notes: check the edition folder for work newer than the last entry here.\n');
      say(`session ${n} hung (no output for ${HANG_MIN} min); stopped it, starting a fresh one`);
      stalls = 0; failingSince = null;
      if (once) return;
      continue;
    }
    if (after.hash !== h.hash && !r.failed) { stalls = 0; failingSince = null; filtered = 0; if (once) return; continue; }
    if (after.hash !== h.hash) { stalls = 0; failingSince = null; }
    if (r.failed && /content filtering policy/i.test(r.text)) {
      // Not a usage limit: the same notes on the same days trip it again, so waiting fixes nothing and the
      // 48-hour retry would spend a session's usage every 20 minutes. Twice in a row on one phase is a question
      // for the editor.
      if (++filtered >= 2) block(`the API's content filter stopped ${h.next} ${filtered} times in a row ("${String(r.text).slice(0, 120)}")`);
      say('the API\'s content filter stopped the session; trying once more in 2 min');
      if (once) return;
      await sleep(120e3);
      continue;
    }
    if (r.failed) {
      failingSince = failingSince || Date.now();
      if (Date.now() - failingSince > GIVE_UP_HOURS * 3600e3) block(`sessions have failed for ${GIVE_UP_HOURS} hours: ${String(r.text).slice(0, 200)}`);
      samePhase--; // a failed start is not a session spent on the phase
      const ms = waitFor(r.text);
      say(`waiting ${Math.round(ms / 60000)} min before trying again (usage limit or error)`);
      if (once) return;
      await sleep(ms);
      continue;
    }
    if (++stalls >= MAX_STALLS) block(`${MAX_STALLS} sessions in a row ended without updating HANDOFF.md`);
    if (once) return;
  }
})();
