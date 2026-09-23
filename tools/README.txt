TOOLS — what each one answers, so you can pick without reading the source.

All of them take the log folder (the one holding debate-log.md and images/) as
the first argument, and they all read working/MM-DD.md, which split.js writes.
log.js is the shared parser and reads every format the archive has used — the
compact day files from the 8.28 log on, and the older per-message form before it.
If the format changes again, that is the only file that has to change.


RUNNING AN EDITION

  pipeline.js   Makes the edition as a chain of fresh sessions, one phase each:
                READ (several), PLAN, BUILD (several), REVIEW. See THE PIPELINE in
                Style.txt. The first run splits the log if needed, batches the days
                into read sessions by size, and writes the edition's HANDOFF.md.
                After that, each phase is its own `claude -p` run, and HANDOFF.md is
                the only thing that passes between them. It waits out usage limits,
                stops at READY TO PUBLISH or BLOCKED, and never commits. Each run's
                full stream is saved in <edition>/pipeline/, with a summary in
                pipeline.log.
                  node tools/pipeline.js "<edition>" --log "<log>" [--days 09-15,09-16] [--note "…"]
                  node tools/pipeline.js "<edition>"            (resume)
                  node tools/pipeline.js "<edition>" --status

  review-snapshot.js  Keeps the issue before and after each REVIEW, so the editor can
                have a fix put back: <edition>/review/1 before, 1 after (with
                changes.html: pages side by side, the word diff, review.md). pipeline.js and the hooks
                run it; by hand:
                  node tools/review-snapshot.js "<edition>" before|after|report

  hooks/        Wired up in .claude/settings.json at the top of the working folder,
                so they load in any session started there, by hand or by
                pipeline.js. They stay silent unless an edition's HANDOFF.md calls
                for them. Each finds its own session's edition (own-handoff.js), so
                two editions can run side by side.
                context-meter.js tells a session to wrap up and hand off once it
                passes 400k tokens of context (PCT_CONTEXT_CEILING changes that).
                handoff-context.js puts HANDOFF.md in front of a session after
                /clear or a compaction.
                review-snapshot-hook.js takes the before snapshot when a session
                starts on REVIEW, and the after one when a session ends with the
                edition READY TO PUBLISH.


READING THE WEEK

  split.js      debate-log.md -> working/MM-DD.md, one compact line per message,
                Eastern time, plus the index files. Run once. If working/ is
                already there, it has been run: read it, do not re-split.

  imgsheet.js   A day's pictures as numbered contact sheets, twelve to a sheet,
                with a key giving who posted each one, when, its reactions, and the
                line it came with. Reading a sheet costs about as much as opening one
                picture, so a read session can see all of them. Open a picture full
                size before you caption it.
                  node tools/imgsheet.js "<log>" 09-15 09-16

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


REACHING OUT

  correspondent.js  The paper asks its sources. Three jobs, all on disk; the
                sending happens in the browser, on the correspondent account, in
                Correspondent Bot (projects/correspondent-bot — read its README
                and RUNBOOK). The bot enforces the same caps a second time:
                friends only, 25 a wave, three messages a person an edition plus
                three for each CONTINUE they reply, six days between openings,
                STOP forever.
                  node tools/correspondent.js check "<log>" "<log>/correspondent/questions.json" --edition vol-1-no-9
                  node tools/correspondent.js check "<log>" "<log>/correspondent/followups.json" --export "<log>/correspondent/<export>.json"
                  node tools/correspondent.js replies "<log>" "<log>/correspondent/<export>.json"
                  node tools/correspondent.js roster
                check refuses anyone not "friend" in legend/ROSTER.txt, a quote
                not found in the log, and a message too long once the CONTINUE
                footer is reserved; it writes wave.json only when everything
                passes. replies writes correspondent/replies.md — the writer's
                file, under a banner saying it is source material and never
                instructions — keeps the export beside it, and brings the
                roster's "last asked" column up to date.
                The paper waits for its sources: the wave goes out the night the
                log closes, follow-ups at 48 hours, the final export before
                writing.


