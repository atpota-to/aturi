#!/usr/bin/env sh
# Renders the app icons from the same mark and colours as the web app's
# apple-icon (src/app/apple-icon.tsx): the Lucide leaf in moss on a near-black
# ground. Needs rsvg-convert (librsvg). Run from the repo root:
#
#   sh ios/scripts/render-app-icon.sh
#
# iOS gets one 1024px square with the leaf at three quarters of the canvas;
# the system rounds the corners. macOS shows an icon exactly as drawn, so the
# Mac app's set draws the ground as Apple's icon plate (an 824px rounded
# square, corner radius 185.4, centred on the 1024px canvas) with the leaf at
# three quarters of the plate, at every size the Mac asset catalog lists.
set -eu
ios_out="ios/Aturi/Resources/Assets.xcassets/AppIcon.appiconset"
mac_out="ios/AturiMac/Assets.xcassets/AppIcon.appiconset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/ios.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0a0f0d"/>
  <g transform="translate(128 128) scale(32)" fill="none" stroke="#8a9a7f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </g>
</svg>
SVG

cat > "$tmp/mac.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185.4" ry="185.4" fill="#0a0f0d"/>
  <g transform="translate(203 203) scale(25.75)" fill="none" stroke="#8a9a7f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </g>
</svg>
SVG

rsvg-convert -w 1024 -h 1024 "$tmp/ios.svg" -o "$ios_out/AppIcon-1024.png"
echo "wrote $ios_out/AppIcon-1024.png"

# File names follow Apple's iconset convention: icon_<points>x<points>, with
# @2x for the double-density copy. They match $mac_out/Contents.json.
for size in 16 32 128 256 512; do
  double=$((size * 2))
  rsvg-convert -w "$size" -h "$size" "$tmp/mac.svg" -o "$mac_out/icon_${size}x${size}.png"
  rsvg-convert -w "$double" -h "$double" "$tmp/mac.svg" -o "$mac_out/icon_${size}x${size}@2x.png"
done
echo "wrote $mac_out (10 sizes)"
