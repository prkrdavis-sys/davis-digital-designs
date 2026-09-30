#!/usr/bin/env bash
# Homepage diorama: sunset HDRI -> rail/layout -> bake island GI -> mini ->
# Cycles layers/pano (re-runnable once every world's mini.glb is merged).
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PUB="$WORLDS_PUBLIC/diorama"

node "$ART_ROOT/fetch/polyhaven.mjs" hdri venice_sunset 2k || true

mkdir -p "$PUB/hi" "$PUB/lo"
blend diorama --steps rail
blend diorama --steps bake,mini --variant both
node "$ART_ROOT/optimize.mjs" "$ART_OUT/diorama/terrain-day.glb" "$PUB/hi/terrain-day.glb" --tex webp --size 2048
node "$ART_ROOT/optimize.mjs" "$ART_OUT/diorama/terrain-night.glb" "$PUB/hi/terrain-night.glb" --tex webp --size 2048
node "$ART_ROOT/optimize.mjs" "$ART_OUT/diorama/mini.glb" "$PUB/lo/mini.glb" --tex none

blend diorama --steps layers,pano --variant both
node "$ART_ROOT/images.mjs" layers diorama
for v in day night; do
  node "$ART_ROOT/images.mjs" pano "$ART_OUT/diorama/pano-$v.png" "$PUB/pano-$v.webp"
done
