#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")"
PACKAGE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"

if [[ "$MANIFEST_VERSION" != "$PACKAGE_VERSION" ]]; then
  echo "manifest.json version ($MANIFEST_VERSION) does not match package.json ($PACKAGE_VERSION)" >&2
  exit 1
fi

FILES=(
  manifest.json
  background.js
  icon.js
  inactive-blur.js
  navigation.js
  options.css
  options.html
  options.js
  overlay.js
  popup.css
  popup.html
  popup.js
  search.js
  split-navigation.js
  split-picker.css
  split-picker.html
  split-picker.js
  tab-viewer.js
  theme.js
  update.js
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon-128.png
)

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Required package file is missing: $file" >&2
    exit 1
  fi
done

npm test

mkdir -p dist
OUTPUT="dist/helium-command-bar-${MANIFEST_VERSION}.zip"
rm -f "$OUTPUT"
zip -X -q "$OUTPUT" "${FILES[@]}"
unzip -tq "$OUTPUT" >/dev/null

if ! unzip -Z1 "$OUTPUT" | grep -qx 'manifest.json'; then
  echo "Packaged manifest.json is not at the archive root" >&2
  exit 1
fi

printf 'Created %s (%s)\n' "$OUTPUT" "$(du -h "$OUTPUT" | cut -f1)"
