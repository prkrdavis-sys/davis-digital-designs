#!/usr/bin/env bash
# Inside the machine: fetch CC0 sources -> artwork -> GI bakes + GLBs -> rail -> Cycles layers -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
OUT="$ART_OUT/pinball"
PUB="$WORLDS_PUBLIC/pinball"

node "$ART_ROOT/fetch/polyhaven.mjs" texture ash_veneer 2k >/dev/null
node "$ART_ROOT/fetch/polyhaven.mjs" hdri studio_small_09 2k >/dev/null
# Display fonts (SIL Open Font License) from github.com/google/fonts.
mkdir -p "$ART_CACHE/fonts"
for f in ofl/archivoblack/ArchivoBlack-Regular.ttf ofl/bebasneue/BebasNeue-Regular.ttf ofl/titanone/TitanOne-Regular.ttf; do
  dst="$ART_CACHE/fonts/$(basename "$f")"
  [ -s "$dst" ] || curl -fsSL -o "$dst" "https://raw.githubusercontent.com/google/fonts/main/$f"
done

blend pinball --steps art,bake,data,rail --variant both
node "$ART_ROOT/optimize.mjs" "$OUT/hardware.glb" "$PUB/hi/hardware.glb" --tex mixed --size 2048
for v in day night; do
  node "$ART_ROOT/optimize.mjs" "$OUT/cabinet-$v.glb" "$PUB/hi/cabinet-$v.glb" --tex mixed --size 2048
  node "$ART_ROOT/images.mjs" pano "$OUT/$v/lightmap.png" "$PUB/hi/lightmap-$v.webp" 1024
done
node "$ART_ROOT/images.mjs" pano "$OUT/playfield_art.png" "$PUB/hi/playfield.webp" 2048

blend pinball --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers pinball
for v in day night; do node "$ART_ROOT/images.mjs" pano "$OUT/pano-$v.png" "$PUB/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$OUT/mini.glb" "$PUB/lo/mini.glb" --tex mixed --size 512
