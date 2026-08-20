# docs/memory — The Newsroom's Collected Knowledge

This folder is the Phil Chat Times editorial memory. Agents writing the paper
read it before they start and write to it when they finish.

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

1. **This is not the source of truth.** The chat logs are. Everything here
   should be verifiable against a log file, a website, an image, or another
   primary source. Include the reference.

2. **Quote verbatim when possible.** "i want to give it a latin name because
   everyone does that why does everyone do that" is a reference. "She wanted
   a Latin name" is a paraphrase that loses the voice.

3. **Date and source everything.** "Ape, Sunday evening, Vol V" tells a future
   editor where to check. "Ape once said" does not.

4. **Update, don't append forever.** If a profile changes (someone leaves,
   someone's role shifts), update the file. Don't just add a line at the
   bottom.

5. **Agents should read this folder before writing a new edition** and write
   to it after. The knowledge compounds.

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
