# 𝔗𝔥𝔢 𝔓𝔥𝔦𝔩 ℭ𝔥𝔞𝔱 𝔗𝔦𝔪𝔢𝔰 — online archive

A static site that hosts every edition of the paper and reads them in the
browser: zoom, pan, jump between pages, select text. No server, no build step at
page-load time, nothing uploaded — GitHub Pages serves plain files and the
rendering happens on the reader's machine.

Every edition also exists as a readable markdown file (`edition.md`) committed
alongside the PDF — searchable, diffable, and readable without a viewer.

- `index.html` — the archive: a cover grid of every edition
- `read.html` — the viewer
- `editions/<slug>/` — one folder per edition: `edition.pdf`, `edition.md`, `cover.jpg`, `thumb.jpg`
- `editions.json` — the manifest the site reads (page counts, dates, headlines)
- `vendor/pdfjs/` — a pinned copy of Mozilla's pdf.js, so the site has no CDN dependency

## Reading

The viewer renders straight from each edition's PDF, so type stays sharp at any
zoom rather than turning into a blurry image.

| | |
|---|---|
| `←` `→` | previous / next page |
| `↑` `↓` | scroll |
| `Home` / `End` | first / last page |
| `+` `−` | zoom |
| `F` | cycle fit width → fit page → 100% |
| `T` | thumbnails |
| `S` | drag tool ↔ text-select tool |
| `Ctrl`/`⌘` + scroll | zoom at the pointer |
| drag | pan (pinch to zoom on touch) |
| double-click | zoom to that spot |

Links are deep: `read.html#/vol-1-no-3/12` opens Vol I No 3 at page 12, and the
address bar tracks the page as you read.

## Adding a new edition

Drop the finished PDF into its `Vol <roman> No <n> - <yyyy-mm-dd>` folder under
`Past Editions`, then:

```sh
npm install          # first time only
npm run build        # ingests every edition folder that has a PDF
npm run extract      # generates edition.md for all editions
git add -A && git commit -m "Add Vol I No 5" && git push
```

`npm run build` copies the PDF in, renders the cover and thumbnail, reads the
page count and pulls the front-page headline, then rewrites `editions.json`.
Editions with no PDF yet are listed as `upcoming` and appear on the archive page
as an "In production" placeholder.

`npm run extract` generates a structured markdown mirror (`edition.md`) for each
edition from its PDF — YAML frontmatter, the blackletter masthead, and the full
text content page by page. Use `npm run extract:force` to overwrite existing
markdown files.

Point the build at a different source folder with
`node scripts/build-editions.mjs --source "D:\some\other\path"`, and force a
re-render of covers that already exist with `--force`. It renders through
headless Chrome; if Chrome is somewhere unusual, pass `--chrome "<path>"`.

## Previewing locally

```sh
npm run serve        # http://localhost:8080
```

Opening `index.html` straight off the disk will not work — the page fetches
`editions.json` and streams the PDFs, which browsers block on `file://`. The
preview server also answers range requests, so it behaves like GitHub Pages does
on the larger issues.

## Publishing

The repository *is* the site — there is no build to run on the server.

1. Push to GitHub.
2. **Settings → Pages → Build and deployment**: source *Deploy from a branch*,
   branch `main`, folder `/ (root)`.
3. It goes live at `https://<user>.github.io/<repo>/` a minute or so later.

`.nojekyll` is committed so Pages serves the folders as-is.

Note that the PDFs live in git, about 23 MB across the five editions so far.
That is well within GitHub's limits, but if the archive grows to hundreds of
issues it would be worth moving them to a release asset or Git LFS.

## How the paper is made

`tools/` holds the programs that turn a week of Discord into an issue, and
`Style.md` is the style guide they serve — register, layout rules, the names
legend, the production checklist. `CLAUDE.md` is the comprehensive technical
reference for LLM-assisted production.

An issue starts as a single flat export, twenty-odd thousand messages with no
structure beyond timestamps. The problem is never finding *something* to print. It
is working out which of twenty thousand things were worth reading, and the tools
exist because each answer to that turned out to be wrong in an interesting way.

Run them with Node from `tools/`; `npm install` first for `sharp`, `pngjs` and
`puppeteer-core`. Several of the layout tools hardcode
`C:\Program Files\Google\Chrome\Application\chrome.exe`.

### Reading

| | |
|---|---|
| `split.js` | the export → one file per Eastern day. Converts UTC−4 and works out the day of the week *after* converting, which is the step that is easy to get backwards and which puts a Monday argument on a Sunday page |
| `reacted.js` | everything at or above a given reaction count |
| `unreacted.js` | rebuilds the reply graph from the ~78 characters of parent message that Discord embeds in every reply, then surfaces `engaged` — three or more distinct people replying, zero reactions — plus `long`, `caps` and `questions` |
| `person.js` | one account's quotable messages with reactions and reply context; `TAIL` sweeps every account under 60 messages |
| `day.js` | one person, one day, in sequence |

Reaction count is the obvious ranking and the worst one. It measures what a room
was willing to endorse in public, which is not the same as what it argued about,
and once a paper prints the figure the room starts farming it. The reply graph
finds the arguments. Reading one person end to end finds the rest.

### Measuring

`stats.js` — volume, hit rates, distribution by hour and day, the long tail.
`effort.js` — average message length, replies received per hundred sent, and a
composite percentile. `vocab.js` — mention counts over message *bodies* only,
excluding headings and reply quotes, which is the whole difference between a right
number and a number that is 40% too high. `thresh.js` compares candidate cutoffs
before you commit to one.

### Laying out

The paper is printed HTML, so copyfitting is measurement rather than opinion.
Previously, we used a suite of tools (`fill.js`, `slack.js`, `fit-check.js`) that required rasterizing PDFs or measuring the live Chrome DOM. Now, we use `@chenglou/pretext` for layout measurement. 

`preflight.js` accurately models text heights, line-breaks, and orphans/widows via pure arithmetic, providing instantaneous terminal feedback on dead space and clipped content without firing up a browser. `shots.js` is still used to render each page to a PNG at 2× for visual review. `webp2png.js` exists because roughly a third of Discord's image exports are WebP.

The research notes, the raw logs and the drafts are not in this repository.

## Edition file structure

Each edition folder under `editions/` contains:

```
editions/vol-1-no-5/
  edition.pdf          # the final PDF
  edition.md           # structured markdown with YAML frontmatter
  cover.jpg            # page 1 at 1000px wide
  thumb.jpg            # page 1 at 320px wide
```

The markdown file begins with YAML frontmatter (volume, number, date, headline,
page count) and the blackletter masthead `𝔗𝔥𝔢 𝔓𝔥𝔦𝔩 ℭ𝔥𝔞𝔱 𝔗𝔦𝔪𝔢𝔰`, followed by
the full text of the edition organised by page. See `templates/edition-template.md`
for the format.

## Editorial Memory (`docs/memory/`)

The `docs/memory/` directory is the running compendium of collected knowledge about Phil Chat. It is used by the AI editorial team to maintain a consistent writing style and an evolving arc across issues. It contains character profiles, running story arcs, and style notes. It acts as a knowledgebase, but it is not the ultimate source of truth — the raw logs are. Editors read this folder before writing a new edition and update it when they finish.
