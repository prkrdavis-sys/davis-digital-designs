# Homepage scene C: `diorama` (CTA + footer)

File ownership: `art/worlds/diorama/**`, `src/worlds/scenes/diorama/**`, `public/worlds/diorama/**`.

Homepage chapters: hero (garden), doors, reel (museum), voices (bubbles), cta (yours), outro (yours, the footer). Your scene spans two chapters, so its rail covers s in [0, 2] plus ~0.2 margin (it starts right after the bubbles scene; the compositor blends in from s ~ -0.2, clamped to 0). Palette: `home` in src/lib/worlds.ts. The cursor theme (a loupe that magnifies the canvas) already exists.

## Art direction
"Pull back to reveal the whole journey as a tiny diorama of every world." A gorgeous tilt-shift miniature island (or a set of floating mini platforms connected by little bridges and paths) carrying miniatures of every world, as if the whole site were a tabletop model:
- the glass greenhouse, the DNA helix sculpture, the pinball table, the snow globe, a dune with a monolith, the Everest massif block with its gold route, a paper plane on a stand, the inflatable star, the speech bubble, the themed archway, and the framed painting.
- The other agents deliver these as `public/worlds/<scene>/lo/mini.glb` (scenes: greenhouse, dna, pinball, snowglobe, dunes, everest, planes, garden, bubbles, doors, museum), each about 1 unit tall, sitting on its base at the origin.
- Some may not exist yet when you start: check at runtime (fetch HEAD) and at build time, and show a tasteful placeholder (a small glossy primitive on a plinth in that world's palette) for any missing ones. Design the layout so everything reads beautifully.
- The island itself is yours to build in Blender: grassy/clay terrain, little paths, water with reflections, tiny trees, and soft baked GI (`ddd.bake.bake_group`).
- Strong tilt-shift DOF (postprocessing `TiltShiftEffect` or DOF), a warm sunset key light, soft shadows (bake them), and floating dust.
- Camera: starts close on one miniature (cta chapter), then pulls up and back and orbits to reveal the whole diorama (outro), ending on a wide, iconic composition. The subject should stay right of centre during cta (the heading and buttons are on the left/center); in the outro it can centre.
- Night: the diorama at night with tiny lights glowing in every miniature (windows, neon, lanterns), and stars.
- Lo version: LayerStack + fireflies-free cheap particles (dust/sparkles).
- Deliver pano-day/night.webp (from the middle of the island) and lo/mini.glb (a tiny island).
