#!/usr/bin/env bash
# Take the three screenshots the bounty asks for: the board, a protocol's detail view and a
# filtered view. Chrome is driven headless over the DevTools protocol so the page can be driven
# (a row clicked, a filter applied) before the frame is captured.
#
#   tools/screenshots.sh [outDir] [screenshotDir]
#
# The images are named 1-board.png, 2-detail.png and 3-filtered.png, and are sized so the scorer
# takes them: a long side of at most 1440 pixels and a short side of at least 800.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-out}"
SHOTS="${2:-screenshots}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PAGE="file://$(cd "$OUT" && pwd)/dashboard/index.html"
PORT=9333

mkdir -p "$SHOTS"
rm -f "$SHOTS"/*.png "$SHOTS"/*.jpg

# Chrome writes its own profile; a throwaway one keeps the user's profile untouched.
PROFILE="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --remote-debugging-port=$PORT --user-data-dir="$PROFILE" \
  --window-size=1440,900 --no-first-run --no-default-browser-check \
  about:blank >/dev/null 2>&1 &
CHROME_PID=$!
# Chrome writes into its profile as it shuts down; killing it and deleting the directory in the
# same breath leaves files behind and the trap's failure becomes the script's exit status. Wait
# for the process to go, then remove the directory, and never let cleanup fail the run.
cleanup() {
  kill "$CHROME_PID" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$CHROME_PID" 2>/dev/null || break
    sleep 0.25
  done
  kill -9 "$CHROME_PID" 2>/dev/null || true
  rm -rf "$PROFILE" 2>/dev/null || true
  return 0
}
trap cleanup EXIT

# Wait for the debugging endpoint.
for _ in $(seq 1 60); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

node tools/shoot.mjs "$PORT" "$PAGE" "$SHOTS"
echo "screenshots written to $SHOTS" >&2
