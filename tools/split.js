/* Split an Oracle Bot debate-log.md into per-day working files.
 * Converts UTC message headings to US Eastern (UTC-4 for the summer months
 * these logs cover) and files each message under its EASTERN calendar day,
 * so late-UTC messages land on the previous day where they belong.
 *
 *   node split.js "<path to log folder>"
 *
 * Writes <log folder>/working/00-front-matter.md and MM-DD.md per day. */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) throw new Error('usage: node split.js "<path to log folder>"');

const src = fs.readFileSync(path.join(dir, 'debate-log.md'), 'utf8');
const out = path.join(dir, 'working');
fs.mkdirSync(out, { recursive: true });

const HEAD = /^### \[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC\] (.*)$/;
const OFFSET = -4 * 60; // Eastern Daylight Time
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULLDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULLMONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const lines = src.split(/\r?\n/);
const first = lines.findIndex((l) => HEAD.test(l));

fs.writeFileSync(path.join(out, '00-front-matter.md'), lines.slice(0, first).join('\n'), 'utf8');

// Bucket lines into messages, each tagged with its Eastern day.
const days = new Map(); // 'MM-DD' -> {date, chunks: []}
let cur = null;
let buf = [];

const flush = () => {
  if (!cur) return;
  if (!days.has(cur.key)) days.set(cur.key, { date: cur.date, chunks: [] });
  days.get(cur.key).chunks.push(buf.join('\n').replace(/\s+$/, ''));
  buf = [];
};

for (let i = first; i < lines.length; i++) {
  const m = HEAD.exec(lines[i]);
  if (m) {
    flush();
    const [, Y, Mo, D, H, Mi, rest] = m;
    const t = new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi) + OFFSET * 60000);
    const h24 = t.getUTCHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const stamp = `${DAYS[t.getUTCDay()]} ${MONS[t.getUTCMonth()]} ${t.getUTCDate()}, ` +
      `${h12}:${String(t.getUTCMinutes()).padStart(2, '0')} ` +
      `${h24 < 12 ? 'AM' : 'PM'} ET`;
    cur = {
      key: `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`,
      date: t,
    };
    buf.push(`### [${stamp}] ${rest}`);
  } else if (cur) {
    buf.push(lines[i]);
  }
}
flush();

for (const [key, { date, chunks }] of [...days].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const header = `# ${FULLDAYS[date.getUTCDay()]}, ${FULLMONS[date.getUTCMonth()]} ` +
    `${date.getUTCDate()}, ${date.getUTCFullYear()} — Phil Chat\n\n` +
    `*Times are US Eastern. Source: debate-log.md*\n\n---\n\n`;
  fs.writeFileSync(path.join(out, `${key}.md`), header + chunks.join('\n\n---\n\n') + '\n', 'utf8');
  const msgs = chunks.length;
  console.log(`${key}.md  ${msgs} messages`);
}
