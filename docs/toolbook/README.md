# The toolbook

A catalogue of the visual devices this paper has actually used, what each one is
for, and where it ran. It exists so that variation costs less than repetition.

The failure it addresses is on the record. Vol I No 4 and Vol I No 5 have the
same front page: same accent rail, same stacked nameplate at the same size, same
contents strip, same reversed stat panel, same two tinted rail boxes, same
footer. Only the words changed. That is not a house style, it is a template
nobody had the time to argue with at one in the morning — and the reason it
happened is that redesigning is expensive and copying last week is free.

A toolbook makes the third option cheap: reach for a device the paper has
already proven, in a combination it has not used yet.

## How to use it

Before laying out an issue, read `architectures.md` for the shape of the page and
`elements.md` for the parts. Pick a front-page architecture the last two issues
did not use. Pick box and panel treatments the last issue did not use. Then build
the issue.

`Style.txt` is the authority on when to vary and what must stay fixed — see its
VARIATION and MASTHEAD sections. This folder is the parts bin, not the rules.

## How to add to it

An entry earns its place by shipping. Build the thing, run the issue, look at the
printed page, and if it worked write it up here. If it did not work, write that
up too — a device that failed and why is worth as much as one that landed, and
saves the next editor from rediscovering it.

An entry says:

- **What it is** and what job it does on the page.
- **Where it ran** — issue and page, so it can be looked at rather than imagined.
- **How to build it** — the markup and CSS that matter, and the print gotchas.
  `break-inside: avoid` on anything boxed, always.
- **How it went** — did it land, did it eat too much space, did it survive the
  page break.

Keep entries short. This is a reference to be scanned at speed under deadline,
not an essay.

## The print test

The devices are worth seeing together. Build `print-test.html` in the newsroom
repository — every box, rule, panel, chart and heading treatment in the toolbook,
set on one or two pages with nothing else on them — and render it with the same
headless Chrome command that renders an issue. It answers two questions the
individual entries cannot: whether the set still looks like one paper, and
whether any two devices are so similar that one of them should be retired.

Re-render it whenever an entry is added.

## Index

- `architectures.md` — front-page and feature-page shapes
- `elements.md` — nameplates, rails, boxes, panels, and the type devices
