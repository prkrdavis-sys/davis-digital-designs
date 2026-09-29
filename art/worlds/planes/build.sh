#!/usr/bin/env bash
# Paper planes: fetch CC0 paper + walnut -> print/plane/mini/rail -> cloud impostor atlas -> Cycles layers + pano -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PUB="$WORLDS_PUBLIC/planes"
OUTP="$ART_OUT/planes"

node "$ART_ROOT/fetch/ambientcg.mjs" Paper001 1K
node "$ART_ROOT/fetch/polyhaven.mjs" texture black_walnut_veneer_01 1k

blend planes --steps print,plane,mini,rail
node "$ART_ROOT/optimize.mjs" "$OUTP/plane.glb" "$PUB/hi/plane.glb" --tex none
node "$ART_ROOT/optimize.mjs" "$OUTP/mini.glb" "$PUB/lo/mini.glb" --size 1024
node "$ART_ROOT/images.mjs" pano "$OUTP/paper.png" "$PUB/hi/paper.webp" 2048
node "$ART_ROOT/images.mjs" pano "$ART_CACHE/ambientcg/Paper001/Paper001_1K-JPG_NormalGL.jpg" "$PUB/hi/paper-normal.webp" 1024

# Relightable cloud impostors (per-cell EXRs are cached in art/out/planes, delete them to re-render).
blend planes --steps atlas
node "$(dirname "$0")/atlas.mjs" "$OUTP/clouds.png" "$PUB/hi/clouds.webp"

blend planes --steps layers,pano --variant both
node "$ART_ROOT/images.mjs" layers planes
for v in day night; do node "$ART_ROOT/images.mjs" pano "$OUTP/pano-$v.png" "$PUB/pano-$v.webp"; done
