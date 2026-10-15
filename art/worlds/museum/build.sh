#!/usr/bin/env bash
# Featured work: content/work covers -> gallery pieces + baked marble hall -> rail -> Cycles layers, pano, mini -> web assets.
# CPU budget (4 cores): bake 2048 px at 128 spp, stills at 48 spp with OpenImageDenoise.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"

for m in marble_bust_01 horse_head gothic_statue; do node "$ART_ROOT/fetch/polyhaven.mjs" model "$m" 1k >/dev/null; done

blend museum --steps covers,gallery,rail
blend museum --steps bake --variant both --bake-size "${BAKE_SIZE:-2048}" --samples "${BAKE_SAMPLES:-128}"
for v in day night; do
  for f in walls ceiling furniture floor; do node "$ART_ROOT/images.mjs" clean "$ART_OUT/museum/bake-$v/$f.png"; done
done
blend museum --steps relink --variant both
node "$ART_ROOT/optimize.mjs" "$ART_OUT/museum/gallery.glb" "$WORLDS_PUBLIC/museum/hi/gallery.glb" --size 1024
for v in day night; do
  node "$ART_ROOT/optimize.mjs" "$ART_OUT/museum/hall-$v.glb" "$WORLDS_PUBLIC/museum/hi/hall-$v.glb" --size 2048
done
blend museum --steps layers,pano,mini --variant both --samples "${STILL_SAMPLES:-48}"
node "$ART_ROOT/images.mjs" layers museum
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/museum/pano-$v.png" "$WORLDS_PUBLIC/museum/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/museum/mini.glb" "$WORLDS_PUBLIC/museum/lo/mini.glb" --tex webp --size 512
