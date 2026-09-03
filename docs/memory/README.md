# docs/memory — The Newsroom's Collected Knowledge

This folder is the Phil Chat Times editorial memory. Agents writing the paper
read it before they start and write to it when they finish.

## `Style.txt` has the final say

Nothing in this folder overrules `Style.txt`. That file is the style guide and
the production checklist, and where the two disagree, `Style.txt` wins and this
folder is wrong — say so and fix the file here.

Everything in this folder is something to keep in mind, not a rule to follow. It
is what the newsroom happens to have noticed: a profile is a sketch of how
someone has behaved so far, a running story is a thread that was live last time
anyone looked, a style note is one lesson from one week. None of it is binding
on the issue you are writing. An editor who finds the room has moved on, or who
has a better idea, should go with the better idea — and then update the file, so
the next editor inherits the correction rather than the mistake.

The one thing here that is not a suggestion is the sourcing standard in the
rules below: if you write something down, say where it came from.

## Editorial memory only, never design

Nothing about how the paper looks belongs in this folder. No stylesheets, no
layout notes, no catalogue of boxes, rules, headline treatments or page
architectures, and no "what worked last time" parts bin. Every issue is designed
from scratch from that week’s material — see the DESIGN section of `Style.txt` —
and a stored design vocabulary is exactly the thing that stops that happening.
What lives here is what the paper knows: people, running stories, facts, and the
lessons the readership has handed down about writing.

## What goes here

- **Character profiles** — who people are, what they argue about, their
  recurring bits, how they relate to each other. Built from the logs, updated
  each issue.
- **Running stories** — threads that span multiple weeks. A religion being
  founded. A man who keeps proposing voice chat. A metric that became a labour
  market. Each gets a file and grows.
- **Factoids and corrections** — things verified against the logs with verbatim
  quotes and timestamps. "Grihastha writes the longest messages in the channel
  by a distance of twenty-five characters" is a factoid. "People say Grihastha
  is long-winded" is not.
- **Style notes** — lessons learned from reader feedback, things the chat told
  us to stop doing, patterns that worked.
- **Institutional memory** — production history, what was spiked and why,
  what the readership reacted to.

## Rules

1. **This is not the source of truth.** The chat logs are, and `Style.txt` is
   the authority on how to write. Everything here should be verifiable against a
   log file, a website, an image, or another primary source. Include the
   reference.

2. **Quote verbatim when possible.** "i want to give it a latin name because
   everyone does that why does everyone do that" is a reference. "She wanted
   a Latin name" is a paraphrase that loses the voice.

3. **Date and source everything.** "Ape, Sunday evening, Vol V" tells a future
   editor where to check. "Ape once said" does not.

4. **Update, don't append forever.** If a profile changes (someone leaves,
   someone's role shifts), update the file. Don't just add a line at the
   bottom.

5. **Write to this folder after an edition ships. Do not read it before
   writing one.** It is an archive of what the paper has printed, not a brief
   for the next issue: an issue is built from its own week of chat logs and
   nothing else, so that the paper does not converge on itself and so that the
   context goes to the week material. Read it when you need to check what was
   said about somebody after the fact, or when the editor asks for something
   specific from it.

## File structure

```
docs/memory/
├── README.md              ← this file
├── profiles/              ← one file per person (or per cluster)
├── running-stories/       ← multi-week threads
├── style-notes.md         ← writing lessons from reader feedback
├── production-history.md  ← what happened each issue, what was spiked
└── factoids.md            ← verified facts with quotes and sources
```

Create subdirectories as needed. File names should be lowercase with hyphens.
