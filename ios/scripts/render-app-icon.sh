#!/usr/bin/env sh
# Renders the app icon from the same mark and colours as the web app's
# apple-icon (src/app/apple-icon.tsx): the Lucide leaf in moss on a near-black
# ground, the leaf at three quarters of the canvas. Needs rsvg-convert
# (librsvg). Run from the repo root:
#
#   sh ios/scripts/render-app-icon.sh
set -eu
out="ios/Aturi/Resources/Assets.xcassets/AppIcon.appiconset"
tmp="$(mktemp -t aturi-icon.XXXXXX.svg)"
cat > "$tmp" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0a0f0d"/>
  <g transform="translate(128 128) scale(32)" fill="none" stroke="#8a9a7f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </g>
</svg>
SVG
rsvg-convert -w 1024 -h 1024 "$tmp" -o "$out/AppIcon-1024.png"
rm -f "$tmp"
echo "wrote $out/AppIcon-1024.png"
