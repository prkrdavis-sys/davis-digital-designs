#!/usr/bin/env bash
# Speech bubbles: inflate bubbles + glyphs -> Cycles cloud cards -> runtime GLB + layout -> rail -> layers/pano/mini -> web assets.
# Reflections use the garden's studio HDRI (public/worlds/garden/hi/studio.hdr, copied by garden/build.sh).
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PUBB="$WORLDS_PUBLIC/bubbles"

node "$ART_ROOT/fetch/polyhaven.mjs" hdri studio_small_09 2k
mkdir -p "$PUBB/hi" "$PUBB/lo"

blend bubbles --steps shapes,clouds --variant both
blend bubbles --steps export,rail
node "$ART_ROOT/optimize.mjs" "$ART_OUT/bubbles/bubbles.glb" "$PUBB/hi/bubbles.glb" --tex none
for v in day night; do
  for k in 0 1 2 3; do
    node -e 'require("sharp")(process.argv[1]).webp({ quality: 86, alphaQuality: 92, effort: 6 }).toFile(process.argv[2])' "$ART_OUT/bubbles/clouds/cloud-$v-$k.png" "$PUBB/hi/cloud-$v-$k.webp"
  done
done
blend bubbles --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers bubbles
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/bubbles/pano-$v.png" "$PUBB/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/bubbles/mini.glb" "$PUBB/lo/mini.glb" --tex none
