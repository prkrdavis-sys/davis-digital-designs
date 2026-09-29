#!/usr/bin/env bash
# The golden dunes: fetch -> terrain/sky/slabs/props/rail -> Cycles bake -> web textures
# -> Low Resources layers, pano, mini. The terrain step needs ~3 GB of RAM.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
HERE="$ART_ROOT/worlds/dunes"
PUB="$WORLDS_PUBLIC/dunes"

node "$ART_ROOT/fetch/polyhaven.mjs" model dead_quiver_trunk 1k
node "$ART_ROOT/fetch/polyhaven.mjs" model namaqualand_boulder_02 1k
node "$ART_ROOT/fetch/polyhaven.mjs" texture coast_sand_05 1k
node "$HERE/panels.mjs"

blend dunes --steps terrain,sky,monoliths,props,rail --variant both
node "$ART_ROOT/optimize.mjs" "$ART_OUT/dunes/terrain.glb" "$PUB/hi/terrain.glb" --tex none
node "$ART_ROOT/optimize.mjs" "$ART_OUT/dunes/monoliths.glb" "$PUB/hi/monoliths.glb" --tex none
node "$ART_ROOT/optimize.mjs" "$ART_OUT/dunes/props.glb" "$PUB/hi/props.glb" --tex webp --size 512

blend dunes --steps shadow,bake --variant both --bake-size 2048 --shadow-size 4096 --samples 64
node "$HERE/textures.mjs"

blend dunes --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers dunes
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/dunes/pano-$v.png" "$PUB/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/dunes/mini.glb" "$PUB/lo/mini.glb" --tex none
