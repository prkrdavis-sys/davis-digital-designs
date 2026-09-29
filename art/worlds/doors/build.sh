#!/usr/bin/env bash
# Pick a door: CC0 textures -> arches + baked colonnade -> rail -> Cycles layers, pano, mini -> web assets.
# Portals sample the other worlds' panoramas, so build those worlds first for the best Low/pano stills.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"

for t in sandstone_cracks black_walnut_veneer_01; do node "$ART_ROOT/fetch/polyhaven.mjs" texture "$t" 1k >/dev/null; done

blend doors --steps arches,bake,rail --variant both
node "$ART_ROOT/optimize.mjs" "$ART_OUT/doors/arches.glb" "$WORLDS_PUBLIC/doors/hi/arches.glb" --size 1024
for v in day night; do
  node "$ART_ROOT/optimize.mjs" "$ART_OUT/doors/corridor-$v.glb" "$WORLDS_PUBLIC/doors/hi/corridor-$v.glb" --size 2048
done
blend doors --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers doors
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/doors/pano-$v.png" "$WORLDS_PUBLIC/doors/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/doors/mini.glb" "$WORLDS_PUBLIC/doors/lo/mini.glb" --tex webp --size 256
