const p = require('puppeteer-core');
const path = require('path');
(async () => {
  const b = await p.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const pg = await b.newPage();
  await pg.emulateMediaType('print');
  await pg.goto('file:///' + path.resolve(process.argv[2]).replace(/\\/g, '/'), {
    waitUntil: 'networkidle0',
  });
  console.log(
    JSON.stringify(
      await pg.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const body = q('.body'),
          story = q('.story'),
          rail = q('.rail'),
          page = q('.page');
        return {
          pageH: +page.getBoundingClientRect().height.toFixed(1),
          bodyClientH: body.clientHeight,
          bodyScrollH: body.scrollHeight,
          storyH: +story.getBoundingClientRect().height.toFixed(1),
          storyScrollW: story.scrollWidth,
          storyClientW: story.clientWidth,
          railH: +rail.getBoundingClientRect().height.toFixed(1),
          railScrollH: rail.scrollHeight,
          kids: [...page.children].map((n) => ({
            c: String(n.className || n.tagName).split(' ')[0],
            h: +n.getBoundingClientRect().height.toFixed(1),
          })),
        };
      }),
      null,
      1
    )
  );
  await b.close();
})();
