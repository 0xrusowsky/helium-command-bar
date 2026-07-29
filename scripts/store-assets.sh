#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required to render the macOS store assets" >&2
  exit 1
fi

sips -s format png store/assets/small-promo.svg \
  --out store/assets/small-promo.png >/dev/null
sips -s format png store/assets/marquee-promo.svg \
  --out store/assets/marquee-promo.png >/dev/null

small_size="$(sips -g pixelWidth -g pixelHeight store/assets/small-promo.png 2>/dev/null | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w "x" h}')"
marquee_size="$(sips -g pixelWidth -g pixelHeight store/assets/marquee-promo.png 2>/dev/null | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w "x" h}')"

[[ "$small_size" == "440x280" ]] || { echo "Unexpected small tile size: $small_size" >&2; exit 1; }
[[ "$marquee_size" == "1400x560" ]] || { echo "Unexpected marquee tile size: $marquee_size" >&2; exit 1; }

printf 'Rendered store/assets/small-promo.png (%s)\n' "$small_size"
printf 'Rendered store/assets/marquee-promo.png (%s)\n' "$marquee_size"
