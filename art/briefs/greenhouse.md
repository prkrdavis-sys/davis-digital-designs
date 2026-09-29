# Greenhouse world (scene id `greenhouse`) for the Sites page

Page: `/sites` (src/app/[category]/page.tsx). Chapters: intro (PageHero), work (project grid), interlude (one big line: "Every site starts as a seed. Light, patience, a little pruning."), outro (footer). The rail covers s in [0, 4] + margin (sMax ~4.2). Palette in src/lib/worlds.ts (`sites`: "The greenhouse", "Websites grown in morning light").

Art direction: a PHOTOREAL Victorian glass conservatory at sunrise, detailed like a high-end architectural visualization or motion-design ad frame.
- Architecture (procedural in Blender): wrought-iron frame with arched ribs, a central dome or lantern, curved glass panes, cast-iron columns with ornate brackets and scrollwork, finials, and ridge cresting. The glass has subtle grime, condensation droplets and slight waviness (roughness + normal). Patterned encaustic tile floor (ambientCG / Poly Haven textures), raised brick or stone planters, terracotta pots, potting benches, a watering can, and hanging baskets.
- Plants: Poly Haven plant models where available (`node art/fetch/polyhaven.mjs search models plant`, try fern, potted, etc.), plus geometry-nodes or scripted ferns and ivy climbing the ironwork, and hanging pothos. Lots of lush, layered foliage.
- Light: low golden sunrise through the glass, with volumetric sunbeams (baked or additive light-shaft cards), animated caustics on the floor (shader), and drifting dust and pollen motes. Bake static GI with `ddd.bake.bake_group` (architecture, floor, planters). Keep glass and foliage live-lit, with an HDRI environment for reflections.
- Floating glass browser panels hover among the plants, each showing a Sites project cover. Find Sites projects in `content/work/*.mdx` (frontmatter `category: sites`, `cover:` path under `public/work/`). Load the covers at runtime with `useColorTextures` and frame them as frosted-glass browser windows with a small toolbar and a soft glow.
- Camera, by chapter:
  - intro: start at the entrance, looking down the central aisle.
  - work: glide down the aisle past benches and hanging plants, with panels drifting by.
  - interlude: crane up into the dome through the light shafts.
  - outro: end looking out through the dome glass at the sunrise sky.
  Big, cinematic, smooth perspective changes, with the subject framed right of centre.
- Night variant: moonlight through the glass, warm string lights / fairy lights along the ribs, lanterns on the benches, and deep blue shadows. No fireflies (the owner removed them).
- Parked mode (project pages in the Sites world): a calm view of a bench under the dome, with `<CoverPanel/>` placed like a framed canvas propped among the plants or hanging from the ironwork.
- Lo version: LayerStack from Cycles layers + a few live pollen / dust motes.
- Pano: from the center of the conservatory, under the dome. Mini: a tiny glass greenhouse building on a base (~1 unit tall).
