#!/usr/bin/env bash
# Rebuild every world from scratch: fetch sources, run each Blender build,
# optimize GLBs, and convert stills. Each world's build.sh can also be run alone.
#   bash art/build-all.sh            all worlds
#   bash art/build-all.sh dna pinball
set -euo pipefail
source "$(dirname "$0")/env.sh"

SCENES=("$@")
if [ ${#SCENES[@]} -eq 0 ]; then
  SCENES=(dna everest greenhouse pinball snowglobe dunes planes garden doors museum bubbles diorama)
fi

for s in "${SCENES[@]}"; do
  script="$ART_ROOT/worlds/$s/build.sh"
  if [ -f "$script" ]; then
    echo "=== $s ==="
    bash "$script"
  else
    echo "skip $s (no build.sh)"
  fi
done
