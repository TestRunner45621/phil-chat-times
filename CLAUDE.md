# The Phil Chat Times — archive repository

This repository is the published archive and the reader for it. The paper itself
is written elsewhere: the chat logs, the research notes, the drafts and the
issue HTML are in the private newsroom repository, not here.

## Where the rules are

`Style.txt` is the style guide and the production checklist — register, layout,
the masthead standard, print-CSS rules, dead space, the names legend, continuity
between issues. Read it before writing or laying out an issue. It is the single
source; do not restate its rules in other files, because two copies drift.

`docs/memory/` is what the newsroom remembers between issues: character
profiles, running stories, factoids checked against the logs, style lessons from
the readership. Read it before writing, write back to it after. It is a guide —
the logs are the source of truth.

## Commands

```sh
npm install            # first time only
npm run build          # ingest edition folders, render covers, rewrite editions.json
npm run extract        # write edition.md for any edition without one
npm run extract:force  # ...and overwrite the ones that have it
npm run headlines      # rebuild HEADLINES.md
npm run serve          # preview at http://localhost:8080
```

`npm run serve` is required for previewing — opening `index.html` off the disk
fails, because the page fetches `editions.json` and streams PDFs, which browsers
block on `file://`.

## Layout

- `index.html`, `read.html`, `assets/` — the site and the in-browser reader
- `editions/<slug>/` — `edition.pdf`, `edition.md`, `cover.jpg`, `thumb.jpg`
- `editions.json` — the manifest the site reads; written by `npm run build`
- `HEADLINES.md` — every headline in the archive; written by `npm run headlines`
- `scripts/` — the build, the extractor, the headline index, the preview server
- `tools/` — the programs that turn a week of Discord into an issue
- `vendor/pdfjs/` — a pinned copy of pdf.js, so the site has no CDN dependency

## Things that will bite

`edition.md` is generated from the finished PDF. Never edit one by hand; fix the
extractor and re-run it. The output is deterministic, so an unchanged PDF
produces no diff.

`editions.json` is generated too. Edit the source folders, then `npm run build`.

The repository *is* the site — GitHub Pages serves it as-is, and `.nojekyll` is
committed so the folders survive. There is no build step on the server, so
anything committed is live.

Keep `vendor/pdfjs/` pinned. The reader is built against that copy, and the
point of vendoring it is that the archive keeps working when a CDN does not.
