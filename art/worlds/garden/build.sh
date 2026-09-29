#!/usr/bin/env bash
# Sculpture garden: fetch studio HDRI -> inflate sculptures -> bake clay GI -> runtime GLBs -> rail -> Cycles layers/pano/mini -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PUBG="$WORLDS_PUBLIC/garden"

node "$ART_ROOT/fetch/polyhaven.mjs" hdri studio_small_09 2k
node "$ART_ROOT/fetch/polyhaven.mjs" hdri studio_small_09 1k
mkdir -p "$PUBG/hi" "$PUBG/lo"
cp "$ART_CACHE/polyhaven/hdri/studio_small_09/studio_small_09_1k.hdr" "$PUBG/hi/studio.hdr"

blend garden --steps shapes,export,rail
node "$ART_ROOT/optimize.mjs" "$ART_OUT/garden/garden.glb" "$PUBG/hi/garden.glb" --tex none
blend garden --steps bake --variant both
for v in day night; do
  node "$ART_ROOT/optimize.mjs" "$ART_OUT/garden/plinths-$v.glb" "$PUBG/hi/plinths-$v.glb" --tex webp --size 2048
done
blend garden --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers garden
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/garden/pano-$v.png" "$PUBG/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/garden/mini.glb" "$PUBG/lo/mini.glb" --tex none
