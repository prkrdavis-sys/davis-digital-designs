# Diorama handoff (scene `diorama`)

## Status
Complete on `cursor/diorama-scene-516f` (PR #9). Runtime + Blender pipeline + baked terrain + rails + mini + Low Resources layers + day/night panos + browser-verified chapter shots.

`npx tsc --noEmit`, `eslint src/worlds/scenes/diorama`, and `npx next build` are clean.

## Done
- Kidney island + three islets, pond hole, gravel path, bridges, trees, lanterns, flowers, wooden table (runtime mesh, not in the GI atlas).
- Imports `public/worlds/<scene>/lo/mini.glb` when present (scales giants, e.g. DNA). Placeholders for missing / KTX2-only minis (planes fails Blender import because of `KHR_texture_basisu`).
- Runtime HEAD-checks each mini and draws a glossy palette placeholder if 404.
- Camera rail `s ∈ [0, 2.2]`: close on the garden star (cta, subject right of centre), crane + orbit to a wide tabletop (outro).
- Night: plot lamps + sky stars. Lo: LayerStack + sparkles. Parked: remap ~1.72 + CoverPanel.
- Fog eases out as the camera cranes (tight haze on CTA, readable island on outro).
- Local bake helper (shared `bake.bake_group` hits a UTF-8 UV-name bug on this join).
- Layers at `s = 0.08, 1.15, 2.00` (day + night). Wide tags have back+mid only (no front band at that distance).
- Equirect panos from mid-island: `public/worlds/diorama/pano-{day,night}.webp`.
- Shots: `art/briefs/shots/diorama/{cta,outro}-{day,night,lo}.jpg`.

## Inputs
- Minis on this branch: `dna`, `garden`, `greenhouse`. `planes` exists but is KTX2 and Blender cannot import it — placeholder in Cycles, real GLB at runtime.
- Missing: pinball, snowglobe, dunes, everest, bubbles, doors, museum.
- Re-run layers/pano after those merge:
  ```
  source art/env.sh && blend diorama --steps layers,pano --variant both
  node art/images.mjs layers diorama
  for v in day night; do
    node art/images.mjs pano art/out/diorama/pano-$v.png public/worlds/diorama/pano-$v.webp
  done
  ```

## Files
- `art/worlds/diorama/{look.py,layout.py,build.py,build.sh}`
- `src/worlds/scenes/diorama/{index.tsx,layout.ts,Sky.tsx,Pond.tsx,Dust.tsx,LoSparkle.tsx,Minis.tsx}`
- `public/worlds/diorama/{rails.json,hi/{layout.json,terrain-day.glb,terrain-night.glb},lo/mini.glb,layers/*,posters/*,pano-day.webp,pano-night.webp}`

## Proposed shared diff
In `art/lib/ddd/bake.py`, `uvn.uv_map = uv.name` can raise `UnicodeDecodeError` after a large join on Blender 5.2. Use a literal `"bake"` (and sanitize layer names) instead of reading `uv.name`.
