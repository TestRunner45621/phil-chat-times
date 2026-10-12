#!/usr/bin/env bash
# check.sh — the BUILD check loop: build, measure, render, in one call with short output. Vol XII's batches each wrote
# their own version of this (scratch/b*/go.sh, one.sh); it lives here now so no session spends turns rebuilding it.
#
#   bash tools/check.sh "<edition>" <part.html> [dpi]   ONE page, fast: a mini edition of 00-head + the part +
#        99-furniture in <edition>/scratch/check/, measured with fill.js and rendered to
#        <edition>/scratch/check/pages/page-1.png (100 dpi by default). It prints as page 1 there, so running heads
#        and cross-references show page 1; the full build numbers them.
#   bash tools/check.sh "<edition>" --all [pattern] [dpi]   the WHOLE issue: build.js, fill.js --all (only pages
#        whose fill line matches the grep pattern are shown), render.sh to <edition>/pages/.
#   CROP="x y w h" bash tools/check.sh ...   also writes crop-1.png: that region of the page in pixels at the dpi
#        (pdftoppm -x -y -W -H), to look closely at one edge or corner. Use dpi 200-300 for crops.
#
# It prints the fill.js lines and the PNG paths, nothing else. Look at the PNG every time: the numbers can't see a
# clipped caption or a line running through a label.
set -uo pipefail
cd "$(dirname "$0")/.."
E="${1:?usage: check.sh \"<edition>\" <part.html>|--all [pattern] [dpi]}"
[ -d "$E" ] || { echo "no edition folder: $E"; exit 1; }

if [ "${2:-}" = "--all" ]; then
  PAT="${3:-.}"; DPI="${4:-100}"
  node tools/build.js "$E" >/dev/null || { echo "build.js failed"; exit 2; }
  node tools/fill.js "$E/issue.html" --all 2>&1 | awk -v pat="$PAT" '/^page /{show=($0 ~ pat)} show'
  DPI="$DPI" bash tools/render.sh "$E/issue.html" 2>&1 | grep -E "PDF not|pngs"
  PDF="$E/issue.pdf"; OUT="$E/pages"
else
  PART="${2:?usage: check.sh \"<edition>\" <part.html> [dpi]}"; DPI="${3:-100}"
  [ -f "$E/parts/$PART" ] || { echo "no part: $E/parts/$PART"; exit 1; }
  S="$E/scratch/check"; mkdir -p "$S/parts" "$S/img"; rm -f "$S"/parts/*.html
  cp "$E/parts/00-head.html" "$E/parts/99-furniture.html" "$E/parts/$PART" "$S/parts/"
  # the pictures the part (and the head) point at
  for f in $(grep -oh "img/[^\"') ]*" "$E/parts/$PART" "$E/parts/00-head.html" | sort -u); do
    [ -f "$E/$f" ] && { mkdir -p "$S/$(dirname "$f")"; [ "$E/$f" -nt "$S/$f" ] && cp "$E/$f" "$S/$f"; }
  done
  node tools/build.js "$S" >/dev/null || { echo "build.js failed"; exit 2; }
  node tools/fill.js "$S/issue.html" --all 2>&1
  CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
  W="$(cygpath -m "$(pwd)/$S/issue.html")"; PDF="$S/issue.pdf"
  "$CH" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --no-pdf-header-footer --virtual-time-budget=20000 \
    --run-all-compositor-stages-before-draw --print-to-pdf="$(cygpath -w "$(pwd)/$PDF")" "file:///$W" 2>/dev/null
  [ -s "$PDF" ] || { echo "PDF not produced"; exit 2; }
  OUT="$S/pages"; rm -rf "$OUT"; mkdir -p "$OUT"
  pdftoppm -png -r "$DPI" -f 1 -l 1 "$PDF" "$OUT/page"
  echo "png: $OUT/page-1.png"
fi

if [ -n "${CROP:-}" ]; then
  read -r X Y CW CHT <<<"$CROP"
  PG="${PAGE:-1}"
  pdftoppm -png -r "$DPI" -f "$PG" -l "$PG" -x "$X" -y "$Y" -W "$CW" -H "$CHT" "$PDF" "$OUT/crop"
  echo "crop: $(ls "$OUT"/crop-*.png | head -1)"
fi
