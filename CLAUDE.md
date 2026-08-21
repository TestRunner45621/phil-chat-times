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
- `editions/<slug>/` — `edition.pdf`, `edition.md`, `edition.html`, `cover.jpg`,
  `thumb.jpg`. `edition.html` is the HTML the PDF was printed from; Vol I No 1-3
  predate it and have none
- `editions.json` — the manifest the site reads; written by `npm run build`
- `HEADLINES.md` — every headline in the archive; written by `npm run headlines`
- `scripts/` — the build, the extractor, the headline index, the preview server
- `tools/` — the programs that turn a week of Discord into an issue
- `vendor/pdfjs/` — a pinned copy of pdf.js, so the site has no CDN dependency

## Clones and staying in sync

One folder per repository, each named for the repository it holds:

- `C:\Users\John\phil-chat-times` — this repository, the public archive
- `C:\Users\John\phil-chat-times-newsroom` — the private newsroom, where the
  logs, the research and the drafts live

Keep it that way. A second clone of one repository drifts quietly: the work does
look committed, because it is — in the other folder — so the next session starts
from a stale tree and rebuilds something that already exists. A clone that has
not fetched cannot warn you, because `status` on its own will call it clean.

Fetch before you start, push when you stop.

```sh
git -C "<folder>" fetch origin
git -C "<folder>" status -sb    # "behind N" — pull before touching anything
```

Each folder holds a `.url` shortcut to its repository on GitHub, so the folder
says which repository it is without `git remote -v` being run. Trust those over
any folder found elsewhere on the machine — the Desktop still carries older
copies of the paper that are not clones of anything.

## Things that will bite

`edition.md` is generated from the finished PDF. Never edit one by hand; fix the
extractor and re-run it. The output is deterministic, so an unchanged PDF
produces no diff.

`editions.json` is generated too. Edit the source folders, then `npm run build`.

The repository *is* the site — GitHub Pages serves it as-is, and `.nojekyll` is
committed so the folders survive. There is no build step on the server, so
anything committed is live.

Every edition from Vol I No 4 on ships `edition.html` beside the PDF, and new
ones must keep doing so. The PDF is the artefact, but the HTML is the source it
was printed from, and an archive that holds only the output cannot reset an
issue — it can only reprint one.

Copy that file out of the newsroom, from `Past Editions/<issue>/`, after running
the newsroom’s `tools/inline.js` over it there. It has to be the inlined copy:
the working file points at the week’s pictures under `Chat Logs/`, a folder that
does not exist in this repository and is gitignored in the newsroom, so an
uninlined copy publishes nothing but broken images. Where an issue was printed
more than once, take the HTML whose PDF matches the published `edition.pdf` —
Vol I No 4 has two, and only the v2 file matches.

Keep `vendor/pdfjs/` pinned. The reader is built against that copy, and the
point of vendoring it is that the archive keeps working when a CDN does not.
