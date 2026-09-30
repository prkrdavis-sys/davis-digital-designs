# Diorama handoff (scene `diorama`)

## Status
- In progress on `cursor/diorama-scene-516f`.
- Blender pipeline and runtime scene written. Preview / bake / layers not rendered yet.

## Done
- `art/worlds/diorama/build.py` (+ `look.py`, `layout.py`, `build.sh`): kidney island + three islets, gravel path, arched bridges, trees, lanterns, pond, wooden table, placeholders for missing minis, import of `public/worlds/<scene>/lo/mini.glb` when present.
- Steps: `rail`, `preview`, `bake`, `layers`, `pano`, `mini`. `layers` and `pano` are standalone re-runnable (`blend diorama --steps layers,pano`).
- Runtime: `src/worlds/scenes/diorama/` hi (baked terrain + HEAD-checked minis + tilt-shift + dust), lo (LayerStack + sparkles), parked (remap + CoverPanel).

## Inputs you depend on
- Miniatures at `public/worlds/<scene>/lo/mini.glb`. On this branch: `dna`, `garden`, `greenhouse`, `planes`. The rest (pinball, snowglobe, dunes, everest, bubbles, doors, museum) use glossy palette placeholders until they merge.
- Homepage palette is `home` in `src/lib/worlds.ts`.

## Next
1. Fetch venice_sunset HDRI and iterate Cycles `--preview` stills (cta / mid / outro, day + night).
2. Bake terrain, export rails / mini, optimize GLBs.
3. Render layers + pano; screenshot every chapter.
