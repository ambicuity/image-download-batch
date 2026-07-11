#!/usr/bin/env bash
# Build the Chrome Web Store upload package (runtime files only).
# Usage: scripts/build-zip.sh [output.zip]
# Produces a zip with manifest.json at the archive root and no dev/tooling files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-image-download-batch.zip}"
# make OUT absolute
case "$OUT" in /*) : ;; *) OUT="$ROOT/$OUT" ;; esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# --- runtime root files (fail if a required one is missing) ---
ROOT_FILES=(
  manifest.json
  bg-entry.js background.js contextMenu.js filenameTokens.js
  popup.html popup.css popup.js popup-bridge.js
  inject.js imageScraper.js captureSelection.js sanitize.js
  welcome.html welcome.js
  733.js
  icon16.png icon48.png icon128.png
)
for f in "${ROOT_FILES[@]}"; do
  [ -e "$f" ] || { echo "ERROR: required runtime file missing: $f" >&2; exit 1; }
  cp "$f" "$STAGE/"
done

# --- optional root assets (copy if present) ---
for f in *.LICENSE.txt onboarding_1.jpg onboarding_2.jpg onboarding_3.jpg onboarding_4.jpg; do
  [ -e "$f" ] && cp "$f" "$STAGE/" || true
done

# --- runtime directories ---
for d in _locales fonts external images; do
  [ -d "$d" ] && cp -R "$d" "$STAGE/" || true
done

find "$STAGE" -name ".DS_Store" -delete 2>/dev/null || true

# validate manifest is parseable + read version
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$STAGE/manifest.json','utf8')).version)")"

rm -f "$OUT"
( cd "$STAGE" && zip -rqX "$OUT" . -x "*.DS_Store" )

echo "Built: $OUT"
echo "Version: $VERSION"
echo "Files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
