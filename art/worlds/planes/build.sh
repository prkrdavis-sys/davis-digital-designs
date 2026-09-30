#!/usr/bin/env bash
# Paper planes: fetch CC0 paper + walnut -> print/plane/mini/rail -> cloud impostor atlas -> Cycles layers + pano -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
PUB="$WORLDS_PUBLIC/planes"
OUTP="$ART_OUT/planes"
GLTF="$(dirname "$ART_ROOT")/node_modules/.bin/gltf-transform"

node "$ART_ROOT/fetch/ambientcg.mjs" Paper001 1K
node "$ART_ROOT/fetch/polyhaven.mjs" texture black_walnut_veneer_01 1k

blend planes --steps print,plane,mini,rail
# The plane's material has no texture (the runtime supplies the print atlas), so
# optimize.mjs would prune its UVs; meshopt alone keeps every attribute.
"$GLTF" meshopt "$OUTP/plane.glb" "$PUB/hi/plane.glb" --level high
# optimize.mjs only resizes for webp output, so shrink the mini's textures first.
"$GLTF" resize "$OUTP/mini.glb" "$OUTP/mini-512.glb" --width 512 --height 512
node "$ART_ROOT/optimize.mjs" "$OUTP/mini-512.glb" "$PUB/lo/mini.glb"
node "$ART_ROOT/images.mjs" pano "$OUTP/paper.png" "$PUB/hi/paper.webp" 2048
node "$ART_ROOT/images.mjs" pano "$ART_CACHE/ambientcg/Paper001/Paper001_1K-JPG_NormalGL.jpg" "$PUB/hi/paper-normal.webp" 1024

# Relightable cloud impostors (per-cell EXRs are cached in art/out/planes, delete them to re-render).
blend planes --steps atlas
node "$(dirname "$0")/atlas.mjs" "$OUTP/clouds.png" "$PUB/hi/clouds.webp"

blend planes --steps layers,pano --variant both
node "$ART_ROOT/images.mjs" layers planes
for v in day night; do node "$ART_ROOT/images.mjs" pano "$OUTP/pano-$v.png" "$PUB/pano-$v.webp"; done
