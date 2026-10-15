#!/usr/bin/env bash
# Glass gallery: facets + baked room -> rail -> Cycles layers and panorama -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"

blend monolith --steps room,bake,rail --variant both
node "$ART_ROOT/optimize.mjs" "$ART_OUT/monolith/facets.glb" "$WORLDS_PUBLIC/monolith/hi/facets.glb" --tex none
for v in day night; do
  node "$ART_ROOT/optimize.mjs" "$ART_OUT/monolith/room-$v.glb" "$WORLDS_PUBLIC/monolith/hi/room-$v.glb" --size 1536
done
blend monolith --steps layers,pano --variant both
node "$ART_ROOT/images.mjs" layers monolith
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/monolith/pano-$v.png" "$WORLDS_PUBLIC/monolith/pano-$v.webp" 2048; done