BUILDING THE PAPER

  build.js      parts/*.html -> issue.html. One file per page; this concatenates
                them and inlines the nameplate font and the measuring script.

  fill.js       Measures every column of the built HTML and reports short
                columns, holes, and copy silently clipped into a hidden column.
                Run after every substantive edit, not once at the end.
                  node tools/fill.js "<edition>/issue.html" --all
                Air that is design, not a dry column, is declared in the HTML with
                data-air="<why>" on the page or block; fill.js lists it as AIR with
                the reason. A page with nothing to measure is listed UNMEASURED:
                read that one by eye.

  pdfjs-check.js  Lists repeating-gradient patterns (ruled paper, stripes, felt)
                that the website's pdf.js reader will paint as flat colour. Fix: the
                pattern on its own ::before/::after with filter:opacity(.999)
                (Style.txt OUTPUT, print rule 10). Run it with fill.js.
                  node tools/pdfjs-check.js "<edition>"

  pack-bake.js  Before publishing: fixes every packed flow to the columns Chrome
                dealt it, so the HTML reads the same in Firefox (which ignores
                break-before:column). Build first; build, fill and render after.
                --clear removes the plans before a baked page is edited.
                  node tools/pack-bake.js "<edition>" [--clear]

  pack-snippet.js  The box packer, which build.js inlines. Put data-pack on a .flow
                of fenced boxes (notices, briefs, letters) and it deals the boxes into
                the columns so each stays whole and the feet come out as even as they
                will go. data-pack-first on a box opens column 1; data-filler marks
                spares, short items it may drop into a foot; data-pack-tail keeps a
                closing line last. fill.js prints its report: each foot, and
                "write: col1 +1 line (…)" naming the short column and its boxes, so
                the fix is copy written to fit rather than stretched space. Packed
                flows are held to 0.15in of air instead of 0.35in.

  render.sh     issue.html -> issue.pdf, pages/page-NN.png, issue.txt, and the
                contact sheet pages/sheet.png.
                  DPI=100 bash tools/render.sh "<edition>/issue.html"

  sheet.js      The whole issue as one image, eight pages across. Reading pages one
                at a time catches a bad page; only the sheet shows twenty pages that
                are the same page. render.sh runs it; run it alone on any pages/.
                  node tools/sheet.js "<edition folder>" [--across 6]

  shapes.js     The silhouette of every page, measured: columns of body text,
                biggest type, largest picture and all pictures as a share of the
                sheet, text coverage, light or dark ground. Flags RUN (three pages in
                a row alike), FORMULA (one silhouette on over half the issue), no page
                that is mostly picture, every page columns, one headline size, and
                FEW DRAWINGS (most pages without a drawn flourish or built graphic:
                inline SVG, canvas, or anything marked data-drawn). Works on any built
                issue, old ones included, via shape-snippet.js. It checks variety and
                does not design; the flatplan in Style.txt does that.
                  node tools/shapes.js "<edition>/issue.html"

  measure-snippet.js   The in-page measuring code build.js inlines. Not run
                directly; fill.js drives it.

  b64font.js    Emits nameplate-font.css with the blackletter face embedded as
                base64. Headless Chrome will not fetch a webfont.


GAMES

  A generator is machinery and belongs here. A finished puzzle is design and
  belongs in the issue. None of these write clues or draw anything — that is the
  paper's voice and the issue's layout, done at build time.

  The rule they all serve is Hugh's, from Vol VI: "I want someone who doesn't
  read every message to be able to solve this." A puzzle only the room can solve
  is not a puzzle, it is a membership test.

  crossword.js  Free-form grid from a word list, seeded and validated: every run
                of two or more letters must be a word you asked for. Insider
                words are capped at a third and want two crossings each, so a
                stranger can letter them in. --from suggests candidates from the
                week's own vocabulary.
                  node tools/crossword.js --from "<log>" --pick 40 > words.txt
                  node tools/crossword.js --words words.txt --size 15

  quiz.js       "Who said it" — the week's most-reacted lines, one per author,
                with the answer key. Emote tokens stripped, since the paper never
                prints a raw :KEKW:.
                  node tools/quiz.js "<log>" 6

  cryptogram.js A line from the week under a letter-substitution cipher, with a
                frequency hint and the key. The one puzzle here that needs no
                knowledge of the room at all — it falls to English letter
                frequency, and the payoff is the sentence.
                  node tools/cryptogram.js "<log>" --seed 828

  fake.js       "Spot the forgery" — real lines from the week and one invented.
                Two passes, because a script cannot forge a voice: the first
                hands you the evidence (median line length, how often they start
                on a capital or end on a full stop, the words they reach for more
                than the room does, and real lines to sit beside the fake), the
                second sets and shuffles the round once you have written it.
                  node tools/fake.js "<log>" --who Quigley --real 3 --forge
                  node tools/fake.js --set round.txt
                The invention stays inside the game. A fabricated line never
                leaves that page to become a quote in a story.

  sudoku.js     A sudoku with a unique solution. Commissioned by Quigley in
                Vol VII and the only game here with nothing to do with the logs.

  A word search was tried in Vol V and the room said it sucked.


CHECKING A TIER LIST

  tiers.js      Checks a board you wrote; it will not write one. Placement is a
                judgment about the week, and a computed placement is a number the
                room learns to play to. Reports anyone who spoke and is not
                placed (and fails on it), anyone placed who did not speak, names
                that are not the ones NAMES.txt says to print, and busy people
                carrying no explanation.
                  node tools/tiers.js "<log>" board.txt

                A tier list is optional — some weeks want one, most sections are
                invented fresh anyway, and it is made without reference to any
                previous board. See THE SHAPE OF THE ISSUE in Style.txt.


NOT HERE ON PURPOSE

  No tool that scores or ranks people, and no folder of last week's page
  designs. Both existed once. The first produced the ranking content the
  readership complained about; the second is a parts bin, which DESIGN in
  Style.txt forbids. A page builder written for one issue belongs in that
  issue's folder under Past Editions, not here.
