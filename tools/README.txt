TOOLS — what each one answers, so you can pick without reading the source.

All of them take the log folder (the one holding debate-log.md and images/) as
the first argument, and they all read working/MM-DD.md, which split.js writes.
log.js is the shared parser and reads every format the archive has used — the
compact day files from the 8.28 log on, and the older per-message form before it.
If the format changes again, that is the only file that has to change.


READING THE WEEK

  split.js      debate-log.md -> working/MM-DD.md, one compact line per message,
                Eastern time, plus the index files. Run once. If working/ is
                already there, it has been run: read it, do not re-split.

  reacted.js    The room's own highlight reel — every message at N+ reactions,
                sorted by total. Counts are summed, so ten emotes at x2 outranks
                one emote at x14. Start lead-hunting here, then read the thread.
                  node tools/reacted.js "<log>" 4

  unreacted.js  What reactions miss. Default mode finds messages three or more
                people replied to and nobody reacted to — the arguments, as
                opposed to the jokes. Also: long, caps, questions, threads.
                  node tools/unreacted.js "<log>" engaged
                  node tools/unreacted.js "<log>" threads

  person.js     One account end to end, with what each message was replying to.
                This is how you find a position held all week rather than a line
                that happened to land. TAIL dumps every quiet account at once.
                  node tools/person.js "<log>" quigley 80
                  node tools/person.js "<log>" TAIL 20

  day.js        One day in sequence, everyone in it, filterable by hour and by
                person. Use it to put a quote back in the context it came from
                before you print it.
                  node tools/day.js "<log>" 08-24 --from 09:00 --to 11:00

  vocab.js      Who says a word or phrase, how many times, with examples. Turns
                a hunch into a factoid. Exact phrase matching; stats2.js counts
                variants and is the better tool for "how often does X come up".
                  node tools/vocab.js "<log>" "sword from the stone" cope
                  node tools/vocab.js "<log>" --top 60

  stats2.js     Chartable counts for a numbers page: messages per day and hour,
                per person, philosophers mentioned, set phrases, reactions.

  society.js    Who talks to whom. Reply and mention graphs, per-pair counts,
                who answers and who gets answered, as JSON.
                  node tools/society.js "<log>/working" > society.json


BUILDING THE PAPER

  build.js      parts/*.html -> issue.html. One file per page; this concatenates
                them and inlines the nameplate font and the measuring script.

  fill.js       Measures every column of the built HTML and reports short
                columns, holes, and copy silently clipped into a hidden column.
                Run after every substantive edit, not once at the end.
                  node tools/fill.js "<edition>/issue.html" --all

  render.sh     issue.html -> issue.pdf, pages/page-NN.png, issue.txt.
                  DPI=100 bash tools/render.sh "<edition>/issue.html"

  measure-snippet.js   The in-page measuring code build.js inlines. Not run
                directly; fill.js drives it.

  b64font.js    Emits nameplate-font.css with the blackletter face embedded as
                base64. Headless Chrome will not fetch a webfont.

  sudoku.js     A sudoku with a unique solution, if the paper wants a puzzle.


NOT HERE ON PURPOSE

  No tool that scores or ranks people, and no folder of last week's page
  designs. Both existed once. The first produced the ranking content the
  readership complained about; the second is a parts bin, which DESIGN in
  Style.txt forbids. A page builder written for one issue belongs in that
  issue's folder under Past Editions, not here.
