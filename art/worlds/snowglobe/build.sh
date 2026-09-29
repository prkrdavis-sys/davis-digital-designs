#!/usr/bin/env bash
# The snow globe: fetch CC0 sources -> layout/rail -> lightmap bake + GLBs -> env HDRs
# -> Cycles layers/posters -> pano -> mini -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
HERE="$ART_ROOT/worlds/snowglobe"
PUB="$WORLDS_PUBLIC/snowglobe"

node "$ART_ROOT/fetch/polyhaven.mjs" hdri christmas_photo_studio_01 2k >/dev/null
node "$ART_ROOT/fetch/polyhaven.mjs" texture wood_table_001 2k >/dev/null
node "$ART_ROOT/fetch/polyhaven.mjs" texture wood_table_001 1k >/dev/null
node "$ART_ROOT/fetch/polyhaven.mjs" texture black_walnut_veneer_01 1k >/dev/null
node "$ART_ROOT/fetch/polyhaven.mjs" texture fabric_leather_02 1k >/dev/null

blend snowglobe --steps meta,rail,bake
node "$HERE/lightmaps.mjs"
node "$HERE/optimize-lm.mjs" "$ART_OUT/snowglobe/village.glb" "$PUB/hi/village.glb"
node "$HERE/optimize-lm.mjs" "$ART_OUT/snowglobe/desk.glb" "$PUB/hi/desk.glb"
blend snowglobe --steps env --variant both --samples 96

blend snowglobe --steps layers --variant both --samples 64
node "$ART_ROOT/images.mjs" layers snowglobe
blend snowglobe --steps pano,mini --variant both --samples 64
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/snowglobe/pano-$v.png" "$PUB/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/snowglobe/mini.glb" "$PUB/lo/mini.glb" --tex none
