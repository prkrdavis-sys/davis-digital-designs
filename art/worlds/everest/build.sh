#!/usr/bin/env bash
# The long way up: Copernicus DEM + Sentinel-2 + OSM trails -> terrain mesh, Cycles bakes, rail
# -> Low Resources layers, posters, panoramas and the homepage miniature -> web assets.
#
#   bash art/worlds/everest/build.sh            full build (the two terrain bakes take a long time on a CPU)
#   BAKE=0 bash art/worlds/everest/build.sh     reuse the committed terrain-*.ktx2 bakes (decoded for the stills)
set -euo pipefail
source "$(dirname "$0")/../../env.sh"
HERE="$ART_ROOT/worlds/everest"
PUB="$WORLDS_PUBLIC/everest"
OUTD="$ART_OUT/everest"
mkdir -p "$OUTD" "$PUB/hi" "$PUB/lo"
cd "$ART_ROOT/.."

# Copernicus GLO-30 tiles covering 27-29N, 86-88E, then the metric grid, heightfield and route.
for tile in "27.5 86.5" "27.5 87.5" "28.5 86.5" "28.5 87.5"; do
  node "$ART_ROOT/fetch/geo.mjs" dem $tile
done
node "$HERE/geo.mjs" dem
node "$HERE/route.mjs"

if [ "${BAKE:-1}" = "1" ]; then
  node "$HERE/geo.mjs" s2
  blend everest --steps terrain,bake,rail --variant both
  for v in day night; do
    toktx --t2 --encode etc1s --clevel 4 --qlevel 230 --genmipmap --assign_oetf srgb --target_type RGB \
      "$PUB/hi/terrain-$v.ktx2" "$OUTD/terrain-$v.png"
  done
else
  blend everest --steps terrain,rail
  for v in day night; do
    ktx extract --transcode rgba8 "$PUB/hi/terrain-$v.ktx2" "$OUTD/terrain-$v.png"
  done
fi

node "$ART_ROOT/optimize.mjs" "$OUTD/terrain.glb" "$PUB/hi/terrain.glb" --tex none
node --input-type=module -e "
import sharp from 'sharp';
await sharp('$OUTD/normal.png').webp({ quality: 90, effort: 6 }).toFile('$PUB/hi/terrain-normal.webp');
"

blend everest --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers everest
for v in day night; do
  node "$ART_ROOT/images.mjs" pano "$OUTD/pano-$v.png" "$PUB/pano-$v.webp"
done
node "$ART_ROOT/optimize.mjs" "$OUTD/mini.glb" "$PUB/lo/mini.glb" --tex none
du -sh "$PUB"/*
