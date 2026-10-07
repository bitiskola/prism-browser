#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/icons
convert -background none build/icon.svg build/icon.png
for size in 16 24 32 48 64 128 256 512; do
  convert build/icon.png -resize "${size}x${size}" "build/icons/${size}x${size}.png"
done
