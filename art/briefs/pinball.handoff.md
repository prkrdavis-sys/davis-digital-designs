# Pinball handoff (scene `pinball`)

## Done
- `art` step works: `art/out/pinball/playfield_art.png` (2048x4096) and `backglass_art.png` (regenerate on the VM; `art/out` starts empty).
- Cycles previews at s=0 and s=1.6 look good, day and night.
- `data` and `rail` wrote `public/worlds/pinball/hi/pinball.json` and `rails.json`, but BEFORE later camera edits in `pinball_model.py`. Rerun them.
- Scripts in `art/worlds/pinball/`: `build.py` (steps art, bake, data, rail, preview, top, layers, pano, mini), `pinball_model.py` (layout, paths, camera rail), `shader.py` (shader-node helpers), `shapes.py` (2D shapes and text meshes), `build.sh` (full pipeline).
- Runtime in `src/worlds/scenes/pinball/`: `index.tsx` (hi, lo, parked), `model.ts`, `state.ts`, `Table.tsx`, `Playfield.tsx`, `Room.tsx`, `materials.ts`, `Dmd.ts`, `Sparkles.tsx`. `tsc` and eslint are clean.

## Temporary stand-ins in `public/worlds/pinball/hi/`
- `hardware.glb` and `cabinet-*.glb` from an older bake format, `playfield.webp` (real art), flat grey `lightmap-*.webp`.

## Not done
1. Run `bash art/worlds/pinball/build.sh` (art through web images). The last bake (CPU, 128 samples) was killed before producing files.
2. Layers/posters (8 tags per variant), pano and mini were never rendered.
3. NEVER VIEWED IN A BROWSER. Check the runtime, tune exposure, bloom and depth of field, then screenshot every chapter.

## Gotchas
- `step_bake` forces `sc.cycles.device = "CPU"` (the laptop GPU ran out of memory). Fine on the VM.
- The playfield bake is lighting only (1024x2048); the runtime multiplies it with the full-res art, so one art texture serves both variants.
- Night lighting in Cycles still needs brighter bumper caps and inserts.
- The rail runs to s=4.7: the tour uses 0-4.2, and 4.4-4.7 is the parked backglass view (`PARKED_S=4.56` in `index.tsx`).
- The runtime finds parts by node name and by the Blender material name kept in the GLB.
- Chrome reflections come from a cube capture about 20 frames after mount; the playfield runs a half-resolution mirror pass every frame.
