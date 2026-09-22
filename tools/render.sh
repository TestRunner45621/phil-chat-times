#!/usr/bin/env bash
# render.sh — render issue.html to PDF with headless Chrome, then page PNGs and a pdftotext extract.
# Usage: bash tools/render.sh "<path to issue.html>"   (outputs land next to the HTML)
set -euo pipefail
HTML="$1"
DIR="$(cd "$(dirname "$HTML")" && pwd)"
BASE="$(basename "$HTML" .html)"
PDF="$DIR/$BASE.pdf"
TXT="$DIR/$BASE.txt"
PAGES="$DIR/pages"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
WINHTML="$(cygpath -w "$DIR/$(basename "$HTML")")"
WINPDF="$(cygpath -w "$PDF")"
URL="file:///$(echo "$WINHTML" | sed 's#\\#/#g')"

echo "rendering $URL"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --no-pdf-header-footer \
  --virtual-time-budget=30000 --run-all-compositor-stages-before-draw \
  --print-to-pdf="$WINPDF" "$URL" 2>/dev/null || true
[ -s "$PDF" ] || { echo "PDF not produced"; exit 2; }
echo "pdf: $PDF ($(stat -c %s "$PDF") bytes)"

if command -v pdfinfo >/dev/null 2>&1; then pdfinfo "$PDF" | grep -E '^(Pages|Page size)'; fi

rm -rf "$PAGES"; mkdir -p "$PAGES"
pdftoppm -png -r "${DPI:-72}" "$PDF" "$PAGES/page"
echo "pngs: $(ls "$PAGES" | wc -l) in $PAGES"

pdftotext -layout "$PDF" "$TXT"
echo "text: $TXT ($(wc -w < "$TXT") words)"

# the whole issue on one image: sameness only shows at thumbnail size (see THE BAR)
node "$(dirname "$0")/sheet.js" "$DIR" || echo "sheet.js failed (pages are still fine)"
