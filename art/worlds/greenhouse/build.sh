#!/usr/bin/env bash
# The greenhouse: fetch CC0 assets -> bake (day + night) -> live plants -> rail/meta -> sky/env -> Cycles layers + pano + mini -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PH="node $ART_ROOT/fetch/polyhaven.mjs"
OUTD="$ART_OUT/greenhouse"
PUBD="$WORLDS_PUBLIC/greenhouse"

$PH hdri spruit_sunrise 4k >/dev/null
$PH hdri moonlit_golf 4k >/dev/null
for t in patterned_terracotta_tiling red_brick_03 farm_soil weathered_planks; do $PH texture "$t" 2k >/dev/null; done
for m in fern_02 calathea_orbifolia_01 anthurium_botany_01 potted_plant_01 potted_plant_02 pachira_aquatica_01 shrub_04 Lantern_01; do $PH model "$m" 1k >/dev/null; done

blend greenhouse --steps rail,meta,live,bake,sky,mini --variant both
node "$ART_ROOT/optimize.mjs" "$OUTD/arch.glb" "$PUBD/hi/arch.glb" --tex none
node "$ART_ROOT/optimize.mjs" "$OUTD/live.glb" "$PUBD/hi/live.glb" --tex mixed --size 1024
node "$ART_ROOT/optimize.mjs" "$OUTD/mini.glb" "$PUBD/lo/mini.glb" --tex none
node "$ART_ROOT/worlds/greenhouse/web.mjs"

blend greenhouse --steps layers,pano --variant both
node "$ART_ROOT/images.mjs" layers greenhouse
for v in day night; do node "$ART_ROOT/images.mjs" pano "$OUTD/pano-$v.png" "$PUBD/pano-$v.webp"; done
