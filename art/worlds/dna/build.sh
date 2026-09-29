#!/usr/bin/env bash
# DNA under the microscope: data -> proteins (PDB) -> chromosome -> rail -> Cycles layers -> web assets.
set -euo pipefail
source "$(dirname "$0")/../../env.sh"

blend dna --steps data,proteins,chromosome,rail
for f in histone pcna helicase polymerase groel chromosome; do
  node "$ART_ROOT/optimize.mjs" "$ART_OUT/dna/$f.glb" "$WORLDS_PUBLIC/dna/hi/$f.glb" --tex none
done
blend dna --steps layers,pano,mini --variant both
node "$ART_ROOT/images.mjs" layers dna
for v in day night; do node "$ART_ROOT/images.mjs" pano "$ART_OUT/dna/pano-$v.png" "$WORLDS_PUBLIC/dna/pano-$v.webp"; done
node "$ART_ROOT/optimize.mjs" "$ART_OUT/dna/mini.glb" "$WORLDS_PUBLIC/dna/lo/mini.glb" --tex none
